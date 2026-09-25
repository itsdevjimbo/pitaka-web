import { computed, inject, Injectable, signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { firstValueFrom, type Subscription } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { AuthService, type Credentials, type Profile, type SignInResult } from '@/app/core/auth';
import { LocalStorage } from '@/app/core/local-storage';
import { reasonQueryParams, SIGN_IN_ROUTE, signInRedirect } from './routing/sign-in-route';

const TOKEN_KEY = 'pitaka.token';

const PROFILE_FIELDS = ['name', 'email', 'pendingEmail', 'hasPicture'] as const;

export type ProfileField = (typeof PROFILE_FIELDS)[number];

export type ProfileRefreshResult = 'refreshed' | 'absent' | 'stale';

/** Captures which session and identity values a whole-Profile request observed. */
export type ProfileRevision = {
  sessionGeneration: number;
  profileId: number;
  fields: Readonly<Record<ProfileField, number>>;
};

/** A whole-Profile read request ordered against every other read path. */
export type ProfileReadRevision = ProfileRevision & { readGeneration: number };

/** A Profile revision that reserves one or more fields for an in-flight write. */
export type ProfileWriteRevision = ProfileRevision & {
  writeGenerations: Readonly<Partial<Record<ProfileField, number>>>;
};

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
  private sessionGeneration = 0;
  private signInGeneration = 0;
  private profileFieldVersions: Record<ProfileField, number> = {
    name: 0,
    email: 0,
    pendingEmail: 0,
    hasPicture: 0,
  };
  private pendingProfileWrites: Partial<Record<ProfileField, number>> = {};
  private profileWriteGeneration = 0;
  private profilePictureId: number | null = null;
  private profilePictureHasPicture: boolean | null = null;
  private profilePictureGeneration = 0;
  private profilePictureRequest: Subscription | null = null;
  private profileReadGeneration = 0;

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
    const generation = ++this.signInGeneration;
    const result = await firstValueFrom(this.auth.login(credentials));
    if (generation === this.signInGeneration) {
      this.establish(result);
    }
  }

  /** Adopt a freshly minted session: persist the token, hold the Profile. */
  private establish({ token, profile }: SignInResult): void {
    this.resetProfilePicture();
    this.signInGeneration += 1;
    this.sessionGeneration += 1;
    this.resetProfileFieldVersions();
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
    const generation = this.sessionGeneration;
    if (token === null) {
      return;
    }

    try {
      const profile = await firstValueFrom(this.auth.me());
      if (this._token() !== token || this.sessionGeneration !== generation) {
        return;
      }
      this._profile.set(profile);
      this.resetProfileFieldVersions();
      this.syncProfilePicture(profile, token);
    } catch (error) {
      if (this._token() !== token || this.sessionGeneration !== generation) {
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
  captureProfileRevision(): ProfileRevision | null {
    const profile = this._profile();
    if (profile === null || this._token() === null) {
      return null;
    }
    return {
      sessionGeneration: this.sessionGeneration,
      profileId: profile.id,
      fields: { ...this.profileFieldVersions },
    };
  }

  /** Start a whole-Profile read and make it newer than every earlier read. */
  beginProfileRead(): ProfileReadRevision | null {
    const revision = this.captureProfileRevision();
    return revision === null ? null : { ...revision, readGeneration: ++this.profileReadGeneration };
  }

  /** Reserve fields so concurrent reads cannot replace them before a write finishes. */
  beginProfileWrite(fields: readonly ProfileField[]): ProfileWriteRevision | null {
    const revision = this.captureProfileRevision();
    if (revision === null) {
      return null;
    }

    const writeGenerations: Partial<Record<ProfileField, number>> = {};
    for (const field of fields) {
      this.profileFieldVersions[field] += 1;
      const generation = ++this.profileWriteGeneration;
      this.pendingProfileWrites[field] = generation;
      writeGenerations[field] = generation;
    }
    return { ...revision, fields: { ...this.profileFieldVersions }, writeGenerations };
  }

  /** Merge only the fields still owned by this write, even if a read finished first. */
  applyProfileWriteUpdate(profile: Profile, revision: ProfileWriteRevision, fields: readonly ProfileField[]): void {
    const current = this._profile();
    if (current === null || current.id !== profile.id || !this.isCurrentProfileRevision(revision)) {
      this.releaseProfileWrite(revision, fields);
      return;
    }

    const updated: Profile = { ...current };
    let changed = false;
    for (const field of fields) {
      const generation = revision.writeGenerations[field];
      if (generation === undefined || this.pendingProfileWrites[field] !== generation) {
        continue;
      }
      this.copyProfileField(updated, profile, field);
      this.finishProfileWrite(field, generation);
      changed = true;
    }

    this.releaseProfileWrite(revision, fields);
    if (changed) {
      this._profile.set(updated);
      const token = this._token();
      if (token !== null) {
        this.syncProfilePicture(updated, token);
      }
    }
  }

  /** Release a reservation after a failed request so later reads can reconcile it. */
  releaseProfileWrite(revision: ProfileWriteRevision, fields: readonly ProfileField[]): void {
    for (const field of fields) {
      const generation = revision.writeGenerations[field];
      if (generation !== undefined && this.pendingProfileWrites[field] === generation) {
        this.finishProfileWrite(field, generation);
      }
    }
  }

  /** Merge a request's Profile response without replacing fields changed since it began. */
  applyProfileUpdate(
    profile: Profile,
    revision?: ProfileRevision | null,
    fields: readonly ProfileField[] = PROFILE_FIELDS,
  ): boolean {
    return this.applyProfile(profile, revision, fields, true);
  }

  /** Read Profile metadata and the saved image again after a picture write. */
  async refreshProfileAfterPictureUpload(): Promise<ProfileRefreshResult> {
    if (this._profile() === null) {
      return 'stale';
    }
    this.profileFieldVersions.hasPicture += 1;
    return this.refreshProfile();
  }

  /** Retry refreshing metadata and the saved picture after a successful upload. */
  async refreshProfile(): Promise<ProfileRefreshResult> {
    const revision = this.beginProfileRead();
    if (revision === null) {
      return 'stale';
    }

    let updated: Profile;
    try {
      updated = await firstValueFrom(this.auth.me());
    } catch (error) {
      if (!this.isCurrentProfileRead(revision)) {
        return 'stale';
      }
      if (error instanceof ApiError && error.status === 401) {
        this.expire();
      }
      throw error;
    }

    if (!this.applyProfile(updated, revision, PROFILE_FIELDS, false)) {
      return 'stale';
    }
    const current = this._profile();
    const token = this._token();
    if (current !== null && token !== null && !current.hasPicture) {
      this.syncProfilePicture(current, token);
      return 'absent';
    }
    return this.refreshCurrentProfilePicture(revision);
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
    this.signInGeneration += 1;
    this.sessionGeneration += 1;
    this.resetProfileFieldVersions();
    this.storage.removeItem(TOKEN_KEY);
    this._token.set(null);
    this._profile.set(null);
  }

  /** Share one in-memory picture per session and discard superseded reads. */
  private syncProfilePicture(profile: Profile, token: string): void {
    if (this.profilePictureId === profile.id && this.profilePictureHasPicture === profile.hasPicture) {
      return;
    }

    const sameProfile = this.profilePictureId === profile.id;
    this.cancelProfilePictureRequest();
    this.profilePictureGeneration += 1;
    if (!sameProfile || !profile.hasPicture) {
      this.clearProfilePictureUrl();
    }
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
          this.markProfilePictureAbsent(profile.id, token, generation);
          return;
        }

        this.replaceProfilePictureUrl(URL.createObjectURL(picture));
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

  private async refreshCurrentProfilePicture(revision: ProfileReadRevision): Promise<ProfileRefreshResult> {
    const profile = this._profile();
    const token = this._token();
    if (profile === null || token === null) {
      return 'stale';
    }
    if (!profile.hasPicture) {
      return 'absent';
    }
    if (!this.isCurrentProfileRead(revision)) {
      return 'stale';
    }

    this.cancelProfilePictureRequest();
    const generation = ++this.profilePictureGeneration;
    try {
      const picture = await firstValueFrom(this.auth.profilePicture());
      if (!this.isCurrentProfileRead(revision) || !this.isCurrentProfilePictureRead(generation, token, profile.id)) {
        return 'stale';
      }
      if (picture === null) {
        this.markProfilePictureAbsent(profile.id, token, generation);
        return 'absent';
      }

      this.replaceProfilePictureUrl(URL.createObjectURL(picture));
      this.profilePictureId = profile.id;
      this.profilePictureHasPicture = true;
      return 'refreshed';
    } catch (error) {
      if (!this.isCurrentProfileRead(revision) || !this.isCurrentProfilePictureRead(generation, token, profile.id)) {
        return 'stale';
      }
      throw error;
    }
  }

  private applyProfile(
    profile: Profile,
    revision: ProfileRevision | null | undefined,
    fields: readonly ProfileField[],
    syncPicture: boolean,
  ): boolean {
    const current = this._profile();
    const snapshot = revision === undefined ? this.captureProfileRevision() : revision;
    if (current === null || current.id !== profile.id || snapshot === null) {
      return false;
    }
    if (
      snapshot.sessionGeneration !== this.sessionGeneration ||
      snapshot.profileId !== profile.id ||
      ('readGeneration' in snapshot && snapshot.readGeneration !== this.profileReadGeneration) ||
      this._token() === null
    ) {
      return false;
    }

    const updated: Profile = { ...current };
    for (const field of fields) {
      if (this.pendingProfileWrites[field] !== undefined) {
        continue;
      }
      if (this.profileFieldVersions[field] !== snapshot.fields[field]) {
        continue;
      }
      this.copyProfileField(updated, profile, field);
      // Accepted values form a barrier even when equal, so an older read cannot arrive later and undo them.
      this.profileFieldVersions[field] += 1;
    }
    this._profile.set(updated);
    const token = this._token();
    if (syncPicture && token !== null) {
      this.syncProfilePicture(updated, token);
    }
    return true;
  }

  private copyProfileField(target: Profile, source: Profile, field: ProfileField): void {
    if (field === 'name') {
      target.name = source.name;
    } else if (field === 'email') {
      target.email = source.email;
    } else if (field === 'pendingEmail') {
      target.pendingEmail = source.pendingEmail;
    } else {
      target.hasPicture = source.hasPicture;
    }
  }

  private isCurrentProfileRevision(revision: ProfileRevision): boolean {
    const profile = this._profile();
    return (
      this.sessionGeneration === revision.sessionGeneration &&
      profile?.id === revision.profileId &&
      this._token() !== null
    );
  }

  private isCurrentProfileRead(revision: ProfileReadRevision): boolean {
    return revision.readGeneration === this.profileReadGeneration && this.isCurrentProfileRevision(revision);
  }

  private finishProfileWrite(field: ProfileField, generation: number): void {
    if (this.pendingProfileWrites[field] !== generation) {
      return;
    }
    delete this.pendingProfileWrites[field];
    this.profileFieldVersions[field] += 1;
  }

  private markProfilePictureAbsent(profileId: number, token: string, generation: number): void {
    if (!this.isCurrentProfilePictureRead(generation, token, profileId)) {
      return;
    }
    const profile = this._profile();
    if (profile === null) {
      return;
    }
    this.profileFieldVersions.hasPicture += 1;
    this._profile.set({ ...profile, hasPicture: false });
    this.profilePictureHasPicture = false;
    this.clearProfilePictureUrl();
  }

  private replaceProfilePictureUrl(url: string): void {
    const previous = this._profilePictureUrl();
    this._profilePictureUrl.set(url);
    if (previous !== null && previous !== url) {
      URL.revokeObjectURL(previous);
    }
  }

  private clearProfilePictureUrl(): void {
    const url = this._profilePictureUrl();
    if (url !== null) {
      URL.revokeObjectURL(url);
      this._profilePictureUrl.set(null);
    }
  }

  private cancelProfilePictureRequest(): void {
    this.profilePictureRequest?.unsubscribe();
    this.profilePictureRequest = null;
  }

  private resetProfileFieldVersions(): void {
    this.profileFieldVersions = { name: 0, email: 0, pendingEmail: 0, hasPicture: 0 };
    this.pendingProfileWrites = {};
  }

  private resetProfilePicture(): void {
    this.profilePictureGeneration += 1;
    this.cancelProfilePictureRequest();
    this.clearProfilePictureUrl();
    this.profilePictureId = null;
    this.profilePictureHasPicture = null;
  }
}
