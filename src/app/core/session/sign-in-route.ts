import { UrlCreationOptions } from '@angular/router';
import { SESSION_ENDED_MESSAGE } from '@/app/core/api';

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
 * Query parameter carrying why a visitor was sent to sign-in — a set of fixed
 * values we mint, never the server's or the visitor's own words. The value is
 * matched exactly on the way back in ({@link reasonMessage}), the way
 * `safeReturnUrl` treats `returnUrl`, because it rides the same rewritable
 * query string.
 */
export const SIGN_IN_REASON_PARAM = 'reason';

/**
 * The fixed set of reasons this client ever sends someone to sign-in with an
 * explanation attached. Each is a value `signInRedirect`/`reasonQueryParams`
 * mints and `reasonMessage` reads back — never a string built from anything a
 * visitor could rewrite.
 */
export type SignInReason = 'session-expired' | 'email-confirmed';

/** The line shown when a confirmation link has just been spent successfully. */
const EMAIL_CONFIRMED_MESSAGE = 'Your email is confirmed. Sign in to continue.';

const REASON_MESSAGES: Record<SignInReason, string> = {
  'session-expired': SESSION_ENDED_MESSAGE,
  'email-confirmed': EMAIL_CONFIRMED_MESSAGE,
};

/** The `{ reason }` query params for a `SignInReason`, in the one shape both mints agree on. */
export function reasonQueryParams(reason: SignInReason): Record<string, string> {
  return { [SIGN_IN_REASON_PARAM]: reason };
}

/**
 * The notice line for a `reason` query value, or `null` for anything that is
 * not an exact match on one of `SignInReason`'s fixed values. Exact match or
 * nothing: the value comes off a query string where anyone can write it, and a
 * wrong explanation is a lie, not a cosmetic slip.
 */
export function reasonMessage(reason: string | null | undefined): string | null {
  if (reason == null) {
    return null;
  }
  return (REASON_MESSAGES as Record<string, string>)[reason] ?? null;
}

/**
 * Router arguments for sending someone to sign-in while remembering where they
 * were headed. Spread into `Router.createUrlTree` (the guard, which must return
 * a `UrlTree`) or `Router.navigate` (Session, reacting to a mid-use lapse) so
 * both build the identical `returnUrl` redirect. Pass `reason` to add the
 * {@link SIGN_IN_REASON_PARAM} marker so sign-in can explain why the person is
 * back.
 */
export function signInRedirect(
  returnUrl: string,
  { reason }: { reason?: SignInReason } = {}
): [commands: string[], extras: UrlCreationOptions] {
  const queryParams: Record<string, string> = { returnUrl };
  if (reason) {
    Object.assign(queryParams, reasonQueryParams(reason));
  }
  return [[SIGN_IN_ROUTE], { queryParams }];
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
