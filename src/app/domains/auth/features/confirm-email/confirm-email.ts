import { Component, inject, OnInit, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '@/app/core/auth';
import {
  APP_HOME_ROUTE,
  reasonQueryParams,
  Session,
  SIGN_IN_ROUTE,
} from '@/app/core/session';
import { DeadLink } from '../../ui/dead-link';

/**
 * The screen a confirmation email links to (ADR 0015). Reads `userId` and
 * `token` off the query string, fires the confirm on init, and branches on
 * session state once it resolves — a live session is left alone and sent into
 * the app, and a signed-out visitor is sent to sign-in already told.
 *
 * Deliberately outside `guestGuard` (see `routes.ts`): confirming is an
 * operation on a Profile reached by link, not a guest action a live session
 * makes meaningless, and the guard would silently destroy the token the
 * person came to spend before this screen ever saw it.
 *
 * No click-through button: firing the `POST` from script rather than waiting
 * for a click means a mail scanner or link previewer's `GET`/`HEAD` cannot
 * spend the token, so the defence a button would add is not needed.
 */
@Component({
  selector: 'auth-confirm-email',
  templateUrl: './confirm-email.html',
  imports: [MatIconModule, DeadLink],
})
export default class AuthConfirmEmail implements OnInit {
  // Dependencies
  private auth = inject(AuthService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private session = inject(Session);

  /**
   * Whether the link is being treated as dead: missing or malformed params, or
   * a `400` from the API. The API collapses expired, already-used, tampered,
   * and simply-wrong tokens into that one status, so there is nothing to
   * distinguish here (ADR 0015) — every failure lands on the same state.
   */
  protected dead = signal(false);

  /**
   * Guards the confirm from firing more than once. Tokens are single-use, so a
   * second `POST` from the same visit would only turn a link that just worked
   * into a dead one.
   */
  private requested = false;

  async ngOnInit(): Promise<void> {
    if (this.requested) {
      return;
    }
    this.requested = true;

    const params = this.route.snapshot.queryParamMap;
    const token = params.get('token');
    const userId = parseUserId(params.get('userId'));

    if (token === null || token === '' || userId === null) {
      this.dead.set(true);
      return;
    }

    try {
      await firstValueFrom(this.auth.confirmEmail(userId, token));
    } catch (error) {
      console.warn('[confirm-email] confirmation failed', error);
      this.dead.set(true);
      return;
    }

    // Confirmed. A navigation hiccup from here is not a confirmation failure —
    // the Profile is already confirmed — so it is only logged.
    await this.landingNavigation().catch((error: unknown) =>
      console.error('[confirm-email] navigation after confirmation failed', error)
    );
  }

  /**
   * Where to go once confirmed: someone already signed in needs no sign-in
   * form and must not be signed out to be shown one, so they go straight into
   * the app; everyone else goes to sign-in, told why they are back.
   */
  private landingNavigation(): Promise<boolean> {
    if (this.session.isAuthenticated()) {
      return this.router.navigateByUrl(APP_HOME_ROUTE);
    }
    return this.router.navigate([SIGN_IN_ROUTE], {
      queryParams: reasonQueryParams('email-confirmed'),
    });
  }
}

/**
 * `userId` arrives as a query-string value but `ConfirmEmailRequest.UserId` is
 * an `int` with no `AllowReadingFromString` on the API, so a string body would
 * come back a `400` this screen would otherwise render as a dead link — a lie
 * about a perfectly good one. Coerce and validate here instead, so a malformed
 * param is caught before it is ever sent, and treated as the same dead-link
 * case a bad token gets.
 */
function parseUserId(raw: string | null): number | null {
  if (raw === null || raw === '') {
    return null;
  }
  const userId = Number(raw);
  return Number.isInteger(userId) ? userId : null;
}
