import { Component, inject, linkedSignal, signal } from '@angular/core';
import { email, form, FormField, required, submit } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { APP_HOME_ROUTE, safeReturnUrl, Session } from '@/app/core/session';
import { AuthControls, partitionAuthError } from '@/app/domains/auth/server-errors';

/** The banner line for a sign-in that failed before it could be attributed. */
const COULD_NOT_SIGN_IN =
  'Something went wrong signing you in. Please try again.';

@Component({
  selector: 'auth-sign-in',
  templateUrl: './sign-in.html',
  imports: [
    RouterLink,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    FormField,
  ],
})
export default class AuthSignIn {
  // Dependencies
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private session = inject(Session);

  // State
  protected signInFormModel = signal({
    email: '',
    password: '',
  });
  protected signInForm = form(this.signInFormModel, (form) => {
    required(form.email, { message: 'You must enter an email address' });
    email(form.email, { message: 'You must enter a valid email address' });

    required(form.password, { message: 'You must enter a password' });
  });

  protected submitting = signal(false);

  /**
   * The form-level banner. Linked to the model so any edit clears it: a message
   * about the values the person has since changed is worse than none.
   */
  protected errorMessage = linkedSignal<
    { email: string; password: string },
    string | null
  >({
    source: this.signInFormModel,
    computation: () => null,
  });

  signIn(event: Event) {
    event.preventDefault();

    submit(this.signInForm, {
      action: async () => {
        this.submitting.set(true);
        this.errorMessage.set(null);

        try {
          await this.session.signIn(this.signInFormModel());
        } catch (error) {
          const { boundErrors, bannerMessage } = partitionAuthError(
            error,
            this.serverErrorControls(),
            COULD_NOT_SIGN_IN
          );
          if (boundErrors.length > 0) {
            this.signInForm().markAsTouched();
          }
          if (bannerMessage !== null) {
            this.errorMessage.set(bannerMessage);
          }
          return boundErrors.length > 0 ? boundErrors : undefined;
        } finally {
          this.submitting.set(false);
        }

        // Signed in. A navigation hiccup from here is not a sign-in failure —
        // the session already exists — so it is kept out of the catch above and
        // only logged; the shell is one nav away.
        await this.router
          .navigateByUrl(this.landingUrl())
          .catch((error: unknown) =>
            console.error('[sign-in] navigation after sign-in failed', error)
          );
        return undefined;
      },
    });
  }

  /**
   * The controls a server-blamed field can bind onto. The normalizer has
   * already camelCased the PascalCase `nameof(...)` keys, so `email` /
   * `password` line up with the control names here.
   */
  private serverErrorControls(): AuthControls {
    return {
      email: this.signInForm.email,
      password: this.signInForm.password,
    };
  }

  /** Where to go once signed in: the remembered return URL, or the app home. */
  private landingUrl(): string {
    const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
    return safeReturnUrl(returnUrl) ?? APP_HOME_ROUTE;
  }
}
