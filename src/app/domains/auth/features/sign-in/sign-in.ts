import { Component, inject, signal } from '@angular/core';
import {
  email,
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
import { Session } from '@/app/core/session';

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

    submit(this.signInForm, async () => {
      this.submitting.set(true);
      this.errorMessage.set(null);

      try {
        await this.session.signIn(this.signInFormModel());
        await this.router.navigateByUrl(this.landingUrl());
      } catch (error) {
        this.errorMessage.set(this.messageFor(error));
      } finally {
        this.submitting.set(false);
      }
    });
  }

  /** Where to go once signed in: the remembered return URL, or Accounts. */
  private landingUrl(): string {
    const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
    const safe =
      returnUrl !== null &&
      returnUrl.startsWith('/') &&
      !returnUrl.startsWith('//');
    return safe ? returnUrl : DEFAULT_LANDING;
  }

  /** One clear sentence — never a raw server string or a stack trace. */
  private messageFor(error: unknown): string {
    if (error instanceof ApiError) {
      if (error.status === 401) {
        return 'That email and password do not match. Please try again.';
      }
      return error.message;
    }
    return 'Something went wrong signing you in. Please try again.';
  }
}
