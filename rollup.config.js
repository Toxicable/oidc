
export default {
  entry: './release/index.js',
  dest: './release/bundles/oidc.umd.js',
  format: 'umd',
  moduleName: 'oidc',
  globals: {
    '@angular/core': 'ng.core',
    '@angular/http': 'ng.http',
    'rxjs/Observable': 'Rx',
    'rxjs/Subscription': 'Rx',
    'rxjs/BehaviorSubject': 'Rx',
    'rxjs/Observer': 'Rx',

    'rxjs/add/operator/map': 'Rx.Observable.prototype',
    'rxjs/add/operator/first': 'Rx.Observable.prototype',
    'rxjs/add/operator/catch': 'Rx.Observable.prototype',
    'rxjs/add/operator/do': 'Rx.Observable.prototype',
    'rxjs/add/operator/filter': 'Rx.Observable.prototype',
    'rxjs/add/operator/mergeMap': 'Rx.Observable.prototype',

    'rxjs/add/observable/of': 'Rx.Observable',
    'rxjs/add/observable/interval': 'Rx.Observable',
    'rxjs/add/observable/combineLatest': 'Rx.Observable',
    'rxjs/add/observable/throw': 'Rx.Observable',
  }
}
