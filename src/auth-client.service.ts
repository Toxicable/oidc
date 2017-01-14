import { Injectable, Inject, ChangeDetectorRef } from '@angular/core';
import { Http, Headers, RequestOptions, Response } from '@angular/http';
import { Profile, AuthTokens, AuthState, ExternalLogin } from './models';
import { Observable } from 'rxjs/Observable';
import { Subscription } from 'rxjs/Subscription';
import { BehaviorSubject } from 'rxjs/BehaviorSubject';
import { Observer } from 'rxjs/Observer';
import { Storage, LocalStorageBackend } from './async-storage';
import { Refresh } from './models/refresh';
import { OpenIdClientConfig } from './config';
import { OAuthProvider } from './oauth-provider';

const jwtDecode = require('jwt-decode');

import 'rxjs/add/operator/map';
import 'rxjs/add/operator/mergeMap';
import 'rxjs/add/operator/first';
import 'rxjs/add/operator/catch';
import 'rxjs/add/operator/do';
import 'rxjs/add/operator/filter';

import 'rxjs/add/observable/of';
import 'rxjs/add/observable/interval';
import 'rxjs/add/observable/combineLatest';
import 'rxjs/add/observable/throw';

declare let FB: any;
declare let gapi: any;


@Injectable()
export class OpenIdClientService {
  constructor(
    private http: Http,
    private storage: Storage,
    @Inject('config') private config: OpenIdClientConfig
  ) {
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
      .subscribe(() => { }, error => console.info(error));
  }

  private providerOAuthMap = {
    google: 'https://accounts.google.com/o/oauth2/auth',
    facebook: 'https://www.facebook.com/v2.8/dialog/oauth'
  };
  private initalState = { profile: null, tokens: null };
  private storageName = 'oidc-token';
  private authReady$ = new BehaviorSubject<boolean>(false);
  private state: BehaviorSubject<AuthState>;
  private refreshSubscription$: Subscription;

  tokens$: Observable<AuthTokens>;
  profile$: Observable<Profile>;
  loggedIn$: Observable<boolean>;

  private backendRegister(accessToken: string, provider: string) {
    return this.http.post(this.config.registerExternalEndpoint, { accessToken, provider, });
  }

  private backendLogin(accessToken: string, provider: string) {
    return this.getTokens({ assertion: accessToken, provider }, 'urn:ietf:params:oauth:grant-type:external_identity_token');
  }

  private authorizeExternal(providerName: string) {
    let provider = this.config.providersConfig[providerName];
    if (!provider) {
      throw new Error('No config provided for provider: ' + providerName);
    }

    let origin = window.location.origin;

    let url = this.providerOAuthMap[providerName] + '?' +
      'client_id=' + encodeURIComponent(provider.client_id) +
      '&scope=' + encodeURIComponent(provider.scopes) +
      '&redirect_uri=' + encodeURIComponent(provider.redirect_uri) +
      '&response_type=token' +
      '&origin=' + encodeURIComponent(origin);

    let oauthWindow = window.open(url, 'name', 'height=600,width=450');

    if (window.focus) {
      oauthWindow.focus();
    }

    return Observable.interval(200)
      .map(() => {
        try {
          // accessing href cross origins will throw
          // so we ignore ones that throw and pass the ones that don't
          // since we know they are on our origin
          return oauthWindow.location.href;
        } catch (error) {
          return '';
        }
      })
      .filter(responseUrl => responseUrl.startsWith(provider.redirect_uri) || !!oauthWindow.closed)
      .first()
      .do(responseUrl => oauthWindow.close())
      .map(queryString => {
        if (queryString === '') {
          throw new Error('An error occured while retriving the access_token, the returned url was "" which usually means the user closed the window ');
        }
        //TODO: use router to parse url
        let regexParts = /access_token=(.*?)&/.exec(queryString);
        if (!regexParts) {
          throw new Error('An error occured while retriving the access_token, the returned url was: ' + queryString);
        }
        return regexParts[1];
      });
  }



  registerExternal(provider: string, autoLogin = true): Observable<void | Response> {
    return this.authorizeExternal(provider)
      .flatMap((accessToken: string) => {
        let register$ = this.backendRegister(accessToken, provider);
        if (autoLogin) {
          return register$.flatMap(() => this.backendLogin(accessToken, provider));
        }
        return register$;
      })
      .do(() => this.scheduleRefresh());
  }

  loginExternal(provider: string, autoRegister = true) {
    let localAccessToken: string;
    return this.authorizeExternal(provider)
      .flatMap((accessToken: string) => {
        localAccessToken = accessToken;
        return this.backendLogin(accessToken, provider);
      })
      .catch(res => {
        if (autoRegister) {
          let response = res.json();
          if (response) {
            if (response.error_description === 'The user does not exist') {
              return this.backendRegister(localAccessToken, provider)
                .flatMap(() => this.backendLogin(localAccessToken, provider));
            }
          }
        }
        return Observable.throw(res);
      })
      .do(() => this.scheduleRefresh());

  }

  logout() {
    this.state.next(this.initalState);
    if (this.refreshSubscription$) {
      this.refreshSubscription$.unsubscribe();
    }
    this.storage.removeItem(this.storageName);
  }

  isInRole(usersRole: string): Observable<boolean> {
    return this.profile$
      .map(profile => profile.role.find(role => role === usersRole) !== undefined);
  }

  getTokens(data: Refresh | ExternalLogin, grantType: string) {
    let headers = new Headers({ 'Content-Type': 'application/x-www-form-urlencoded' });
    let options = new RequestOptions({ headers: headers });

    Object.assign(data, { grant_type: grantType, scope: 'openid offline_access' });

    let encodedData = Object.keys(data)
      .map(key => encodeURIComponent(key) + '=' + encodeURIComponent(data[key]))
      .join('&');

    return this.http.post(this.config.tokenEndpoint, encodedData, options)
      .map(res => {
        let tokens: AuthTokens = res.json();
        let now = new Date();
        tokens.expiration_date = new Date(now.getTime() + tokens.expires_in * 1000).getTime().toString();

        let profile: Profile = jwtDecode(tokens.id_token);

        this.storage.setItem(this.storageName, tokens);
        this.state.next({ tokens, profile });
        this.authReady$.next(true);
        return res;
      });
  }


  refreshTokens() {
    return this.tokens$.first()
      .flatMap(tokens => this.getTokens({ refresh_token: tokens.refresh_token }, 'refresh_token')
        .catch(error => Observable.throw('Session Expired'))
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
        let profile: Profile = jwtDecode(tokens.id_token);
        this.state.next({ tokens, profile });

        if (+tokens.expiration_date > new Date().getTime()) {
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
  //initExternal() {
  // FB.init({
  //   appId: this.config.facebookAppId,
  //   status: true,
  //   cookie: true,
  //   xfbml: false,
  //   version: 'v2.8'
  // });

  // gapi.load('auth', () => { });
  //}

  // private authorizeFacebook(): Observable<string> {
  //   return Observable.create((observer: Observer<any>) => {
  //     try {
  //       FB.login((response: any) => {
  //         observer.next(response.authResponse.accessToken);
  //         observer.complete();
  //       }, { scope: 'email' });
  //     } catch (error) {
  //       observer.error(error);
  //     }
  //   });

  // }

  // private authorizeGoogle(): Observable<string> {
  //   return Observable.create((observer: Observer<any>) => {
  //     try {
  //       gapi.auth.authorize({
  //         client_id: this.config.googleClientId,
  //         scope: 'profile'
  //       }, (token: any) => {
  //         observer.next(token.access_token);
  //         observer.complete();
  //       });
  //     } catch (error) {
  //       observer.error(error);
  //     }
  //   });
  // }
}

