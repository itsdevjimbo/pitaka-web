import { WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FieldTree } from '@angular/forms/signals';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { AuthService } from '@/app/core/auth';
import AuthForgotPassword, { RESET_LINK_REASSURANCE } from './forgot-password';

/** The slice of the component the tests reach into. */
type ForgotPasswordInternals = {
  forgotPasswordFormModel: WritableSignal<{ email: string }>;
  forgotPasswordForm: { email: FieldTree<string> };
  hasAsked: () => boolean;
  askForLink(event: Event): void;
};

/**
 * The screen's seam. What matters here is not that a request went out — the
 * adapter's spec proves that — but that this screen says exactly one thing
 * whatever came back, and that the form it says it over is still submittable
 * (ADR 0015: the always-202 is only worth anything if the client stays as
 * uninformative as the server).
 */
describe('AuthForgotPassword', () => {
  function setup(
    forgotPassword: AuthService['forgotPassword'] = () => of(undefined),
    email = 'ada@example.com'
  ) {
    TestBed.configureTestingModule({
      imports: [AuthForgotPassword],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { forgotPassword } },
      ],
    });

    const fixture = TestBed.createComponent(AuthForgotPassword);
    const cmp = fixture.componentInstance as unknown as ForgotPasswordInternals;
    cmp.forgotPasswordFormModel.set({ email });
    fixture.detectChanges();
    return { fixture, cmp };
  }

  async function submitAndSettle(
    fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void },
    cmp: ForgotPasswordInternals
  ) {
    cmp.askForLink(new Event('submit'));
    await fixture.whenStable();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function text(fixture: { nativeElement: HTMLElement }): string {
    return fixture.nativeElement.textContent ?? '';
  }

  it('asks for a link for the address that was typed', async () => {
    const forgotPassword = vi.fn(() => of(undefined));
    const { fixture, cmp } = setup(forgotPassword);

    await submitAndSettle(fixture, cmp);

    expect(forgotPassword).toHaveBeenCalledWith('ada@example.com');
  });

  it('swaps in place to the one fixed line, keeping the typed address in view', async () => {
    const { fixture, cmp } = setup();

    expect(text(fixture)).not.toContain(RESET_LINK_REASSURANCE);

    await submitAndSettle(fixture, cmp);

    expect(cmp.hasAsked()).toBe(true);
    expect(text(fixture)).toContain(RESET_LINK_REASSURANCE);
    // The form is still there: re-submitting it is this screen's resend, and
    // the address the person typed has not gone anywhere.
    expect(cmp.forgotPasswordFormModel().email).toBe('ada@example.com');
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('#email')
    ).not.toBeNull();
  });

  /**
   * The wording must not vary with what came back — the whole point of the
   * always-202 (ADR 0015). `AuthService.forgotPassword` swallows its own
   * failures, so this only reaches the component's own guard, and the assertion
   * is that the guard changes nothing the person can see.
   */
  it('says the same line when the ask fails outright', async () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const { fixture, cmp } = setup(() =>
      throwError(() => new Error('network down'))
    );

    await submitAndSettle(fixture, cmp);

    expect(text(fixture)).toContain(RESET_LINK_REASSURANCE);
    error.mockRestore();
  });

  /** A second ask is a second answer: the line does not linger over a new address. */
  it('clears the line when the address is edited, so a re-submit reads as a new ask', async () => {
    const { fixture, cmp } = setup();

    await submitAndSettle(fixture, cmp);
    expect(cmp.hasAsked()).toBe(true);

    cmp.forgotPasswordFormModel.set({ email: 'ada@example.org' });
    fixture.detectChanges();

    expect(cmp.hasAsked()).toBe(false);
    expect(text(fixture)).not.toContain(RESET_LINK_REASSURANCE);
  });

  it('does not ask on an address that is not one', async () => {
    const forgotPassword = vi.fn(() => of(undefined));
    const { fixture, cmp } = setup(forgotPassword, 'not-an-email');

    await submitAndSettle(fixture, cmp);

    expect(forgotPassword).not.toHaveBeenCalled();
    expect(cmp.hasAsked()).toBe(false);
  });
});
