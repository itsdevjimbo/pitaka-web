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
import {
  disabled,
  form,
  FormField,
  submit,
  validate,
} from '@angular/forms/signals';
import { MatButton } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '@/app/core/auth';
import { partitionServerError, ServerErrorControls } from '@/app/core/forms';
import { Session } from '@/app/core/session';

const PROFILE_NAME_MAX = 255;
const COULD_NOT_UPDATE_NAME =
  'Something went wrong updating your name. Please try again.';

/** The signed-in identity shown on the Profile page, including name editing. */
@Component({
  selector: 'profile-identity',
  imports: [MatButton, MatIcon, MatFormFieldModule, MatInputModule, FormField],
  templateUrl: './profile-identity.html',
})
export class ProfileIdentity {
  private readonly injector = inject(Injector);
  private readonly session = inject(Session);

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
  private readonly nameInput =
    viewChild<ElementRef<HTMLInputElement>>('nameInput');
  private readonly editNameAction =
    viewChild<ElementRef<HTMLButtonElement>>('editNameAction');

  protected beginNameEdit(): void {
    const profile = this.profile();
    if (profile === null) return;

    this.nameModel.set({ name: profile.name });
    this.errorMessage.set(null);
    this.successMessage.set(null);
    this.editingName.set(true);
    this.focusAfterRender(this.nameInput, true);
  }

  protected saveName(event: Event): void {
    event.preventDefault();
    submit(this.nameForm, {
      action: async () => {
        const profile = this.profile();
        const name = this.nameModel().name.trim();
        if (profile === null || name === profile.name) return undefined;

        this.submitting.set(true);
        this.errorMessage.set(null);
        try {
          const updated = await firstValueFrom(
            this.injector.get(AuthService).updateProfile(name)
          );
          this.session.applyProfileUpdate(updated);
          this.editingName.set(false);
          this.successMessage.set('Name updated');
          this.focusAfterRender(this.editNameAction);
          return undefined;
        } catch (error) {
          const { boundErrors, bannerMessage } = partitionServerError(
            error,
            this.serverErrorControls(),
            COULD_NOT_UPDATE_NAME
          );
          if (boundErrors.length > 0) {
            this.nameForm().markAsTouched();
            this.focusAfterRender(this.nameInput);
          }
          if (bannerMessage !== null) this.errorMessage.set(bannerMessage);
          return boundErrors.length > 0 ? boundErrors : undefined;
        } finally {
          this.submitting.set(false);
        }
      },
    });
  }

  protected cancelNameEdit(): void {
    if (this.submitting()) return;
    this.editingName.set(false);
    this.errorMessage.set(null);
    this.focusAfterRender(this.editNameAction);
  }

  private serverErrorControls(): ServerErrorControls {
    return { name: this.nameForm.name };
  }

  private focusAfterRender<T extends HTMLElement>(
    target: () => ElementRef<T> | undefined,
    select = false
  ): void {
    runInInjectionContext(this.injector, () =>
      afterNextRender(() => {
        const element = target()?.nativeElement;
        element?.focus();
        if (select && element instanceof HTMLInputElement) element.select();
      })
    );
  }
}
