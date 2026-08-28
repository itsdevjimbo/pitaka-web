import { Component, inject, signal } from '@angular/core';
import {
  email,
  FieldTree,
  form,
  FormField,
  required,
  submit,
} from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiError } from '@/app/core/api';
import { safeReturnUrl, Session } from '@/app/core/session';

const DEFAULT_LANDING = '/app';

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
  protected errorMessage = signal<string | null>(null);

  signIn(event: Event) {
    event.preventDefault();

    submit(this.signInForm, {
      action: async () => {
        this.submitting.set(true);
        this.errorMessage.set(null);

        try {
          await this.session.signIn(this.signInFormModel());
          await this.router.navigateByUrl(this.landingUrl());
          return undefined;
        } catch (error) {
          const fieldErrors =
            error instanceof ApiError ? this.serverFieldErrors(error) : [];
          if (fieldErrors.length > 0) {
            this.signInForm().markAsTouched();
            return fieldErrors;
          }
          this.errorMessage.set(this.messageFor(error));
          return undefined;
        } finally {
          this.submitting.set(false);
        }
      },
    });
  }

  /**
   * The messages the server attached to specific fields, bound onto the matching
   * form controls so they surface under the field. The normalizer has already
   * camelCased the PascalCase `nameof(...)` keys, so `email` / `password` line
   * up with the control names here.
   */
  private serverFieldErrors(error: ApiError) {
    const controls: Partial<Record<string, FieldTree<string>>> = {
      email: this.signInForm.email,
      password: this.signInForm.password,
    };
    return Object.entries(error.fieldErrors).flatMap(([field, messages]) => {
      const control = controls[field];
      return control
        ? messages.map((message) => ({
            fieldTree: control,
            kind: 'server',
            message,
          }))
        : [];
    });
  }

  /** Where to go once signed in: the remembered return URL, or the app home. */
  private landingUrl(): string {
    const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
    return safeReturnUrl(returnUrl) ?? DEFAULT_LANDING;
  }

  /**
   * One clear sentence for the form-level banner. The adapter has already
   * normalised every failure shape into a display-ready message (ADR 0002 —
   * nothing above the adapter branches on transport detail), so an `ApiError`
   * is surfaced as-is; only a non-API throw needs a fallback here.
   */
  private messageFor(error: unknown): string {
    if (error instanceof ApiError) {
      return error.message;
    }
    return 'Something went wrong signing you in. Please try again.';
  }
}
