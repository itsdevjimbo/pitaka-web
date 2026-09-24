import { NgTemplateOutlet } from '@angular/common';
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
import { disabled, form, FormField, required, submit, validate } from '@angular/forms/signals';
import { MatButton } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { firstValueFrom } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { AuthService } from '@/app/core/auth';
import { EditorDismissal } from '@/app/core/dialog';
import {
  focusFirstInvalidField,
  partitionServerError,
  type BoundServerError,
  type ServerErrorControls,
} from '@/app/core/forms';
import { Session } from '@/app/core/session';

const EMAIL_MAX = 255;
const COULD_NOT_CHANGE_EMAIL = 'Something went wrong changing your email. Please try again.';
type EmailMode = 'closed' | 'request' | 'resend' | 'cancel';

/** The Profile email-change flow, including the durable pending-change state. */
@Component({
  selector: 'profile-email',
  imports: [NgTemplateOutlet, MatButton, MatFormFieldModule, MatInputModule, FormField],
  templateUrl: './profile-email.html',
})
export class ProfileEmail {
  private readonly injector = inject(Injector);
  private readonly session = inject(Session);
  private readonly editorDismissal = inject(EditorDismissal);

  protected readonly profile = this.session.profile;
  protected readonly mode = signal<EmailMode>('closed');
  protected readonly model = signal({ newEmail: '', currentPassword: '' });
  protected readonly submitting = signal(false);
  protected readonly successMessage = signal<string | null>(null);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly pendingFeedback = signal(false);
  protected readonly refreshing = signal(false);
  protected readonly refreshNeeded = signal(false);
  /** Keeps a truthful post-write presentation while the required reread retries. */
  protected readonly localPendingEmail = signal<string | null | undefined>(undefined);
  private readonly newEmailInput = viewChild<ElementRef<HTMLInputElement>>('newEmailInput');
  private readonly passwordInput = viewChild<ElementRef<HTMLInputElement>>('passwordInput');
  private readonly changeAction = viewChild<ElementRef<HTMLButtonElement>>('changeAction');
  private readonly resendAction = viewChild<ElementRef<HTMLButtonElement>>('resendAction');
  private readonly cancelAction = viewChild<ElementRef<HTMLButtonElement>>('cancelAction');
  private readonly keepAction = viewChild<ElementRef<HTMLButtonElement>>('keepAction');

  protected readonly emailForm = form(this.model, (form) => {
    disabled(form.newEmail, { when: () => this.submitting() });
    disabled(form.currentPassword, { when: () => this.submitting() });
    required(form.newEmail, { message: 'Enter an email address', when: () => this.mode() !== 'resend' });
    validate(form.newEmail, (context) => {
      if (this.mode() === 'resend') {
        return undefined;
      }
      const value = context.value().trim();
      if (value.length > EMAIL_MAX) {
        return { kind: 'maxLength', message: `The email address must be ${EMAIL_MAX} characters or fewer` };
      }
      if (!/^\S+@\S+\.\S+$/.test(value)) {
        return { kind: 'email', message: 'Enter a valid email address' };
      }
      if (value.toLocaleLowerCase() === this.profile()?.email.toLocaleLowerCase()) {
        return { kind: 'unchanged', message: 'This is already your email address' };
      }
      if (value.toLocaleLowerCase() === this.pendingEmail()?.toLocaleLowerCase()) {
        return {
          kind: 'pending',
          message: 'This address is already awaiting confirmation. Use Send another link instead.',
        };
      }
      return undefined;
    });
    required(form.currentPassword, { message: 'Enter your current password' });
  });

  protected pendingEmail(): string | null {
    const localPendingEmail = this.localPendingEmail();
    return localPendingEmail === undefined ? (this.profile()?.pendingEmail ?? null) : localPendingEmail;
  }

  hasUnsavedChanges(): boolean {
    if (this.mode() !== 'request' && this.mode() !== 'resend') {
      return false;
    }
    return this.model().newEmail.length > 0 || this.model().currentPassword.length > 0;
  }

  isWritePending(): boolean {
    return this.submitting();
  }

  notifyWritePending(): void {
    this.pendingFeedback.set(true);
  }

  discardUnsavedChanges(): void {
    this.model.set({ newEmail: '', currentPassword: '' });
    this.mode.set('closed');
    this.errorMessage.set(null);
    this.pendingFeedback.set(false);
  }

  protected beginRequest(): void {
    this.begin('request');
    this.focusAfterRender(this.newEmailInput);
  }

  protected beginResend(): void {
    this.begin('resend');
    this.focusAfterRender(this.passwordInput);
  }

  protected beginCancel(): void {
    this.begin('cancel');
    this.focusAfterRender(this.keepAction);
  }

  protected close(): void {
    if (this.submitting()) {
      this.pendingFeedback.set(true);
      return;
    }
    this.closeEditor();
  }

  protected async requestClose(): Promise<void> {
    if (this.submitting()) {
      this.pendingFeedback.set(true);
      return;
    }
    if (this.hasUnsavedChanges()) {
      const discard = await firstValueFrom(this.editorDismissal.confirmDiscard());
      if (!discard) {
        return;
      }
    }
    this.closeEditor();
  }

  private closeEditor(): void {
    this.mode.set('closed');
    this.model.set({ newEmail: '', currentPassword: '' });
    this.errorMessage.set(null);
    this.pendingFeedback.set(false);
    this.focusAfterRender(this.pendingEmail() ? this.cancelAction : this.changeAction);
  }

  protected send(event: Event): void {
    event.preventDefault();
    const formElement = event.currentTarget as HTMLFormElement;
    submit(this.emailForm, { action: () => this.performRequest() });
    if (this.emailForm().invalid()) {
      focusFirstInvalidField(formElement);
    }
  }

  protected cancelChange(): void {
    if (this.submitting()) {
      this.pendingFeedback.set(true);
      return;
    }
    this.submitting.set(true);
    this.pendingFeedback.set(false);
    this.errorMessage.set(null);
    this.successMessage.set(null);
    firstValueFrom(this.injector.get(AuthService).cancelEmailChange())
      .then(() => {
        this.localPendingEmail.set(null);
        this.mode.set('closed');
        this.successMessage.set('Email change cancelled');
        this.focusAfterRender(this.changeAction);
        return this.reconcile();
      })
      .catch(() => this.errorMessage.set('Something went wrong cancelling your email change. Please try again.'))
      .finally(() => {
        this.submitting.set(false);
        this.pendingFeedback.set(false);
      });
  }

  protected retryRefresh(): void {
    if (this.refreshing()) {
      return;
    }
    this.errorMessage.set(null);
    void this.reconcile();
  }

  private async performRequest(): Promise<BoundServerError[] | undefined> {
    const isResend = this.mode() === 'resend';
    const pending = this.pendingEmail();
    const newEmail = isResend ? pending : this.model().newEmail.trim();
    if (!newEmail) {
      return undefined;
    }

    this.submitting.set(true);
    this.pendingFeedback.set(false);
    this.errorMessage.set(null);
    this.successMessage.set(null);
    try {
      await firstValueFrom(this.injector.get(AuthService).requestEmailChange(newEmail, this.model().currentPassword));
      this.localPendingEmail.set(newEmail);
      this.mode.set('closed');
      this.model.set({ newEmail: '', currentPassword: '' });
      this.successMessage.set(
        isResend ? `Another confirmation email sent to ${newEmail}` : `Confirmation email sent to ${newEmail}`,
      );
      this.focusAfterRender(this.resendAction);
      await this.reconcile();
    } catch (error) {
      const { boundErrors, bannerMessage } = partitionServerError(
        error,
        this.serverErrorControls(),
        COULD_NOT_CHANGE_EMAIL,
      );
      const attributedErrors =
        error instanceof ApiError && error.status === 401
          ? [
              {
                fieldTree: this.emailForm.currentPassword,
                kind: 'server' as const,
                message: 'Your current password is incorrect.',
              },
            ]
          : error instanceof ApiError && error.status === 409
            ? [
                {
                  fieldTree: this.emailForm.newEmail,
                  kind: 'server' as const,
                  message: 'That email address is already in use. Choose a different address.',
                },
              ]
            : boundErrors;
      if (attributedErrors.length > 0) {
        this.emailForm().markAsTouched();
        this.focusAfterRender(
          error instanceof ApiError && error.status === 401 ? this.passwordInput : this.newEmailInput,
        );
        return attributedErrors;
      } else {
        this.errorMessage.set(bannerMessage ?? COULD_NOT_CHANGE_EMAIL);
      }
    } finally {
      this.submitting.set(false);
      this.pendingFeedback.set(false);
    }
    return undefined;
  }

  private async reconcile(): Promise<void> {
    if (this.refreshing()) {
      return;
    }
    this.refreshing.set(true);
    try {
      const profile = await firstValueFrom(this.injector.get(AuthService).me());
      this.session.applyProfileUpdate(profile);
      this.localPendingEmail.set(undefined);
      this.refreshNeeded.set(false);
    } catch {
      this.refreshNeeded.set(true);
    } finally {
      this.refreshing.set(false);
    }
  }

  private begin(mode: EmailMode): void {
    this.mode.set(mode);
    this.model.set({ newEmail: '', currentPassword: '' });
    this.errorMessage.set(null);
    this.successMessage.set(null);
    this.pendingFeedback.set(false);
  }

  private serverErrorControls(): ServerErrorControls {
    return { newEmail: this.emailForm.newEmail, currentPassword: this.emailForm.currentPassword };
  }

  private focusAfterRender<T extends HTMLElement>(target: () => ElementRef<T> | undefined): void {
    runInInjectionContext(this.injector, () =>
      afterNextRender(() => {
        const element = target()?.nativeElement;
        element?.focus();
      }),
    );
  }
}
