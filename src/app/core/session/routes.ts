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

/**
 * Sanitize a `returnUrl` before navigating to it after sign-in. `signInRedirect`
 * only ever mints an in-app path, but the value survives a round trip through the
 * query string where anyone can rewrite it, so the open-redirect check lives here
 * next to the route it guards. A protocol-relative `//host` or any value not
 * rooted at `/` is rejected as `null`; the caller falls back to its own home.
 */
export function safeReturnUrl(returnUrl: string | null): string | null {
  if (returnUrl === null || !returnUrl.startsWith('/')) {
    return null;
  }
  return returnUrl.startsWith('//') ? null : returnUrl;
}
