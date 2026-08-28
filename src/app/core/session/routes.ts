import { UrlCreationOptions } from '@angular/router';

/**
 * The route an unauthenticated visitor — or one whose session has lapsed — is
 * sent to. Kept in one place so the guard, the interceptor, and the Session
 * service agree if the auth area ever moves.
 */
export const SIGN_IN_ROUTE = '/auth/sign-in';

/**
 * Router arguments for sending someone to sign-in while remembering where they
 * were headed. Spread into `Router.createUrlTree` (the guard, which must return
 * a `UrlTree`) or `Router.navigate` (Session, reacting to a mid-use lapse) so
 * both build the identical `returnUrl` redirect.
 */
export function signInRedirect(
  returnUrl: string
): [commands: string[], extras: UrlCreationOptions] {
  return [[SIGN_IN_ROUTE], { queryParams: { returnUrl } }];
}
