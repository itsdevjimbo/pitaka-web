import {
  afterNextRender,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  runInInjectionContext,
  signal,
  viewChild,
} from '@angular/core';
import { disabled, form, FormField, submit, validate } from '@angular/forms/signals';
import { MatButton } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '@/app/core/auth';
import { EditorDismissal } from '@/app/core/dialog';
import { focusFirstInvalidField, partitionServerError, type ServerErrorControls } from '@/app/core/forms';
import { Session, type ProfileWriteRevision } from '@/app/core/session';
import { ProfilePictureEditor } from '../profile-picture-editor/profile-picture-editor';
import { ProfilePictureRemoval } from '../profile-picture-removal/profile-picture-removal';

const PROFILE_NAME_MAX = 255;
const COULD_NOT_UPDATE_NAME = 'Something went wrong updating your name. Please try again.';

/** The signed-in identity shown on the Profile page, including name editing. */
@Component({
  selector: 'profile-identity',
  imports: [MatButton, MatFormFieldModule, MatInputModule, FormField, ProfilePictureEditor, ProfilePictureRemoval],
  templateUrl: './profile-identity.html',
})
export class ProfileIdentity {
  private readonly injector = inject(Injector);
  private readonly session = inject(Session);
  private readonly editorDismissal = inject(EditorDismissal);

  protected readonly profile = this.session.profile;
  protected readonly editingName = signal(false);
  protected readonly nameModel = signal({ name: '' });
  protected readonly hasChangedName = computed(() => {
    const profile = this.profile();
    return profile !== null && this.nameModel().name.trim() !== profile.name;
  });
  protected readonly submitting = signal(false);
  protected readonly nameForm = form(this.nameModel, (form) => {
    disabled(form.name, { when: () => this.submitting() });
    validate(form.name, (context) => {
      const name = context.value().trim();
      if (name.length === 0) {
        return { kind: 'required', message: 'Enter a name' };
      }
      if (name.length > PROFILE_NAME_MAX) {
        return {
          kind: 'maxLength',
          message: `The name must be ${PROFILE_NAME_MAX} characters or fewer`,
        };
      }
      return undefined;
    });
  });
  protected readonly successMessage = signal<string | null>(null);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly pendingFeedback = signal(false);
  private readonly pictureEditor = viewChild(ProfilePictureEditor);
  private readonly pictureRemoval = viewChild(ProfilePictureRemoval);
  private readonly nameInput = viewChild<ElementRef<HTMLInputElement>>('nameInput');
  private readonly editNameAction = viewChild<ElementRef<HTMLButtonElement>>('editNameAction');

  protected beginNameEdit(): void {
    const profile = this.profile();
    if (profile === null) {
      return;
    }

    this.nameModel.set({ name: profile.name });
    this.errorMessage.set(null);
    this.successMessage.set(null);
    this.pendingFeedback.set(false);
    this.editingName.set(true);
    this.focusAfterRender(this.nameInput, true);
  }

  hasUnsavedChanges(): boolean {
    return this.hasUnsavedNameChanges() || (this.pictureEditor()?.hasUnsavedChanges() ?? false);
  }

  isWritePending(): boolean {
    return (
      this.submitting() ||
      (this.pictureEditor()?.isWritePending() ?? false) ||
      (this.pictureRemoval()?.isWritePending() ?? false)
    );
  }

  notifyWritePending(): void {
    if (this.submitting()) {
      this.pendingFeedback.set(true);
    }
    if (this.pictureEditor()?.isWritePending()) {
      this.pictureEditor()?.notifyWritePending();
    }
    if (this.pictureRemoval()?.isWritePending()) {
      this.pictureRemoval()?.notifyWritePending();
    }
  }

  discardUnsavedChanges(): void {
    this.discardNameChanges();
    this.pictureEditor()?.discardUnsavedChanges();
  }

  private hasUnsavedNameChanges(): boolean {
    return this.editingName() && this.hasChangedName();
  }

  private discardNameChanges(): void {
    this.editingName.set(false);
    this.nameModel.set({ name: '' });
    this.errorMessage.set(null);
    this.pendingFeedback.set(false);
  }

  protected saveName(event: Event): void {
    event.preventDefault();
    const formElement = event.currentTarget as HTMLFormElement;
    submit(this.nameForm, {
      action: async () => {
        const profile = this.profile();
        const name = this.nameModel().name.trim();
        if (profile === null || name === profile.name) {
          return undefined;
        }

        this.submitting.set(true);
        this.pendingFeedback.set(false);
        this.errorMessage.set(null);
        let revision: ProfileWriteRevision | null = null;
        try {
          revision = this.session.beginProfileWrite(['name']);
          const updated = await firstValueFrom(this.injector.get(AuthService).updateProfile(name));
          if (revision !== null) {
            this.session.applyProfileWriteUpdate(updated, revision, ['name']);
          }
          this.editingName.set(false);
          this.successMessage.set('Name updated');
          this.focusAfterRender(this.editNameAction);
          return undefined;
        } catch (error) {
          const { boundErrors, bannerMessage } = partitionServerError(
            error,
            this.serverErrorControls(),
            COULD_NOT_UPDATE_NAME,
          );
          if (boundErrors.length > 0) {
            this.nameForm().markAsTouched();
            this.focusAfterRender(this.nameInput);
          }
          if (bannerMessage !== null) {
            this.errorMessage.set(bannerMessage);
          }
          return boundErrors.length > 0 ? boundErrors : undefined;
        } finally {
          if (revision !== null) {
            this.session.releaseProfileWrite(revision, ['name']);
          }
          this.submitting.set(false);
          this.pendingFeedback.set(false);
        }
      },
    });
    if (this.nameForm().invalid()) {
      focusFirstInvalidField(formElement);
    }
  }

  protected async cancelNameEdit(): Promise<void> {
    if (this.submitting()) {
      this.pendingFeedback.set(true);
      return;
    }
    if (this.hasUnsavedNameChanges()) {
      const discard = await firstValueFrom(this.editorDismissal.confirmDiscard());
      if (!discard) {
        return;
      }
    }
    this.discardNameChanges();
    this.focusAfterRender(this.editNameAction);
  }

  private serverErrorControls(): ServerErrorControls {
    return { name: this.nameForm.name };
  }

  private focusAfterRender<T extends HTMLElement>(target: () => ElementRef<T> | undefined, select = false): void {
    runInInjectionContext(this.injector, () =>
      afterNextRender(() => {
        const element = target()?.nativeElement;
        element?.focus();
        if (select && element instanceof HTMLInputElement) {
          element.select();
        }
      }),
    );
  }
}
