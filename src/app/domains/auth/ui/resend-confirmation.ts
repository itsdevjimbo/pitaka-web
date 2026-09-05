import {
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { firstValueFrom } from 'rxjs';
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
 * The shared "send me another confirmation link" control. Three screens host it
 * — the check-your-inbox state after registering, sign-in's unconfirmed error,
 * and the dead-link state — and each passes only the email address; the request,
 * the fixed line and the cooldown timer all live here, at the control's own
 * seam, rather than being driven three times over from the hosts.
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
  protected asked = signal(false);
  protected remaining = signal(0);

  protected readonly reassurance = RESEND_REASSURANCE;

  /** In flight, or still inside the cooldown that follows a click. */
  protected quiet = computed(() => this.sending() || this.remaining() > 0);

  private countdown: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.destroyRef.onDestroy(() => this.stopCountdown());
  }

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
      // `AuthService.resendConfirmation` already swallows its own failures, so
      // reaching here means something else broke. Logged, never shown: the line
      // below is the same either way.
      console.error('[resend-confirmation] resend failed', error);
    } finally {
      this.sending.set(false);
      this.asked.set(true);
    }
  }

  private startCountdown(): void {
    this.stopCountdown();
    this.remaining.set(RESEND_COOLDOWN_SECONDS);
    this.countdown = setInterval(() => {
      const left = this.remaining() - 1;
      this.remaining.set(left);
      if (left <= 0) {
        this.stopCountdown();
      }
    }, 1_000);
  }

  private stopCountdown(): void {
    if (this.countdown !== null) {
      clearInterval(this.countdown);
      this.countdown = null;
    }
  }
}
