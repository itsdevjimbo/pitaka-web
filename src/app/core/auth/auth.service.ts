import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import { API_BASE_URL } from '@/app/core/api';

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
      .post<LoginResponse>(`${this.baseUrl}/api/auth/login`, credentials)
      .pipe(map((response) => ({ token: response.token, profile: response.user })));
  }

  /**
   * Verify the current token against the server and read back the live Profile.
   * The API returns 401 even for a cryptographically valid token whose user row
   * is gone (ADR 0004), so this is a genuine check, not a decode.
   */
  me(): Observable<Profile> {
    return this.http.get<Profile>(`${this.baseUrl}/api/auth/me`);
  }
}
