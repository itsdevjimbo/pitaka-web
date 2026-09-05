import { Component, inject, linkedSignal, signal } from '@angular/core';
import {
  email,
  form,
  FormField,
  required,
  submit,
} from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '@/app/core/auth';

/**
 * The one line this screen says, whatever came back. `POST /api/auth/forgot-password`
 * answers `202` for an address with a Profile and one without alike; saying
 * "we've sent you a link" only when the address exists would turn this form into
 * a Profile-existence oracle, which is exactly what the always-`202` is buying
 * (ADR 0015). It is therefore phrased as a conditional the person reads either
 * way — the same bargain, and the same shape, as `RESEND_REASSURANCE`.
 */
export const RESET_LINK_REASSURANCE =
  'If that email is registered, a link to reset your password is on its way. Check your inbox, and your spam folder.';

/**
 * Where someone who cannot get past sign-in asks for a way back into their
 * Profile. Sign-in links here beside its password field.
 *
 * The screen swaps in place rather than navigating: the line appears above the
 * form the person just used, which keeps the address they typed in view and
 * leaves re-submitting available. That re-submit *is* the resend — there is no
 * separate resend control here, because unlike the confirmation link there is
 * nothing a second button could do that the form does not already do.
 */
@Component({
  selector: 'auth-forgot-password',
  templateUrl: './forgot-password.html',
  imports: [
    RouterLink,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    FormField,
  ],
})
export default class AuthForgotPassword {
  // Dependencies
  private auth = inject(AuthService);

  // State
  protected forgotPasswordFormModel = signal({ email: '' });
  protected forgotPasswordForm = form(this.forgotPasswordFormModel, (form) => {
    // Mirrors sign-in's email rules: the address is the same address, and being
    // stricter here than at the field the person just failed at would be odd.
    required(form.email, { message: 'You must enter an email address' });
    email(form.email, { message: 'You must enter a valid email address' });
  });

  protected submitting = signal(false);

  /**
   * Whether the ask has been made. Linked to the model so editing the address
   * clears it: a line about the address the person has since changed would read
   * as an answer about the new one.
   */
  protected hasAsked = linkedSignal<{ email: string }, boolean>({
    source: this.forgotPasswordFormModel,
    computation: () => false,
  });

  protected readonly reassurance = RESET_LINK_REASSURANCE;

  askForLink(event: Event) {
    event.preventDefault();

    submit(this.forgotPasswordForm, {
      action: async () => {
        this.submitting.set(true);

        // The address as it stood when the ask went out. Editing the field
        // mid-flight clears `hasAsked`, and the line must not come back over an
        // address this request was never about.
        const askedFor = this.forgotPasswordFormModel().email;

        try {
          await firstValueFrom(this.auth.forgotPassword(askedFor));
        } catch (error) {
          // `AuthService.forgotPassword` swallows its own failures, so nothing
          // should reach here. The guard stays anyway: an unhandled rejection
          // from a submit handler is worse than a log line, and the one thing
          // this screen must never do — say something different when a send went
          // wrong — is settled here rather than left to the service keeping its
          // promise.
          console.error('[forgot-password] ask for a reset link failed', error);
        } finally {
          this.submitting.set(false);
        }

        if (this.forgotPasswordFormModel().email === askedFor) {
          this.hasAsked.set(true);
        }

        return undefined;
      },
    });
  }
}
