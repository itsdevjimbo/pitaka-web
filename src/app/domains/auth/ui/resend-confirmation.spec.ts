import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { AuthService } from '@/app/core/auth';
import {
  RESEND_COOLDOWN_SECONDS,
  RESEND_REASSURANCE,
  ResendConfirmation,
} from './resend-confirmation';

/**
 * The control's own seam. Its three hosts — the check-your-inbox state, sign-in's
 * unconfirmed error, and the dead-link state — each render it and nothing else,
 * so the timer and the one fixed line are proved here rather than three times
 * over (ADR 0015).
 */
describe('ResendConfirmation', () => {
  function setup(
    resendConfirmation: AuthService['resendConfirmation'] = () => of(undefined)
  ) {
    TestBed.configureTestingModule({
      imports: [ResendConfirmation],
      providers: [{ provide: AuthService, useValue: { resendConfirmation } }],
    });

    const fixture = TestBed.createComponent(ResendConfirmation);
    fixture.componentRef.setInput('email', 'ada@example.com');
    fixture.detectChanges();
    return fixture;
  }

  function button(fixture: ReturnType<typeof setup>): HTMLButtonElement {
    return fixture.nativeElement.querySelector('button');
  }

  function text(fixture: ReturnType<typeof setup>): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  async function click(fixture: ReturnType<typeof setup>) {
    button(fixture).click();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  // The countdown's own timer and the clock it counts against. `setTimeout` is
  // deliberately left real: Angular's zoneless scheduler runs on it, and faking
  // it too leaves `whenStable()` waiting forever.
  beforeEach(() =>
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
  );
  afterEach(() => vi.useRealTimers());

  it('asks the service to resend to the address it was given', async () => {
    const resend = vi.fn(() => of(undefined));
    const fixture = setup(resend);

    await click(fixture);

    expect(resend).toHaveBeenCalledWith('ada@example.com');
  });

  it('says the one fixed line once the request has been made', async () => {
    const fixture = setup();

    expect(text(fixture)).not.toContain(RESEND_REASSURANCE);
    await click(fixture);

    expect(text(fixture)).toContain(RESEND_REASSURANCE);
  });

  /**
   * The same words whatever came back. Varying them would turn the control into
   * a Profile-existence oracle and undo what the API's always-202 buys — so the
   * failing case is held to the identical line, not merely to "some" message.
   */
  it('says the same line when the request fails', async () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const fixture = setup(() => throwError(() => new Error('offline')));

    await click(fixture);

    expect(text(fixture)).toContain(RESEND_REASSURANCE);
    expect(button(fixture).disabled).toBe(true);

    error.mockRestore();
  });

  it('goes quiet for the cooldown after a click, saying how long is left', async () => {
    const fixture = setup();

    await click(fixture);

    expect(button(fixture).disabled).toBe(true);
    expect(text(fixture)).toContain(`${RESEND_COOLDOWN_SECONDS}s`);

    vi.advanceTimersByTime(1_000);
    fixture.detectChanges();
    expect(text(fixture)).toContain(`${RESEND_COOLDOWN_SECONDS - 1}s`);
  });

  it('accepts clicks again once the cooldown has run out', async () => {
    const resend = vi.fn(() => of(undefined));
    const fixture = setup(resend);

    await click(fixture);
    vi.advanceTimersByTime(RESEND_COOLDOWN_SECONDS * 1_000);
    fixture.detectChanges();

    expect(button(fixture).disabled).toBe(false);
    await click(fixture);
    expect(resend).toHaveBeenCalledTimes(2);
  });

  /**
   * A backgrounded tab throttles `setInterval` to well over a second. Counting
   * down by a second per tick would stretch the stated thirty into minutes, so
   * the deadline decides and the ticks only repaint.
   */
  it('ends the cooldown on the clock, not on the tick count', async () => {
    const fixture = setup();

    await click(fixture);
    vi.setSystemTime(Date.now() + RESEND_COOLDOWN_SECONDS * 1_000);
    vi.advanceTimersByTime(1_000);
    fixture.detectChanges();

    expect(button(fixture).disabled).toBe(false);
  });

  it('sends nothing for a click made during the cooldown', async () => {
    const resend = vi.fn(() => of(undefined));
    const fixture = setup(resend);

    await click(fixture);
    vi.advanceTimersByTime(10_000);
    fixture.detectChanges();
    await click(fixture);

    expect(resend).toHaveBeenCalledTimes(1);
  });

  it('drops its timer when the control goes away', async () => {
    const fixture = setup();

    await click(fixture);
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    fixture.destroy();

    expect(vi.getTimerCount()).toBe(0);
  });
});
