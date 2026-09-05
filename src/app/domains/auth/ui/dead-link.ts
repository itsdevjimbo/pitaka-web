import { Component, input, signal } from '@angular/core';
import { email, form, FormField, required } from '@angular/forms/signals';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { RequestResetLink } from './request-reset-link';
import { ResendConfirmation } from './resend-confirmation';

/**
 * Where expired, already-used, tampered, and malformed-URL links all land.
 * The API collapses every one of those causes into a single undifferentiated
 * `400`, and security-stamp rotation means using one link kills its siblings
 * (`pitaka` ADR 0013), so naming a cause here would often be a lie. Say the
 * link is no longer valid, offer no diagnosis, and offer the action that fixes
 * it — worded as a routine destination rather than an apology, since the
 * shared one-hour token lifespan (`pitaka` `IdentityExtensions`) makes this the
 * ordinary result of opening an email the next morning (ADR 0015).
 *
 * Shared between confirm-email and the reset screen (#71); `kind` picks which
 * one of them the "fix" is, since the two links are spent by different
 * endpoints. Neither host reaches this state already knowing an email address
 * the way sign-up's check-your-inbox state or sign-in's unconfirmed error do,
 * so it asks for one itself before revealing the fix — a link this stale
 * carries no address to prefill from.
 */
@Component({
  selector: 'auth-dead-link',
  templateUrl: './dead-link.html',
  imports: [
    MatFormFieldModule,
    MatInputModule,
    FormField,
    RequestResetLink,
    ResendConfirmation,
  ],
})
export class DeadLink {
  /** Which link this is standing in for, and so which endpoint the fix spends. */
  readonly kind = input<'confirm-email' | 'reset-password'>('confirm-email');

  protected emailFormModel = signal({ email: '' });
  protected emailForm = form(this.emailFormModel, (form) => {
    required(form.email, { message: 'You must enter an email address' });
    email(form.email, { message: 'You must enter a valid email address' });
  });
}
