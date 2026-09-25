import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  Injector,
  runInInjectionContext,
  signal,
} from '@angular/core';
import { MatButton } from '@angular/material/button';
import { firstValueFrom } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { AuthService } from '@/app/core/auth';
import { Session, type ProfilePictureOperation, type ProfileWriteRevision } from '@/app/core/session';

const REMOVE_FAILED = 'Something went wrong removing your Profile picture. Please try again.';
const REFRESH_FAILED = 'Your picture was removed, but the Profile could not be refreshed.';
const PICTURE_STILL_PRESENT = 'Your picture was removed, but Profile still reports a saved picture.';

/** Confirms and removes a saved Profile picture outside the upload control. */
@Component({
  selector: 'profile-picture-removal',
  imports: [MatButton],
  templateUrl: './profile-picture-removal.html',
  host: { class: 'block' },
})
export class ProfilePictureRemoval {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly auth = inject(AuthService);
  private readonly session = inject(Session);

  protected readonly profile = this.session.profile;
  protected readonly operationPending = this.session.profilePictureOperationPending;
  protected readonly confirming = signal(false);
  protected readonly removing = signal(false);
  protected readonly refreshing = signal(false);
  protected readonly pendingFeedback = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly refreshErrorMessage = signal<string | null>(null);
  protected readonly successMessage = signal<string | null>(null);
  private operation: ProfilePictureOperation | null = null;
  private writeRevision: ProfileWriteRevision | null = null;
  private successMessageTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.clearSuccessMessageTimeout();
      this.releaseOperation();
    });
  }

  protected readonly hasSavedPicture = computed(() => this.profile()?.hasPicture === true);

  isWritePending(): boolean {
    return this.removing() || this.refreshing();
  }

  notifyWritePending(): void {
    this.pendingFeedback.set(true);
  }

  requestRemoval(): void {
    if (!this.hasSavedPicture() || this.operationPending()) {
      return;
    }
    this.errorMessage.set(null);
    this.refreshErrorMessage.set(null);
    this.successMessage.set(null);
    this.clearSuccessMessageTimeout();
    this.pendingFeedback.set(false);
    this.confirming.set(true);
    this.focusAfterRender('#keep-profile-picture');
  }

  protected cancelPrompt(): void {
    if (this.isWritePending()) {
      this.pendingFeedback.set(true);
      return;
    }
    this.confirming.set(false);
    this.pendingFeedback.set(false);
    this.focusAfterRender('button[aria-label="Remove Profile picture"]');
  }

  protected async confirmRemoval(): Promise<void> {
    if (this.isWritePending() || this.operation !== null) {
      return;
    }
    const operation = this.session.beginProfilePictureOperation();
    if (operation === null) {
      return;
    }
    const revision = this.session.beginProfilePictureWrite(operation);
    if (revision === null) {
      this.session.releaseProfilePictureOperation(operation);
      return;
    }

    this.operation = operation;
    this.writeRevision = revision;
    this.removing.set(true);
    this.pendingFeedback.set(false);
    this.errorMessage.set(null);
    this.refreshErrorMessage.set(null);
    this.successMessage.set(null);
    this.clearSuccessMessageTimeout();

    try {
      await firstValueFrom(this.auth.removeProfilePicture());
    } catch (error) {
      if (!this.destroyRef.destroyed) {
        this.session.releaseProfileWrite(revision, ['hasPicture']);
        this.writeRevision = null;
        this.removing.set(false);
        this.errorMessage.set(error instanceof ApiError ? error.message : REMOVE_FAILED);
        this.releaseOperation();
        this.focusAfterRender('#confirm-remove-profile-picture');
      }
      return;
    }

    if (this.destroyRef.destroyed) {
      return;
    }
    const applied = this.session.applyProfilePictureRemoval(revision);
    this.writeRevision = null;
    this.removing.set(false);
    if (!applied) {
      this.releaseOperation();
      return;
    }
    this.confirming.set(false);
    await this.refreshAfterRemoval();
  }

  protected async retryRefresh(): Promise<void> {
    if (this.refreshing()) {
      return;
    }
    if (this.operation === null) {
      this.operation = this.session.beginProfilePictureOperation();
      if (this.operation === null) {
        return;
      }
    }
    await this.refreshAfterRemoval();
  }

  private async refreshAfterRemoval(): Promise<void> {
    this.refreshing.set(true);
    this.pendingFeedback.set(false);
    this.refreshErrorMessage.set(null);
    this.errorMessage.set(null);
    try {
      const result = await this.session.refreshProfileAfterPictureRemoval();
      if (this.destroyRef.destroyed) {
        return;
      }
      if (result === 'stale') {
        this.refreshErrorMessage.set(REFRESH_FAILED);
        this.focusAfterRender('#retry-profile-picture-refresh');
        return;
      }
      if (result === 'picture-present') {
        this.refreshErrorMessage.set(PICTURE_STILL_PRESENT);
        this.focusAfterRender('#retry-profile-picture-refresh');
        return;
      }
      this.showSuccessMessage('Profile picture removed.');
      this.refreshErrorMessage.set(null);
      this.releaseOperation();
      this.focusPictureChooser();
    } catch {
      if (!this.destroyRef.destroyed) {
        this.refreshErrorMessage.set(REFRESH_FAILED);
        this.focusAfterRender('#retry-profile-picture-refresh');
      }
    } finally {
      if (!this.destroyRef.destroyed) {
        this.refreshing.set(false);
      }
    }
  }

  private releaseOperation(): void {
    if (this.writeRevision !== null) {
      this.session.releaseProfileWrite(this.writeRevision, ['hasPicture']);
      this.writeRevision = null;
    }
    if (this.operation !== null) {
      this.session.releaseProfilePictureOperation(this.operation);
      this.operation = null;
    }
  }

  private showSuccessMessage(message: string): void {
    this.clearSuccessMessageTimeout();
    this.successMessage.set(message);
    this.successMessageTimeout = setTimeout(() => {
      this.successMessageTimeout = null;
      this.successMessage.set(null);
    }, 3000);
  }

  private clearSuccessMessageTimeout(): void {
    if (this.successMessageTimeout !== null) {
      clearTimeout(this.successMessageTimeout);
      this.successMessageTimeout = null;
    }
  }

  private focusAfterRender(selector: string): void {
    runInInjectionContext(this.injector, () =>
      afterNextRender(() => this.host.nativeElement.parentElement?.querySelector<HTMLButtonElement>(selector)?.focus()),
    );
  }

  private focusPictureChooser(): void {
    this.focusAfterRender('profile-picture-editor button[aria-label="Choose a Profile picture"]');
  }
}
