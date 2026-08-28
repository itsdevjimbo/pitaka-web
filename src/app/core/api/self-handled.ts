import { HttpContext, HttpContextToken } from '@angular/common/http';

/**
 * Marks a request whose caller owns the meaning of its own 401, so the session
 * machinery must not read it as the session having lapsed.
 *
 * Sign-in and boot verification both qualify: a 401 on sign-in means "wrong
 * password", and a 401 on `GET /api/auth/me` is `Session.verifyBoot`'s to handle
 * (ADR 0004). The flag travels on the request the adapter builds, so the two
 * facts — which endpoint this is, and who handles its 401 — stay in the one file
 * that owns the endpoint rather than being re-derived from the URL downstream.
 */
export const HANDLES_OWN_401 = new HttpContextToken<boolean>(() => false);

/** An `HttpContext` marking the request as handling its own 401. */
export const handlesOwn401 = (): HttpContext =>
  new HttpContext().set(HANDLES_OWN_401, true);
