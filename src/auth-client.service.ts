import { Injectable, Inject, ChangeDetectorRef } from '@angular/core';
import { Http, Headers, RequestOptions, Response } from '@angular/http';
import { Profile, AuthTokens, AuthState, ExternalLogin } from './models';
import { Observable } from 'rxjs/Observable';
import { Subscription } from 'rxjs/Subscription';
import { BehaviorSubject } from 'rxjs/BehaviorSubject';
import { Observer } from 'rxjs/Observer';
import { Storage } from './storage';
import { Refresh } from './models/refresh';
import { JwtHelper } from 'angular2-jwt';
import 'rxjs/add/operator/map';
import 'rxjs/add/operator/first';
import 'rxjs/add/operator/catch';
import 'rxjs/add/operator/do';
import 'rxjs/add/operator/filter';
import 'rxjs/add/observable/of';
import 'rxjs/add/observable/interval';
import 'rxjs/add/observable/combineLatest';
import { OpenIdClientConfig } from './config';

declare let FB: any;
declare let gapi: any;

@Injectable()
export class OpenIdClientService {
  constructor(
    private http: Http,
    private storage: Storage,
    @Inject('config') private config: OpenIdClientConfig
  ) {
    this.jwtHelper = new JwtHelper();

    this.state = new BehaviorSubject<AuthState>(this.initalState);
    this.tokens$ = Observable.combineLatest(this.state, this.authReady$)
      .filter(state => state[1])
      .map(state => state[0].tokens);

    this.profile$ = Observable.combineLatest(this.state, this.authReady$)
      .filter(state => state[1])
      .map(state => state[0].profile);

    this.loggedIn$ = this.tokens$.map(tokens => !!tokens);

    this.refreshSubscription$ = this.startupTokenRefresh()
      .do(() => this.scheduleRefresh())
      .subscribe();
  }

  private initalState = { profile: null, loggedIn: false, tokens: null };
  private storageName = 'oidc-token';
  private jwtHelper: JwtHelper;
  private authReady$ = new BehaviorSubject<boolean>(false);
  private state: BehaviorSubject<AuthState>;
  private refreshSubscription$: Subscription;

  tokens$: Observable<AuthTokens>;
  profile$: Observable<Profile>;
  loggedIn$: Observable<boolean>;

  initExternal() {
    FB.init({
      appId: this.config.facebookAppId,
      status: true,
      cookie: true,
      xfbml: false,
      version: 'v2.8'
    });

    gapi.load('auth', () => { });
  }

  authorizeExternal(provider: string) {
    switch (provider) {
      case 'facebook':
        return this.authorizeFacebook();

      case 'google':
        return this.authorizeGoogle();
    }
  }

  registerExternal(provider: string) {
    return this.authorizeExternal(provider)
      .flatMap((accessToken: string) => {
        return this.http.post('/api/account/registerexternal', { accessToken, provider, })
          .flatMap(() => this.getTokens({ assertion: accessToken, provider }, 'urn:ietf:params:oauth:grant-type:external_identity_token')
            .do(() => this.scheduleRefresh()));
      });

  }

  login(provider: string) {
    return this.authorizeExternal(provider)
      .flatMap((accessToken: string) =>
        this.getTokens({ assertion: accessToken, provider }, 'urn:ietf:params:oauth:grant-type:external_identity_token')
          .do(() => this.scheduleRefresh()));
  }

  private authorizeFacebook(): Observable<string> {
    return Observable.create((observer: Observer<any>) => {
      try {
        FB.login((response: any) => {
          observer.next(response.authResponse.accessToken);
          observer.complete();
        }, { scope: 'email' });
      } catch (error) {
        observer.error(error);
      }
    });

  }

  private authorizeGoogle(): Observable<string> {
    return Observable.create((observer: Observer<any>) => {
      try {
        gapi.auth.authorize({
          client_id: this.config.googleClientId,
          scope: 'profile'
        }, (token: any) => {
          observer.next(token.access_token);
          observer.complete();
        });
      } catch (error) {
        observer.error(error);
      }
    });
  }

  isInRole(usersRole: string): Observable<boolean> {
    return this.profile$
      .map(profile => profile.role.find(role => role === usersRole) !== undefined);
  }



  logout() {
    this.state.next(this.initalState);
    this.refreshSubscription$.unsubscribe();
    this.storage.removeItem(this.storageName);
  }

  getTokens(data: Refresh | ExternalLogin, grantType: string) {
    let headers = new Headers({ 'Content-Type': 'application/x-www-form-urlencoded' });
    let options = new RequestOptions({ headers: headers });

    Object.assign(data, {
      grant_type: grantType,
      scope: 'openid offline_access'
    });
    //TODO: replace with formdata

    let encodedData = Object.keys(data)
      //TODO: fix this TS issue
      .map(key => encodeURIComponent(key) + '=' + encodeURIComponent((<any>data)[key]))
      .join('&');

    return this.http.post('/connect/token', encodedData, options)
      .map(res => res.json())
      .map((tokens: AuthTokens) => {
        let now = new Date();
        tokens.expiration_date = new Date(now.getTime() + tokens.expires_in * 1000).getTime().toString();

        let profile: Profile = this.jwtHelper.decodeToken(tokens.id_token);

        this.storage.setItem(this.storageName, tokens);
        this.state.next({ tokens, profile, loggedIn: true });
        this.authReady$.next(true);
      });
  }

  unsubscribeRefresh() {
    if (this.refreshSubscription$) {
      this.refreshSubscription$.unsubscribe();
    }
  }

  refreshTokens() {
    return this.tokens$
      .first()
      .flatMap(tokens => this.getTokens({ refresh_token: tokens.refresh_token }, 'refresh_token')
      //.catch(error => Observable.throw('Session Expired'))
      );
  }

  startupTokenRefresh() {
    return this.storage.getItem(this.storageName)
      .flatMap((tokens: AuthTokens) => {
        // check if the token is even in localStorage, if it isn't tell them it's not and return
        if (!tokens) {
          this.authReady$.next(true);
          return Observable.throw('No token in Storage');
        }
        let profile: Profile = this.jwtHelper.decodeToken(tokens.id_token);
        this.state.next({ tokens, profile, loggedIn: false });

        if (+tokens.expiration_date < new Date().getTime()) {
          this.authReady$.next(true);
        }

        // it if is able to refresh then the getTokens method will let the app know that we're auth ready
        return this.refreshTokens();
      })
      .catch(error => {
        this.authReady$.next(true);
        return Observable.throw(error);
      });
  }

  scheduleRefresh(): void {
    this.refreshSubscription$ = this.tokens$
      .first()
      .flatMap(tokens => Observable.interval(tokens.expires_in / 2 * 1000))
      .flatMap(() => this.refreshTokens())
      .subscribe();
  }
}
