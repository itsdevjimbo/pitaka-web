import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { AuthService } from '@/app/core/auth';
import { RESET_LINK_REASSURANCE } from '@/app/domains/auth/features/forgot-password/forgot-password';
import { RequestResetLink } from './request-reset-link';
import { RESEND_COOLDOWN_SECONDS } from './resend-confirmation';

/**
 * The control's own seam, a sibling of `ResendConfirmation`'s (issue #71): same
 * button, in-flight state, one fixed line, and cooldown, but hitting
 * `forgotPassword` rather than `resendConfirmation`.
 */
describe('RequestResetLink', () => {
  function setup(
    forgotPassword: AuthService['forgotPassword'] = () => of(undefined)
  ) {
    TestBed.configureTestingModule({
      imports: [RequestResetLink],
      providers: [{ provide: AuthService, useValue: { forgotPassword } }],
    });

    const fixture = TestBed.createComponent(RequestResetLink);
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

  beforeEach(() =>
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
  );
  afterEach(() => vi.useRealTimers());

  it('asks the service for a fresh reset link to the address it was given', async () => {
    const forgotPassword = vi.fn(() => of(undefined));
    const fixture = setup(forgotPassword);

    await click(fixture);

    expect(forgotPassword).toHaveBeenCalledWith('ada@example.com');
  });

  it('says the one fixed line once the request has been made', async () => {
    const fixture = setup();

    expect(text(fixture)).not.toContain(RESET_LINK_REASSURANCE);
    await click(fixture);

    expect(text(fixture)).toContain(RESET_LINK_REASSURANCE);
  });

  it('says the same line when the request fails', async () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const fixture = setup(() => throwError(() => new Error('offline')));

    await click(fixture);

    expect(text(fixture)).toContain(RESET_LINK_REASSURANCE);
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
    const forgotPassword = vi.fn(() => of(undefined));
    const fixture = setup(forgotPassword);

    await click(fixture);
    vi.advanceTimersByTime(RESEND_COOLDOWN_SECONDS * 1_000);
    fixture.detectChanges();

    expect(button(fixture).disabled).toBe(false);
    await click(fixture);
    expect(forgotPassword).toHaveBeenCalledTimes(2);
  });
});
