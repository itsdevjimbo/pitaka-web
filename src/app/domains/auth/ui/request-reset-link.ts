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
import { RESET_LINK_REASSURANCE } from '@/app/domains/auth/features/forgot-password/forgot-password';
import { RESEND_COOLDOWN_SECONDS } from './resend-confirmation';

/**
 * The shared "send me a fresh reset link" control: the reset screen's dead-link
 * fix, exactly as `ResendConfirmation` is confirm-email's. Same button, in-flight
 * state, one fixed line and cooldown shape — a sibling rather than a shared
 * component, because the two hit different endpoints (`forgotPassword` here,
 * `resendConfirmation` there) with different reassurance text (issue #71).
 */
@Component({
  selector: 'auth-request-reset-link',
  templateUrl: './request-reset-link.html',
  imports: [MatButtonModule],
})
export class RequestResetLink {
  // Dependencies
  private auth = inject(AuthService);
  private destroyRef = inject(DestroyRef);

  /** The address to ask a fresh reset link for. The hosts each already know it. */
  readonly email = input.required<string>();

  // State
  protected sending = signal(false);
  protected hasAsked = signal(false);
  protected remaining = signal(0);

  protected readonly reassurance = RESET_LINK_REASSURANCE;

  /** In flight, or still inside the cooldown that follows a click. */
  protected quiet = computed(() => this.sending() || this.remaining() > 0);

  /**
   * The cooldown starts on the click rather than on the response, so a slow
   * network cannot buy extra sends, and it runs whether the request succeeded or
   * not — a failure the person is never told about must not leave the button
   * behaving differently from a success.
   */
  protected async request(): Promise<void> {
    if (this.quiet()) {
      return;
    }

    this.sending.set(true);
    this.startCountdown();

    try {
      await firstValueFrom(this.auth.forgotPassword(this.email()));
    } catch (error) {
      // `AuthService.forgotPassword` swallows its own failures, so nothing
      // should reach here. The guard stays anyway, the same reason
      // `ResendConfirmation` keeps its own: the one thing this control must
      // never do — say something different when a send went wrong — is settled
      // here rather than left to the service keeping its promise.
      console.error('[request-reset-link] request failed', error);
    } finally {
      this.sending.set(false);
      this.hasAsked.set(true);
    }
  }

  /**
   * Counts down to a deadline rather than by subtracting a second per tick, for
   * the same reason `ResendConfirmation`'s does: a backgrounded tab throttles
   * `interval`, and a decrement per tick would silently stretch the stated
   * thirty seconds into minutes.
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
