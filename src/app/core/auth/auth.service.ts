import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, map, Observable, throwError } from 'rxjs';
import { ApiError, API_BASE_URL, handlesOwn401 } from '@/app/core/api';

/** A person's own identity, as the shell needs it (ADR 0003: never an "account"). */
export type Profile = {
  id: number;
  name: string;
  email: string;
};

export type Credentials = {
  email: string;
  password: string;
};

/** What a successful sign-in yields: a bearer token and the signed-in Profile. */
export type SignInResult = {
  token: string;
  profile: Profile;
};

/**
 * A 401 from `POST /api/auth/login` means the pair was wrong, not that a session
 * ended — the opposite of what a 401 means anywhere else in the app. The
 * normalizer cannot tell the two apart from the response alone, so the wording
 * is settled here, in the one place that knows which endpoint was called
 * (ADR 0002: nothing above the adapter sees the difference).
 */
const WRONG_CREDENTIALS = 'That email and password do not match. Please try again.';

/** Wire shape of `POST /api/auth/login` — the API names the identity `user`. */
type LoginResponse = {
  token: string;
  user: Profile;
};

/**
 * The hand-written resource service over the API's auth endpoints (ADR 0002).
 * This is the only place that knows the transport shapes; callers see `Profile`
 * and `SignInResult`, and failures arrive already normalised to `ApiError`.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  // Dependencies
  private http = inject(HttpClient);
  private baseUrl = inject(API_BASE_URL);

  /** Exchange credentials for a token. A wrong pair fails with a 401 `ApiError`. */
  login(credentials: Credentials): Observable<SignInResult> {
    return this.http
      .post<LoginResponse>(`${this.baseUrl}/api/auth/login`, credentials, {
        context: handlesOwn401(),
      })
      .pipe(
        map((response) => ({ token: response.token, profile: response.user })),
        catchError((error: unknown) =>
          throwError(() =>
            error instanceof ApiError && error.status === 401
              ? new ApiError(WRONG_CREDENTIALS, error.status)
              : error
          )
        )
      );
  }

  /**
   * Verify the current token against the server and read back the live Profile.
   * The API returns 401 even for a cryptographically valid token whose user row
   * is gone (ADR 0004), so this is a genuine check, not a decode.
   */
  me(): Observable<Profile> {
    return this.http.get<Profile>(`${this.baseUrl}/api/auth/me`, {
      context: handlesOwn401(),
    });
  }
}
