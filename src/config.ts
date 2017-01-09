import { OAuthProvider } from './oauth-provider';

export interface OpenIdClientConfig {
  tokenEndpoint: string;
  registerExternalEndpoint: string;
  providersConfig?: { [name: string]: OAuthProvider } ;
}
