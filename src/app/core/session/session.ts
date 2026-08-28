import { computed, inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService, Credentials, Profile } from '@/app/core/auth';
import { LocalStorage } from '@/app/core/local-storage';
import { SIGN_IN_ROUTE } from './routes';

const TOKEN_KEY = 'pitaka.token';

/**
 * Owns the signed-in session: the bearer token, the live Profile, and the
 * transitions between them (sign in, boot verification, deliberate sign-out,
 * and the lapse when the hour runs out).
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

  readonly isAuthenticated = computed(() => this._token() !== null);

  /** Exchange credentials for a session. Rejects with an `ApiError` on failure. */
  async signIn(credentials: Credentials): Promise<void> {
    const { token, profile } = await firstValueFrom(this.auth.login(credentials));
    this.storage.setItem(TOKEN_KEY, token);
    this._token.set(token);
    this._profile.set(profile);
  }

  /**
   * On boot, verify a stored token against the server before the authenticated
   * shell renders. A token the server rejects is cleared; a genuine one yields
   * the current name and email, which a cached copy would serve stale.
   */
  async verifyBoot(): Promise<void> {
    if (this._token() === null) {
      return;
    }
    try {
      this._profile.set(await firstValueFrom(this.auth.me()));
    } catch {
      this.clear();
    }
  }

  /** Deliberate sign-out — client-side only; the API has no logout endpoint. */
  signOut(): void {
    this.clear();
    this.router.navigateByUrl(SIGN_IN_ROUTE);
  }

  /**
   * The session lapsed mid-use (a 401 behind some request). Clear it and return
   * to sign-in, remembering where the person was so they resume, not restart.
   */
  expire(): void {
    if (this._token() === null) {
      return;
    }
    const returnUrl = this.router.url;
    this.clear();
    this.router.navigate([SIGN_IN_ROUTE], { queryParams: { returnUrl } });
  }

  private clear(): void {
    this.storage.removeItem(TOKEN_KEY);
    this._token.set(null);
    this._profile.set(null);
  }
}
