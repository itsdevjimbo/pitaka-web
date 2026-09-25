import { computed, inject, Injectable, signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { firstValueFrom, type Subscription } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { AuthService, type Credentials, type Profile, type SignInResult } from '@/app/core/auth';
import { LocalStorage } from '@/app/core/local-storage';
import { reasonQueryParams, SIGN_IN_ROUTE, signInRedirect } from './routing/sign-in-route';

const TOKEN_KEY = 'pitaka.token';

/**
 * Owns the signed-in session: the bearer token, the live Profile, its private
 * picture URL, and the transitions between them (sign in, boot verification,
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
  private dialogs = inject(MatDialog);

  // State
  private readonly _token = signal<string | null>(this.storage.getItem(TOKEN_KEY));
  private readonly _profile = signal<Profile | null>(null);
  private readonly _profilePictureUrl = signal<string | null>(null);
  private profilePictureId: number | null = null;
  private profilePictureHasPicture: boolean | null = null;
  private profilePictureGeneration = 0;
  private profilePictureRequest: Subscription | null = null;

  /** The bearer token to attach to API requests, or `null` when signed out. */
  readonly token = this._token.asReadonly();

  /** The signed-in person's identity, populated once the server confirms it. */
  readonly profile = this._profile.asReadonly();

  /** A private Blob URL shared by the signed-in Profile and user menu. */
  readonly profilePictureUrl = this._profilePictureUrl.asReadonly();

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

  /** Adopt a freshly minted session: persist the token, hold the Profile. */
  private establish({ token, profile }: SignInResult): void {
    this.resetProfilePicture();
    this.storage.setItem(TOKEN_KEY, token);
    this._token.set(token);
    this._profile.set(profile);
    this.syncProfilePicture(profile, token);
  }

  /**
   * On boot, verify a stored token against the server before the authenticated
   * shell renders. A token the server rejects is cleared; a genuine one yields
   * the current name and email, which a cached copy would serve stale.
   *
   * Only a 401 clears the session (ADR 0004). A transport failure — the API
   * down, no network — leaves the stored token in place so a refresh once
   * connectivity returns signs the person straight back in.
   * A response for a token cleared or replaced while this read was pending is
   * discarded, so it cannot reopen the earlier identity.
   *
   * This method is the sole handler of the 401 on `GET /api/profile`: it clears
   * the token but does not redirect, since it runs before the shell renders and
   * the app initializer / route guards route from the cleared state. The auth
   * interceptor deliberately exempts this request so `expire()` does not also
   * fire on the same response.
   */
  async verifyBoot(): Promise<void> {
    const token = this._token();
    if (token === null) {
      return;
    }

    try {
      const profile = await firstValueFrom(this.auth.me());
      if (this._token() !== token) {
        return;
      }
      this._profile.set(profile);
      this.syncProfilePicture(profile, token);
    } catch (error) {
      if (this._token() !== token) {
        return;
      }
      if (error instanceof ApiError && error.status === 401) {
        this.clear();
      }
    }
  }

  /**
   * Reconcile a write response into the shell without a follow-up read. A
   * response for another Profile must never replace the signed-in identity.
   */
  applyProfileUpdate(profile: Profile): void {
    if (this._profile()?.id === profile.id) {
      this._profile.set(profile);
      const token = this._token();
      if (token !== null) {
        this.syncProfilePicture(profile, token);
      }
    }
  }

  /** Drop a picture that the browser could not decode while keeping API metadata intact. */
  profilePictureDecodeFailed(url: string): void {
    if (this._profilePictureUrl() !== url) {
      return;
    }

    URL.revokeObjectURL(url);
    this._profilePictureUrl.set(null);
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
      this.dialogs.closeAll();
      this.router.navigate(...signInRedirect(this.router.url, { reason: 'session-expired' }));
    }
  }

  /**
   * A password was just reset from this device. Clear whatever session it held
   * — a live token survives a reset for up to an hour and the API cannot
   * revoke it (`pitaka` ADR 0011), so the one token we control is the one we
   * clear (ADR 0015) — and return to sign-in, told why. Unlike `expire`, this
   * always navigates even with no session to clear: the reset itself is the
   * event, not a lapse this device happened to witness. No return URL, for the
   * same reason `signOut` keeps none — re-authenticating from scratch has
   * nowhere to resume.
   */
  completePasswordReset(): void {
    this.teardown();
    this.router.navigate([SIGN_IN_ROUTE], {
      queryParams: reasonQueryParams('password-reset'),
    });
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
    this.resetProfilePicture();
    this.storage.removeItem(TOKEN_KEY);
    this._token.set(null);
    this._profile.set(null);
  }

  /** Share one in-memory picture per session and discard superseded reads. */
  private syncProfilePicture(profile: Profile, token: string): void {
    if (this.profilePictureId === profile.id && this.profilePictureHasPicture === profile.hasPicture) {
      return;
    }

    this.resetProfilePicture();
    this.profilePictureId = profile.id;
    this.profilePictureHasPicture = profile.hasPicture;
    if (!profile.hasPicture) {
      return;
    }

    const generation = this.profilePictureGeneration;
    this.profilePictureRequest = this.auth.profilePicture().subscribe({
      next: (picture) => {
        if (!this.isCurrentProfilePictureRead(generation, token, profile.id)) {
          return;
        }
        if (picture === null) {
          this.profilePictureRequest = null;
          return;
        }

        this._profilePictureUrl.set(URL.createObjectURL(picture));
        this.profilePictureRequest = null;
      },
      error: (error: unknown) => {
        if (this.isCurrentProfilePictureRead(generation, token, profile.id)) {
          console.warn('[api] profile-picture read failed', error);
          this.profilePictureRequest = null;
        }
      },
    });
  }

  private isCurrentProfilePictureRead(generation: number, token: string, profileId: number): boolean {
    const profile = this._profile();
    return (
      this.profilePictureGeneration === generation &&
      this._token() === token &&
      profile?.id === profileId &&
      profile.hasPicture
    );
  }

  private resetProfilePicture(): void {
    this.profilePictureGeneration += 1;
    this.profilePictureRequest?.unsubscribe();
    this.profilePictureRequest = null;
    const url = this._profilePictureUrl();
    if (url !== null) {
      URL.revokeObjectURL(url);
    }
    this._profilePictureUrl.set(null);
    this.profilePictureId = null;
    this.profilePictureHasPicture = null;
  }
}
