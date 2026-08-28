import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { API_BASE_URL, ApiError, HANDLES_OWN_401 } from '@/app/core/api';
import { Session } from './session';

/**
 * Attaches the session's bearer token to every request bound for the Pitaka API,
 * and — when such a request comes back 401 — treats it as the session having
 * lapsed: the token is cleared and the person is returned to sign-in with their
 * place remembered.
 *
 * The token is scoped to `API_BASE_URL` so it never leaks to another host. A
 * request is exempt from the lapse handling when the adapter that built it
 * flagged it `HANDLES_OWN_401` — the flag rides on the request rather than being
 * re-derived from its URL here, so a renamed endpoint cannot silently drop the
 * exemption. Two requests carry it:
 *
 * - the sign-in request — a 401 there means "wrong password", not "your session
 *   ended";
 * - boot verification (`GET /api/auth/me`) — its only caller is
 *   `Session.verifyBoot`, which owns the 401 for that request (ADR 0004: clear
 *   the stored token, no redirect, because the shell has not rendered and there
 *   is no place to return the person to). Letting `expire()` also fire here
 *   would have two handlers racing on one response.
 */
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  // Dependencies
  const session = inject(Session);
  const baseUrl = inject(API_BASE_URL);

  const forApi = request.url.startsWith(baseUrl);
  const token = session.token();

  const outgoing =
    forApi && token
      ? request.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
      : request;

  const selfHandles401 = request.context.get(HANDLES_OWN_401);

  return next(outgoing).pipe(
    catchError((error: unknown) => {
      if (
        forApi &&
        !selfHandles401 &&
        error instanceof ApiError &&
        error.status === 401
      ) {
        session.expire();
      }
      return throwError(() => error);
    })
  );
};
