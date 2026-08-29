import { computed, inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiError } from '@/app/core/api';
import {
  AuthService,
  Credentials,
  Profile,
  Registration,
  SignInResult,
} from '@/app/core/auth';
import { LocalStorage } from '@/app/core/local-storage';
import { SIGN_IN_ROUTE, signInRedirect } from './sign-in-route';

const TOKEN_KEY = 'pitaka.token';

/**
 * Owns the signed-in session: the bearer token, the live Profile, and the
 * transitions between them (sign in, boot verification, and the lapse when the
 * hour runs out).
 *
 * The token lives in `localStorage` so a page refresh keeps the person signed
 * in; there is no refresh token, so this whole mechanism has a planned death
 * date (ADR 0004).
 */
@Injectable({ providedIn: 'root' })
export class Session {
  // Dependencies
  private auth = inject(AuthService);
  private storage = inject(LocalStorage);
  private router = inject(Router);

  // State
  private readonly _token = signal<string | null>(
    this.storage.getItem(TOKEN_KEY)
  );
  private readonly _profile = signal<Profile | null>(null);

  /** The bearer token to attach to API requests, or `null` when signed out. */
  readonly token = this._token.asReadonly();

  /** The signed-in person's identity, populated once the server confirms it. */
  readonly profile = this._profile.asReadonly();

  /**
   * Whether the server has confirmed this session during this page's life, not
   * merely whether a token is stored (ADR 0004: verified, "not merely
   * decoded"). Only `signIn` and a successful `verifyBoot` set the Profile, so
   * a token the server has not yet vouched for never reaches the shell.
   */
  readonly isAuthenticated = computed(() => this._profile() !== null);

  /** Exchange credentials for a session. Rejects with an `ApiError` on failure. */
  async signIn(credentials: Credentials): Promise<void> {
    this.establish(await firstValueFrom(this.auth.login(credentials)));
  }

  /**
   * Register a new Profile and start its session in the same step — the API
   * hands back a token on register, so no chained sign-in is needed. Rejects
   * with an `ApiError` on failure (a taken email arrives as a 409).
   */
  async register(registration: Registration): Promise<void> {
    this.establish(await firstValueFrom(this.auth.register(registration)));
  }

  /** Adopt a freshly minted session: persist the token, hold the Profile. */
  private establish({ token, profile }: SignInResult): void {
    this.storage.setItem(TOKEN_KEY, token);
    this._token.set(token);
    this._profile.set(profile);
  }

  /**
   * On boot, verify a stored token against the server before the authenticated
   * shell renders. A token the server rejects is cleared; a genuine one yields
   * the current name and email, which a cached copy would serve stale.
   *
   * Only a 401 clears the session (ADR 0004). A transport failure — the API
   * down, no network — leaves the stored token in place so a refresh once
   * connectivity returns signs the person straight back in.
   *
   * This method is the sole handler of the 401 on `GET /api/auth/me`: it clears
   * the token but does not redirect, since it runs before the shell renders and
   * the app initializer / route guards route from the cleared state. The auth
   * interceptor deliberately exempts this request so `expire()` does not also
   * fire on the same response.
   */
  async verifyBoot(): Promise<void> {
    if (this._token() === null) {
      return;
    }

    try {
      this._profile.set(await firstValueFrom(this.auth.me()));
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        this.clear();
      }
    }
  }

  /**
   * The person chose to leave. Clear the session client-side — the API has no
   * logout to call (ADR 0004) — and return to sign-in. Unlike `expire`, no
   * return URL is kept: a deliberate exit has nowhere to resume.
   */
  signOut(): void {
    if (this.teardown()) {
      this.router.navigate([SIGN_IN_ROUTE]);
    }
  }

  /**
   * The session lapsed mid-use (a 401 behind some request). Clear it and return
   * to sign-in, remembering where the person was so they resume, not restart.
   */
  expire(): void {
    if (this.teardown()) {
      this.router.navigate(...signInRedirect(this.router.url, { lapsed: true }));
    }
  }

  /**
   * Clear the session if one is still live, reporting whether this call is the
   * one that did it. Concurrent in-flight requests can each come back 401 (or a
   * stray second sign-out can land); only the first still has a token, so only
   * it goes on to redirect.
   */
  private teardown(): boolean {
    if (this._token() === null) {
      return false;
    }
    this.clear();
    return true;
  }

  private clear(): void {
    this.storage.removeItem(TOKEN_KEY);
    this._token.set(null);
    this._profile.set(null);
  }
}
