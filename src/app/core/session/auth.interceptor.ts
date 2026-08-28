import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { API_BASE_URL, ApiError } from '@/app/core/api';
import { Session } from './session';

/**
 * Attaches the session's bearer token to every request bound for the Pitaka API,
 * and — when such a request comes back 401 — treats it as the session having
 * lapsed: the token is cleared and the person is returned to sign-in with their
 * place remembered.
 *
 * The token is scoped to `API_BASE_URL` so it never leaks to another host. The
 * sign-in request itself is exempt from the lapse handling: a 401 there means
 * "wrong password", not "your session ended".
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

  const isSignIn = request.url.endsWith('/api/auth/login');

  return next(outgoing).pipe(
    catchError((error: unknown) => {
      if (forApi && !isSignIn && error instanceof ApiError && error.status === 401) {
        session.expire();
      }
      return throwError(() => error);
    })
  );
};
