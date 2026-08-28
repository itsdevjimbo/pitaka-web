import { Component, inject, linkedSignal, signal } from '@angular/core';
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
import { APP_HOME_ROUTE, safeReturnUrl, Session } from '@/app/core/session';

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
          await this.router.navigateByUrl(this.landingUrl());
          return undefined;
        } catch (error) {
          const boundErrors =
            error instanceof ApiError ? this.serverFieldErrors(error) : [];
          const unattributed =
            error instanceof ApiError ? this.unattributedMessages(error) : [];

          if (boundErrors.length > 0) {
            this.signInForm().markAsTouched();
          }

          // A field the server blamed that has no control here would otherwise
          // vanish, leaving "correct the highlighted fields" with nothing
          // highlighted. Say what the server said instead of nothing.
          if (unattributed.length > 0) {
            this.errorMessage.set(unattributed.join(' '));
          } else if (boundErrors.length === 0) {
            this.errorMessage.set(this.messageFor(error));
          }

          return boundErrors.length > 0 ? boundErrors : undefined;
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
    const controls = this.controlsByFieldName();
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

  /**
   * Messages the server attached to a field this form has no control for. They
   * cannot be shown under a field, and dropping them silently would leave the
   * person with a banner pointing at highlights that are not there.
   */
  private unattributedMessages(error: ApiError): string[] {
    const controls = this.controlsByFieldName();
    return Object.entries(error.fieldErrors)
      .filter(([field]) => !controls[field])
      .flatMap(([, messages]) => [...messages]);
  }

  private controlsByFieldName(): Partial<Record<string, FieldTree<string>>> {
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
