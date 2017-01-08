import { AuthTokens } from './auth-tokens';
import { Profile } from './profile';

export interface AuthState {
  tokens: AuthTokens;
  profile: Profile;
}
