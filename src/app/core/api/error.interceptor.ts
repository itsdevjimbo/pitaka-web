import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { catchError, throwError } from 'rxjs';
import { normalizeHttpError } from './normalize-error';

/**
 * Collapses every failed response into a single `ApiError` before it reaches any
 * caller. Nothing above the HTTP adapter sees the API's four distinct failure
 * shapes (ADR 0002).
 */
export const errorInterceptor: HttpInterceptorFn = (request, next) =>
  next(request).pipe(
    catchError((error: unknown) =>
      throwError(() =>
        error instanceof HttpErrorResponse ? normalizeHttpError(error) : error
      )
    )
  );
