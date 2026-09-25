import {
  afterNextRender,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  Injector,
  runInInjectionContext,
  signal,
  viewChild,
} from '@angular/core';
import { MatButton } from '@angular/material/button';
import { firstValueFrom } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { AuthService } from '@/app/core/auth';
import { EditorDismissal } from '@/app/core/dialog';
import { Session } from '@/app/core/session';
import { validateProfilePicture } from './profile-picture-validation';

const UPLOAD_FAILED = 'Something went wrong uploading your Profile picture. Please try again.';
const REFRESH_FAILED = 'Your picture was uploaded, but the saved Profile picture could not be refreshed.';
const PICTURE_ABSENT =
  'Your upload completed, but the server reports no saved Profile picture. Choose a picture to try again.';

/** Selects, previews, and uploads a private Profile picture. */
@Component({
  selector: 'profile-picture-editor',
  imports: [MatButton],
  templateUrl: './profile-picture-editor.html',
})
export class ProfilePictureEditor {
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly auth = inject(AuthService);
  private readonly session = inject(Session);
  private readonly editorDismissal = inject(EditorDismissal);

  protected readonly previewUrl = signal<string | null>(null);
  protected readonly validating = signal(false);
  protected readonly saving = signal(false);
  protected readonly pendingFeedback = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly refreshErrorMessage = signal<string | null>(null);
  protected readonly successMessage = signal<string | null>(null);
  protected readonly refreshing = signal(false);
  private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');
  private selectedFile: File | null = null;
  private selectionGeneration = 0;

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.selectionGeneration += 1;
      this.releasePreview();
    });
  }

  hasUnsavedChanges(): boolean {
    return this.validating() || this.previewUrl() !== null;
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
    this.successMessage.set(null);
    this.selectedFile = null;
    this.releasePreview();
  }

  protected async selectPicture(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    if (file === null || this.isWritePending()) {
      return;
    }

    const generation = ++this.selectionGeneration;
    this.selectedFile = null;
    this.releasePreview();
    this.errorMessage.set(null);
    this.refreshErrorMessage.set(null);
    this.successMessage.set(null);
    this.pendingFeedback.set(false);
    this.validating.set(true);

    const result = await validateProfilePicture(file);
    if (this.destroyRef.destroyed || generation !== this.selectionGeneration) {
      return;
    }
    this.validating.set(false);
    if (!result.valid) {
      this.errorMessage.set(result.message);
      return;
    }

    this.selectedFile = file;
    this.previewUrl.set(URL.createObjectURL(result.preview));
  }

  protected async savePicture(): Promise<void> {
    const file = this.selectedFile;
    if (file === null || this.validating() || this.isWritePending()) {
      return;
    }

    this.saving.set(true);
    this.pendingFeedback.set(false);
    this.errorMessage.set(null);
    this.refreshErrorMessage.set(null);
    this.successMessage.set(null);
    try {
      await firstValueFrom(this.auth.uploadProfilePicture(file));
    } catch (error) {
      if (!this.destroyRef.destroyed) {
        this.errorMessage.set(uploadErrorMessage(error));
        this.saving.set(false);
      }
      return;
    }

    if (this.destroyRef.destroyed) {
      return;
    }
    this.selectedFile = null;
    this.releasePreview();
    await this.refreshSavedPicture(true);
    if (!this.destroyRef.destroyed) {
      this.saving.set(false);
      this.focusFileInput();
    }
  }

  protected async cancelSelection(): Promise<void> {
    if (this.isWritePending()) {
      this.pendingFeedback.set(true);
      return;
    }
    if (this.hasUnsavedChanges()) {
      const discard = await firstValueFrom(this.editorDismissal.confirmDiscard());
      if (!discard) {
        return;
      }
    }
    this.discardUnsavedChanges();
    this.focusFileInput();
  }

  protected async retryRefresh(): Promise<void> {
    if (this.refreshing()) {
      return;
    }
    this.refreshing.set(true);
    this.pendingFeedback.set(false);
    await this.refreshSavedPicture();
    if (!this.destroyRef.destroyed) {
      this.refreshing.set(false);
    }
  }

  private async refreshSavedPicture(pictureWasUploaded = false): Promise<void> {
    try {
      const refreshed = pictureWasUploaded
        ? await this.session.refreshProfileAfterPictureUpload()
        : await this.session.refreshProfile();
      if (this.destroyRef.destroyed) {
        return;
      }
      if (refreshed === 'stale') {
        this.refreshErrorMessage.set(REFRESH_FAILED);
        return;
      }
      this.refreshErrorMessage.set(null);
      if (refreshed === 'absent') {
        this.errorMessage.set(PICTURE_ABSENT);
        return;
      }
      this.errorMessage.set(null);
      this.successMessage.set('Profile picture saved.');
    } catch {
      if (!this.destroyRef.destroyed) {
        this.refreshErrorMessage.set(REFRESH_FAILED);
      }
    }
  }

  private releasePreview(): void {
    const url = this.previewUrl();
    if (url !== null) {
      URL.revokeObjectURL(url);
      this.previewUrl.set(null);
    }
  }

  private focusFileInput(): void {
    runInInjectionContext(this.injector, () => afterNextRender(() => this.fileInput()?.nativeElement.focus()));
  }
}

function uploadErrorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : UPLOAD_FAILED;
}
