import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, map, Observable, of, throwError } from 'rxjs';
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

/** What registration needs: the person's name and the pair they just chose. */
export type Registration = {
  name: string;
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

/**
 * A 409 from `POST /api/auth/register` means the email is already taken. The
 * server's `detail` ("A user with this email already exists.") states the fact
 * but not the way out; the wording that points the person at signing in is
 * settled here, the one place that knows which endpoint was called (ADR 0002).
 */
const EMAIL_ALREADY_REGISTERED =
  'That email is already registered. Try signing in instead.';

/**
 * A 423 from `POST /api/auth/login` means too many recent failures. No
 * countdown: Identity's lockout duration is a server default the response
 * does not carry, and a guessed figure would be a fabrication (ADR 0015).
 */
const TOO_MANY_ATTEMPTS =
  'Too many failed attempts. Please wait a few minutes and try again.';

/**
 * A 403 from `POST /api/auth/login` means the Profile has not confirmed its
 * email — Identity's `PreSignInCheck` returns this before the password is ever
 * checked, so it says nothing about whether the password was right (issue
 * #68). It is the one auth failure that drives UI, so it gets its own type
 * rather than a status check in a screen (ADR 0015): sign-in asks `instanceof`,
 * never `error.status === 403`.
 */
export class EmailNotConfirmedError extends Error {
  /** The address to seed the shared resend control with. */
  readonly email: string;

  constructor(email: string) {
    super(
      'Confirm your email before signing in. Check your inbox for the link.'
    );
    this.name = 'EmailNotConfirmedError';
    this.email = email;
  }
}

/** Wire shape of `POST /api/auth/login` — the API names the identity `user`. */
type LoginResponse = {
  token: string;
  user: Profile;
};

/**
 * Wire shape of `POST /api/auth/register` — a Profile only, no token: the
 * confirmation gate (ADR 0015) means there is no session to hand back yet.
 */
type RegisterResponse = {
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

  /**
   * Exchange credentials for a token. A wrong pair fails with a 401 `ApiError`;
   * too many recent failures fail with a 423 `ApiError`; an unconfirmed Profile
   * fails with an `EmailNotConfirmedError` regardless of the password typed
   * (issue #68) — the three are mutually exclusive, since `PreSignInCheck`
   * returns the 403 before a locked-out check ever runs.
   */
  login(credentials: Credentials): Observable<SignInResult> {
    return this.http
      .post<LoginResponse>(`${this.baseUrl}/api/auth/login`, credentials, {
        context: handlesOwn401(),
      })
      .pipe(
        map((response) => ({ token: response.token, profile: response.user })),
        catchError((error: unknown) => {
          if (error instanceof ApiError && error.status === 403) {
            return throwError(
              () => new EmailNotConfirmedError(credentials.email)
            );
          }
          if (error instanceof ApiError && error.status === 401) {
            return throwError(() => new ApiError(WRONG_CREDENTIALS, error.status));
          }
          if (error instanceof ApiError && error.status === 423) {
            return throwError(() => new ApiError(TOO_MANY_ATTEMPTS, error.status));
          }
          return throwError(() => error);
        })
      );
  }

  /**
   * Register a new Profile. There is no session to hand back — the confirmation
   * gate (ADR 0015) means the endpoint answers with the Profile alone and sends
   * a confirmation email — so this returns a `Profile`, not a `SignInResult`. A
   * taken email fails with a 409 `ApiError` carrying our sign-in-pointing
   * wording.
   */
  register(registration: Registration): Observable<Profile> {
    return this.http
      .post<RegisterResponse>(`${this.baseUrl}/api/auth/register`, registration)
      .pipe(
        map((response) => response.user),
        catchError((error: unknown) =>
          throwError(() =>
            error instanceof ApiError && error.status === 409
              ? new ApiError(EMAIL_ALREADY_REGISTERED, error.status)
              : error
          )
        )
      );
  }

  /**
   * Ask for a fresh confirmation link. Always resolves: the endpoint answers
   * `202` for an unknown address, an already-confirmed one and a just-sent one
   * alike (ADR 0015 — the server is the enumeration boundary), so there is no
   * outcome to report, and a transport failure is swallowed here so no caller is
   * tempted to say something a success would not have said. Swallowed for the
   * person, not for us: the failure is logged here, at the seam that is the last
   * to see it, so an outage does not vanish entirely.
   *
   * Flagged `handlesOwn401` for the same reason sign-in is: this is a guest
   * request, and the session interceptor sits outside this `catchError`, so
   * without the flag a 401 here would tear down a live session before the
   * swallow ever ran.
   */
  resendConfirmation(email: string): Observable<void> {
    return this.http
      .post<void>(
        `${this.baseUrl}/api/auth/resend-confirmation`,
        { email },
        { context: handlesOwn401() }
      )
      .pipe(
        map(() => undefined),
        catchError((error: unknown) => {
          console.warn('[api] resend-confirmation failed, swallowed', error);
          return of(undefined);
        })
      );
  }

  /**
   * Ask for a password-reset link. Always resolves, for the same reason
   * `resendConfirmation` does: the endpoint answers `202` whether or not that
   * address has a Profile (ADR 0015 — the server is the enumeration boundary),
   * so there is no outcome to report, and a transport failure is swallowed here
   * rather than in the screen, where a caller could otherwise be tempted to say
   * something a success would not have said. Swallowed for the person, not for
   * us: the failure is logged at this seam, the last to see it.
   *
   * Flagged `handlesOwn401` because this is a guest request and the session
   * interceptor sits outside this `catchError`; without the flag a 401 here
   * would tear down a live session before the swallow ever ran.
   */
  forgotPassword(email: string): Observable<void> {
    return this.http
      .post<void>(
        `${this.baseUrl}/api/auth/forgot-password`,
        { email },
        { context: handlesOwn401() }
      )
      .pipe(
        map(() => undefined),
        catchError((error: unknown) => {
          console.warn('[api] forgot-password failed, swallowed', error);
          return of(undefined);
        })
      );
  }

  /**
   * Spend a confirmation link. Unlike `resendConfirmation`, this has a genuine
   * outcome the caller must see: success confirms the Profile, and the API
   * collapses every other case — expired, already used, tampered, or wrong —
   * into one undifferentiated `400` (ADR 0015), which arrives here as an
   * `ApiError` the caller is left to treat uniformly, exactly as that
   * indistinguishability demands.
   *
   * Flagged `handlesOwn401` because this screen must not assume the absence of
   * a session (ADR 0015): a signed-in visitor who opens the link keeps their
   * session, and without the flag a stray 401 here would tear it down before
   * this call's own error handling ever ran.
   */
  confirmEmail(userId: number, token: string): Observable<void> {
    return this.http
      .post<void>(
        `${this.baseUrl}/api/auth/confirm-email`,
        { userId, token },
        { context: handlesOwn401() }
      )
      .pipe(map(() => undefined));
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
