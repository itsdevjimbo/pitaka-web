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
import { Router, RouterLink } from '@angular/router';
import { Registration } from '@/app/core/auth';
import { APP_HOME_ROUTE, Session } from '@/app/core/session';
import { AuthControls, partitionAuthError } from '@/app/domains/auth/server-errors';

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
  ],
})
export default class AuthSignUp {
  // Dependencies
  private router = inject(Router);
  private session = inject(Session);

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

  signUp(event: Event) {
    event.preventDefault();

    submit(this.signUpForm, {
      action: async () => {
        this.submitting.set(true);
        this.errorMessage.set(null);

        try {
          // Registration returns a live session, so there is nothing more to
          // type — the person is signed in the moment this resolves (ticket #5).
          await this.session.register(this.signUpFormModel());
        } catch (error) {
          const { boundErrors, bannerMessage } = partitionAuthError(
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

        // Registered and signed in. A navigation hiccup from here is not a
        // registration failure — the session already exists — so it is kept out
        // of the catch above and only logged; the shell is one nav away.
        await this.router
          .navigateByUrl(APP_HOME_ROUTE)
          .catch((error: unknown) =>
            console.error('[sign-up] navigation after registration failed', error)
          );
        return undefined;
      },
    });
  }

  /**
   * The controls a server-blamed field can bind onto. The normalizer has
   * already camelCased the PascalCase `nameof(...)` keys, so `name` / `email` /
   * `password` line up with the control names here.
   */
  private serverErrorControls(): AuthControls {
    return {
      name: this.signUpForm.name,
      email: this.signUpForm.email,
      password: this.signUpForm.password,
    };
  }
}
