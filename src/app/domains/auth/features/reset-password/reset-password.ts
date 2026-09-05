import { Component, inject, linkedSignal, signal } from '@angular/core';
import { form, FormField, submit } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { ActivatedRoute } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { AuthService } from '@/app/core/auth';
import { partitionServerError, ServerErrorControls } from '@/app/core/forms';
import { Session } from '@/app/core/session';
import { passwordRules } from '../../password-rules';
import { DeadLink } from '../../ui/dead-link';

/** The banner line for a reset that failed before it could be attributed to the field. */
const COULD_NOT_RESET =
  'Something went wrong resetting your password. Please try again.';

/**
 * The screen a reset email links to (ADR 0015). Reads `userId` and `token` off
 * the query string, same as confirm-email, but does not spend them on init:
 * unlike confirming, resetting needs something only the person can supply — the
 * new password — so this screen shows a form rather than a spinner.
 *
 * Deliberately outside `guestGuard`, for the same reason confirm-email is:
 * resetting is an operation on a Profile reached by link, not a guest action a
 * live session makes meaningless, and the guard would silently destroy the
 * token before this screen ever saw it.
 */
@Component({
  selector: 'auth-reset-password',
  templateUrl: './reset-password.html',
  imports: [
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    FormField,
    DeadLink,
  ],
})
export default class AuthResetPassword {
  // Dependencies
  private auth = inject(AuthService);
  private route = inject(ActivatedRoute);
  private session = inject(Session);

  /**
   * Whether the link itself is dead: missing or malformed params up front, or
   * an undifferentiated `400` from the API once submitted. The API collapses
   * expired, already-used, tampered and simply-wrong tokens into that one
   * status (ADR 0015), so there is nothing to distinguish here — every such
   * failure lands on the same state, exactly as confirm-email's does.
   */
  protected dead = signal(false);

  private readonly userId: number | null;
  private readonly token: string | null;

  constructor() {
    const params = this.route.snapshot.queryParamMap;
    this.token = params.get('token');
    this.userId = parseUserId(params.get('userId'));
    if (this.token === null || this.token === '' || this.userId === null) {
      this.dead.set(true);
    }
  }

  // State
  protected resetFormModel = signal({ newPassword: '' });
  protected resetForm = form(this.resetFormModel, (form) => {
    // Same bounds as sign-up, sharing the one helper so the two cannot state
    // one bound and enforce another (issue #71).
    passwordRules(form.newPassword);
  });

  protected submitting = signal(false);

  /**
   * The form-level banner. Linked to the model so any edit clears it: a message
   * about a password the person has since changed is worse than none.
   */
  protected errorMessage = linkedSignal<{ newPassword: string }, string | null>({
    source: this.resetFormModel,
    computation: () => null,
  });

  resetPassword(event: Event) {
    event.preventDefault();

    submit(this.resetForm, {
      action: async () => {
        // Set by the constructor whenever the params were usable; the form is
        // only ever rendered when they were, so this call is always well-formed.
        const userId = this.userId as number;
        const token = this.token as string;

        this.submitting.set(true);
        this.errorMessage.set(null);

        const { newPassword } = this.resetFormModel();

        try {
          await firstValueFrom(this.auth.resetPassword(userId, token, newPassword));
        } catch (error) {
          const { boundErrors, bannerMessage } = partitionServerError(
            error,
            this.serverErrorControls(),
            COULD_NOT_RESET
          );

          // A weak password comes back bound to the field above; anything else
          // on a 400 is the token itself, not the password (ADR 0015) — the
          // dead-link state takes over rather than showing a banner over a form
          // that can no longer succeed.
          if (
            boundErrors.length === 0 &&
            error instanceof ApiError &&
            error.status === 400
          ) {
            this.dead.set(true);
            return undefined;
          }

          if (boundErrors.length > 0) {
            this.resetForm().markAsTouched();
          }
          if (bannerMessage !== null) {
            this.errorMessage.set(bannerMessage);
          }
          return boundErrors.length > 0 ? boundErrors : undefined;
        } finally {
          this.submitting.set(false);
        }

        // A live token survives a reset for up to an hour and the API cannot
        // revoke it (`pitaka` ADR 0011); this clears the one we control and
        // lands at sign-in, told why (ADR 0015).
        this.session.completePasswordReset();
        return undefined;
      },
    });
  }

  /** The controls a server-blamed field can bind onto — just the new password. */
  private serverErrorControls(): ServerErrorControls {
    return { password: this.resetForm.newPassword };
  }
}

/**
 * `userId` arrives as a query-string value but `ResetPasswordRequest.UserId` is
 * an `int` with no `AllowReadingFromString` on the API, exactly as
 * `ConfirmEmailRequest.UserId` is — so a string body would come back a `400`
 * this screen would otherwise render as a dead link, a lie about a perfectly
 * good one. Coerce and validate here instead, so a malformed param is caught
 * before it is ever sent, and treated as the same dead-link case a bad token
 * gets.
 */
function parseUserId(raw: string | null): number | null {
  if (raw === null || raw === '') {
    return null;
  }
  const userId = Number(raw);
  return Number.isInteger(userId) ? userId : null;
}
