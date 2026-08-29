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
 * Query parameter that marks a redirect to sign-in as a session that lapsed
 * mid-use, as opposed to a visitor who was never signed in. Only `Session.expire`
 * sets it; `authGuard` and `Session.signOut` do not — a first visit needs no
 * account of itself, and a deliberate exit even less. The value is matched
 * exactly on the way back in ({@link isSessionLapse}), the way `safeReturnUrl`
 * treats `returnUrl`, because it rides the same rewritable query string.
 */
export const SESSION_LAPSE_PARAM = 'reason';
const SESSION_LAPSE_VALUE = 'session-expired';

/**
 * Router arguments for sending someone to sign-in while remembering where they
 * were headed. Spread into `Router.createUrlTree` (the guard, which must return
 * a `UrlTree`) or `Router.navigate` (Session, reacting to a mid-use lapse) so
 * both build the identical `returnUrl` redirect. Pass `lapsed` to add the
 * {@link SESSION_LAPSE_PARAM} marker so sign-in can explain why the person is
 * back.
 */
export function signInRedirect(
  returnUrl: string,
  { lapsed = false }: { lapsed?: boolean } = {}
): [commands: string[], extras: UrlCreationOptions] {
  const queryParams: Record<string, string> = { returnUrl };
  if (lapsed) {
    queryParams[SESSION_LAPSE_PARAM] = SESSION_LAPSE_VALUE;
  }
  return [[SIGN_IN_ROUTE], { queryParams }];
}

/**
 * Whether a `reason` query value is the session-lapse marker `signInRedirect`
 * mints. Exact match or nothing: the value comes off a query string where
 * anyone can write it, and a wrong "your session ended" is a lie, not a
 * cosmetic slip.
 */
export function isSessionLapse(reason: string | null | undefined): boolean {
  return reason === SESSION_LAPSE_VALUE;
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
