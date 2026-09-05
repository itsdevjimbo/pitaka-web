import { Component, inject, linkedSignal, signal } from '@angular/core';
import {
  email,
  form,
  FormField,
  maxLength,
  minLength,
  required,
  submit,
} from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService, Registration } from '@/app/core/auth';
import { partitionServerError, ServerErrorControls } from '@/app/core/forms';
import { ResendConfirmation } from '@/app/domains/auth/ui/resend-confirmation';

/** The banner line for a registration that failed before it could be attributed. */
const COULD_NOT_REGISTER =
  'Something went wrong creating your profile. Please try again.';

/** The API's password bounds (`pitaka` RegisterRequest: 8–128, length only). */
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;

@Component({
  selector: 'auth-sign-up',
  templateUrl: './sign-up.html',
  imports: [
    RouterLink,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    FormField,
    ResendConfirmation,
  ],
})
export default class AuthSignUp {
  // Dependencies
  private auth = inject(AuthService);

  // State
  protected signUpFormModel = signal<Registration>({
    name: '',
    email: '',
    password: '',
  });
  protected signUpForm = form(this.signUpFormModel, (form) => {
    required(form.name, { message: 'You must enter your name' });

    required(form.email, { message: 'You must enter an email address' });
    email(form.email, { message: 'You must enter a valid email address' });

    // Mirror the API's length-only password rule so a too-short password is
    // caught here rather than after a round trip (ticket #5: client rules are
    // the only guard). No complexity check — the API deliberately has none.
    required(form.password, { message: 'You must enter a password' });
    minLength(form.password, PASSWORD_MIN, {
      message: `Your password must be at least ${PASSWORD_MIN} characters`,
    });
    maxLength(form.password, PASSWORD_MAX, {
      message: `Your password must be ${PASSWORD_MAX} characters or fewer`,
    });
  });

  protected submitting = signal(false);

  /**
   * The form-level banner. Linked to the model so any edit clears it: a message
   * about values the person has since changed is worse than none.
   */
  protected errorMessage = linkedSignal<Registration, string | null>({
    source: this.signUpFormModel,
    computation: () => null,
  });

  /**
   * The address a successful registration went to, or `null` before one has.
   * Holding it here — never in the URL, a route, or browser history — is what
   * lets the inbox state name it and seed the resend control (ADR 0015: no
   * session is established, so there is nowhere else for it to live).
   */
  protected registeredEmail = signal<string | null>(null);

  signUp(event: Event) {
    event.preventDefault();

    submit(this.signUpForm, {
      action: async () => {
        this.submitting.set(true);
        this.errorMessage.set(null);

        const registration = this.signUpFormModel();

        try {
          // Registration no longer returns a session (ADR 0015): it goes
          // straight to `AuthService`, and the inbox state below is the only
          // thing a success produces.
          await firstValueFrom(this.auth.register(registration));
        } catch (error) {
          const { boundErrors, bannerMessage } = partitionServerError(
            error,
            this.serverErrorControls(),
            COULD_NOT_REGISTER
          );
          if (boundErrors.length > 0) {
            this.signUpForm().markAsTouched();
          }
          if (bannerMessage !== null) {
            this.errorMessage.set(bannerMessage);
          }
          return boundErrors.length > 0 ? boundErrors : undefined;
        } finally {
          this.submitting.set(false);
        }

        this.registeredEmail.set(registration.email);
        return undefined;
      },
    });
  }

  /**
   * The controls a server-blamed field can bind onto. The normalizer has
   * already camelCased the PascalCase `nameof(...)` keys, so `name` / `email` /
   * `password` line up with the control names here.
   */
  private serverErrorControls(): ServerErrorControls {
    return {
      name: this.signUpForm.name,
      email: this.signUpForm.email,
      password: this.signUpForm.password,
    };
  }
}
