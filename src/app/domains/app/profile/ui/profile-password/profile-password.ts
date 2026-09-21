import {
  afterNextRender,
  Component,
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
import { AuthService, IncorrectCurrentPasswordError } from '@/app/core/auth';
import { BoundServerError, partitionServerError, ServerErrorControls } from '@/app/core/forms';
import { passwordRules } from '@/app/domains/auth/password-rules';

const COULD_NOT_CHANGE_PASSWORD = 'Something went wrong changing your password. Please try again.';
const WRONG_CURRENT_PASSWORD = 'Your current password is incorrect.';
const EMPTY_PASSWORDS = {
  currentPassword: '',
  newPassword: '',
  confirmationPassword: '',
};

/** An inline, password-gated credential change for the signed-in Profile. */
@Component({
  selector: 'profile-password',
  imports: [MatButton, MatFormFieldModule, MatInputModule, FormField],
  templateUrl: './profile-password.html',
})
export class ProfilePassword {
  private readonly injector = inject(Injector);

  protected readonly editing = signal(false);
  protected readonly submitting = signal(false);
  protected readonly successMessage = signal<string | null>(null);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly model = signal({ ...EMPTY_PASSWORDS });
  private readonly currentPasswordInput = viewChild<ElementRef<HTMLInputElement>>('currentPasswordInput');
  private readonly changeAction = viewChild<ElementRef<HTMLButtonElement>>('changeAction');

  protected readonly passwordForm = form(this.model, (form) => {
    disabled(form.currentPassword, { when: () => this.submitting() });
    disabled(form.newPassword, { when: () => this.submitting() });
    disabled(form.confirmationPassword, { when: () => this.submitting() });
    validate(form.currentPassword, (context) =>
      context.value() ? undefined : { kind: 'required', message: 'Enter your current password' },
    );
    passwordRules(form.newPassword);
    validate(form.confirmationPassword, (context) => {
      if (!context.value()) {
        return { kind: 'required', message: 'Confirm your new password' };
      }
      return context.value() === this.model().newPassword
        ? undefined
        : { kind: 'match', message: 'Passwords do not match' };
    });
  });

  protected begin(): void {
    this.editing.set(true);
    this.clearSecrets();
    this.errorMessage.set(null);
    this.successMessage.set(null);
    this.focusAfterRender(this.currentPasswordInput);
  }

  protected close(): void {
    if (this.submitting()) return;
    this.editing.set(false);
    this.clearSecrets();
    this.errorMessage.set(null);
    this.focusAfterRender(this.changeAction);
  }

  protected send(event: Event): void {
    event.preventDefault();
    submit(this.passwordForm, { action: () => this.change() });
  }

  private async change(): Promise<BoundServerError[] | undefined> {
    const { currentPassword, newPassword } = this.model();
    this.submitting.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);
    try {
      await firstValueFrom(this.injector.get(AuthService).changePassword(currentPassword, newPassword));
      this.editing.set(false);
      this.clearSecrets();
      this.successMessage.set('Password changed');
      this.focusAfterRender(this.changeAction);
    } catch (error) {
      const { boundErrors, bannerMessage } = partitionServerError(
        error,
        this.serverErrorControls(),
        COULD_NOT_CHANGE_PASSWORD,
      );
      const attributedErrors =
        error instanceof IncorrectCurrentPasswordError
          ? [{ fieldTree: this.passwordForm.currentPassword, kind: 'server' as const, message: WRONG_CURRENT_PASSWORD }]
          : boundErrors;
      if (attributedErrors.length > 0) {
        this.passwordForm().markAsTouched();
        this.focusAfterRender(this.currentPasswordInput);
        return attributedErrors;
      }
      this.errorMessage.set(bannerMessage ?? COULD_NOT_CHANGE_PASSWORD);
    } finally {
      this.submitting.set(false);
    }
    return undefined;
  }

  private serverErrorControls(): ServerErrorControls {
    return {
      oldPassword: this.passwordForm.currentPassword,
      newPassword: this.passwordForm.newPassword,
    };
  }

  private clearSecrets(): void {
    this.model.set({ ...EMPTY_PASSWORDS });
  }

  private focusAfterRender<T extends HTMLElement>(target: () => ElementRef<T> | undefined): void {
    runInInjectionContext(this.injector, () => afterNextRender(() => target()?.nativeElement.focus()));
  }
}
