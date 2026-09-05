import {
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { firstValueFrom, interval, map, takeWhile } from 'rxjs';
import { AuthService } from '@/app/core/auth';

/**
 * How long the button stays quiet after a click. The cooldown is honesty, not
 * security — the server is the enumeration boundary (ADR 0015). It exists so a
 * click reads as having done something: a button that keeps accepting clicks
 * implies each one sent an email.
 */
export const RESEND_COOLDOWN_SECONDS = 30;

/**
 * The one line the control says, whatever came back. The endpoint answers `202`
 * for an unknown address, an already-confirmed one and a just-sent one alike;
 * wording that varied with the outcome would put back the Profile-existence
 * oracle the always-`202` was chosen to remove (ADR 0015). It is therefore
 * phrased as a conditional the person can read either way.
 */
export const RESEND_REASSURANCE =
  'If that address still needs confirming, a new link is on its way. Check your inbox, and your spam folder.';

/**
 * The shared "send me another confirmation link" control: a button, an in-flight
 * state, one fixed line, and a cooldown. Each host passes only the email address,
 * so the request, the line and the timer all live here rather than being driven
 * three times over from the screens that render it.
 *
 * Its three hosts arrive separately — the check-your-inbox state after
 * registering, sign-in's unconfirmed error, and the dead-link state — which is
 * why the control was built and proved at its own seam first. Sign-up (#67) is
 * the first to render it; sign-in's 403 and the dead-link state still don't.
 */
@Component({
  selector: 'auth-resend-confirmation',
  templateUrl: './resend-confirmation.html',
  imports: [MatButtonModule],
})
export class ResendConfirmation {
  // Dependencies
  private auth = inject(AuthService);
  private destroyRef = inject(DestroyRef);

  /** The address to resend to. The hosts each already know it. */
  readonly email = input.required<string>();

  // State
  protected sending = signal(false);
  protected hasAsked = signal(false);
  protected remaining = signal(0);

  protected readonly reassurance = RESEND_REASSURANCE;

  /** In flight, or still inside the cooldown that follows a click. */
  protected quiet = computed(() => this.sending() || this.remaining() > 0);

  /**
   * The cooldown starts on the click rather than on the response, so a slow
   * network cannot buy extra sends, and it runs whether the request succeeded or
   * not — a failure the person is never told about must not leave the button
   * behaving differently from a success.
   */
  protected async resend(): Promise<void> {
    if (this.quiet()) {
      return;
    }

    this.sending.set(true);
    this.startCountdown();

    try {
      await firstValueFrom(this.auth.resendConfirmation(this.email()));
    } catch (error) {
      // `AuthService.resendConfirmation` swallows its own failures, so nothing
      // should reach here. The guard stays anyway: an unhandled rejection from a
      // click handler is worse than a log line, and the one thing this control
      // must never do — say something different when a send went wrong — is
      // settled here rather than left to the service keeping its promise.
      console.error('[resend-confirmation] resend failed', error);
    } finally {
      this.sending.set(false);
      this.hasAsked.set(true);
    }
  }

  /**
   * Counts down to a deadline rather than by subtracting a second per tick: a
   * backgrounded tab throttles `interval` to well over a second, and a decrement
   * per tick would silently stretch the stated thirty seconds into minutes. The
   * ticks only repaint; the deadline decides when the button comes back.
   *
   * Only ever started from a control that is not already quiet, so no run can
   * overlap another and there is no previous countdown to cancel.
   */
  private startCountdown(): void {
    const endsAt = Date.now() + RESEND_COOLDOWN_SECONDS * 1_000;
    const secondsLeft = () =>
      Math.max(0, Math.ceil((endsAt - Date.now()) / 1_000));

    this.remaining.set(secondsLeft());
    interval(1_000)
      .pipe(
        map(secondsLeft),
        takeWhile((left) => left > 0, true),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((left) => this.remaining.set(left));
  }
}
