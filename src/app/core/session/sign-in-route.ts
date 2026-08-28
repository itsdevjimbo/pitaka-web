import { UrlCreationOptions } from '@angular/router';

/**
 * The route an unauthenticated visitor — or one whose session has lapsed — is
 * sent to. Kept in one place so the guard, the interceptor, and the Session
 * service agree if the auth area ever moves.
 */
export const SIGN_IN_ROUTE = '/auth/sign-in';

/**
 * The authenticated area's landing route: where sign-in drops a person with no
 * remembered destination, and where `guestGuard` sends someone who is already
 * signed in. The counterpart to `SIGN_IN_ROUTE`, shared for the same reason.
 */
export const APP_HOME_ROUTE = '/app';

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
 *
 * Absent is absent: an empty string or `undefined` is treated like `null`,
 * because the value comes off a query string and the caller should not have to
 * know which flavour of nothing its router API hands back.
 */
export function safeReturnUrl(
  returnUrl: string | null | undefined
): string | null {
  if (!returnUrl || !returnUrl.startsWith('/')) {
    return null;
  }
  return returnUrl.startsWith('//') ? null : returnUrl;
}
