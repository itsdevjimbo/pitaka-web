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
  viewChild,
} from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { AuthService } from '@/app/core/auth';
import { ProfilePictureAvatar } from '@/app/core/profile-picture';
import { Session, type ProfilePictureOperation, type ProfileWriteRevision } from '@/app/core/session';
import { validateProfilePicture } from './profile-picture-validation';

const UPLOAD_FAILED = 'Something went wrong uploading your Profile picture. Please try again.';
const REFRESH_FAILED = 'Your picture was uploaded, but the saved Profile picture could not be refreshed.';
const PICTURE_ABSENT =
  'Your upload completed, but the server reports no saved Profile picture. Choose a picture to try again.';

/** Selects and uploads a private Profile picture. */
@Component({
  selector: 'profile-picture-editor',
  imports: [MatButton, MatTooltipModule, ProfilePictureAvatar],
  templateUrl: './profile-picture-editor.html',
})
export class ProfilePictureEditor {
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly auth = inject(AuthService);
  private readonly session = inject(Session);

  protected readonly validating = signal(false);
  protected readonly saving = signal(false);
  protected readonly pendingFeedback = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly refreshErrorMessage = signal<string | null>(null);
  protected readonly successMessage = signal<string | null>(null);
  protected readonly refreshing = signal(false);
  protected readonly operationPending = this.session.profilePictureOperationPending;
  protected readonly hasEditorContent = computed(
    () =>
      this.validating() ||
      this.saving() ||
      this.pendingFeedback() ||
      this.errorMessage() !== null ||
      this.refreshErrorMessage() !== null ||
      this.successMessage() !== null,
  );
  private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');
  private readonly pictureAction = viewChild<ElementRef<HTMLButtonElement>>('pictureAction');
  private selectionGeneration = 0;
  private operation: ProfilePictureOperation | null = null;
  private writeRevision: ProfileWriteRevision | null = null;
  private successMessageTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.selectionGeneration += 1;
      this.clearSuccessMessageTimeout();
      this.releaseOperation();
    });
  }

  hasUnsavedChanges(): boolean {
    return this.validating();
  }

  isWritePending(): boolean {
    return this.saving() || this.refreshing();
  }

  notifyWritePending(): void {
    this.pendingFeedback.set(true);
  }

  discardUnsavedChanges(): void {
    this.selectionGeneration += 1;
    this.validating.set(false);
    this.pendingFeedback.set(false);
    this.errorMessage.set(null);
    this.clearSuccessMessage();
    this.releaseOperation();
  }

  protected async selectPicture(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    if (file === null || this.isWritePending() || this.operationPending()) {
      return;
    }

    const operation = this.session.beginProfilePictureOperation();
    if (operation === null) {
      return;
    }
    this.operation = operation;

    const generation = ++this.selectionGeneration;
    this.errorMessage.set(null);
    this.refreshErrorMessage.set(null);
    this.clearSuccessMessage();
    this.pendingFeedback.set(false);
    this.validating.set(true);

    const result = await validateProfilePicture(file);
    if (this.destroyRef.destroyed || generation !== this.selectionGeneration) {
      return;
    }
    this.validating.set(false);
    if (!result.valid) {
      this.errorMessage.set(result.message);
      this.releaseOperation();
      return;
    }

    await this.uploadPicture(file);
  }

  protected openFileDialog(): void {
    if (this.isWritePending() || this.operationPending() || this.refreshErrorMessage() !== null) {
      return;
    }
    this.fileInput()?.nativeElement.click();
  }

  private async uploadPicture(file: File): Promise<void> {
    if (this.validating() || this.isWritePending() || this.operation === null) {
      return;
    }

    const revision = this.session.beginProfilePictureWrite(this.operation);
    if (revision === null) {
      this.releaseOperation();
      return;
    }
    this.writeRevision = revision;

    this.saving.set(true);
    this.pendingFeedback.set(false);
    this.errorMessage.set(null);
    this.refreshErrorMessage.set(null);
    this.clearSuccessMessage();
    try {
      await firstValueFrom(this.auth.uploadProfilePicture(file));
    } catch (error) {
      this.session.releaseProfileWrite(revision, ['hasPicture']);
      this.writeRevision = null;
      if (!this.destroyRef.destroyed) {
        this.errorMessage.set(uploadErrorMessage(error));
        this.saving.set(false);
      }
      this.releaseOperation();
      return;
    }

    this.session.releaseProfileWrite(revision, ['hasPicture']);
    this.writeRevision = null;

    if (this.destroyRef.destroyed) {
      this.releaseOperation();
      return;
    }
    const refreshed = await this.refreshSavedPicture(true);
    if (!this.destroyRef.destroyed) {
      this.saving.set(false);
      this.focusPictureAction();
    }
    if (refreshed) {
      this.releaseOperation();
    }
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
    this.refreshing.set(true);
    this.pendingFeedback.set(false);
    const refreshed = await this.refreshSavedPicture();
    if (!this.destroyRef.destroyed) {
      this.refreshing.set(false);
    }
    if (refreshed) {
      this.releaseOperation();
    }
  }

  private async refreshSavedPicture(pictureWasUploaded = false): Promise<boolean> {
    try {
      const refreshed = pictureWasUploaded
        ? await this.session.refreshProfileAfterPictureUpload()
        : await this.session.refreshProfile();
      if (this.destroyRef.destroyed) {
        return false;
      }
      if (refreshed === 'stale') {
        this.refreshErrorMessage.set(REFRESH_FAILED);
        return false;
      }
      this.refreshErrorMessage.set(null);
      if (refreshed === 'absent') {
        this.errorMessage.set(PICTURE_ABSENT);
        return true;
      }
      this.errorMessage.set(null);
      this.showSuccessMessage('Profile picture saved.');
      return true;
    } catch {
      if (!this.destroyRef.destroyed) {
        this.refreshErrorMessage.set(REFRESH_FAILED);
      }
      return false;
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

  private focusPictureAction(): void {
    runInInjectionContext(this.injector, () => afterNextRender(() => this.pictureAction()?.nativeElement.focus()));
  }

  private showSuccessMessage(message: string): void {
    this.clearSuccessMessageTimeout();
    this.successMessage.set(message);
    this.successMessageTimeout = setTimeout(() => {
      this.successMessageTimeout = null;
      this.successMessage.set(null);
    }, 3000);
  }

  private clearSuccessMessage(): void {
    this.clearSuccessMessageTimeout();
    this.successMessage.set(null);
  }

  private clearSuccessMessageTimeout(): void {
    if (this.successMessageTimeout !== null) {
      clearTimeout(this.successMessageTimeout);
      this.successMessageTimeout = null;
    }
  }
}

function uploadErrorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : UPLOAD_FAILED;
}
