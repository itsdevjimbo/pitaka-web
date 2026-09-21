import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { AuthService } from '@/app/core/auth';
import AuthForgotPassword, { RESET_LINK_REASSURANCE } from './forgot-password';

/**
 * The screen's seam. What matters here is not that a request went out — the
 * adapter's spec proves that — but that this screen says exactly one thing
 * whatever came back, and that the form it says it over is still submittable
 * (ADR 0015: the always-202 is only worth anything if the client stays as
 * uninformative as the server).
 */
describe('AuthForgotPassword', () => {
  function setup(forgotPassword: AuthService['forgotPassword'] = () => of(undefined), email = 'ada@example.com') {
    TestBed.configureTestingModule({
      imports: [AuthForgotPassword],
      providers: [provideRouter([]), { provide: AuthService, useValue: { forgotPassword } }],
    });

    const fixture = TestBed.createComponent(AuthForgotPassword);
    fixture.detectChanges();
    enterEmail(fixture, email);
    return { fixture };
  }

  async function submitAndSettle(fixture: ComponentFixture<AuthForgotPassword>) {
    (fixture.nativeElement.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function enterEmail(fixture: ComponentFixture<AuthForgotPassword>, value: string) {
    const input = fixture.nativeElement.querySelector('#email') as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function text(fixture: { nativeElement: HTMLElement }): string {
    return fixture.nativeElement.textContent ?? '';
  }

  it('asks for a link for the address that was typed', async () => {
    const forgotPassword = vi.fn(() => of(undefined));
    const { fixture } = setup(forgotPassword);

    await submitAndSettle(fixture);

    expect(forgotPassword).toHaveBeenCalledWith('ada@example.com');
  });

  it('swaps in place to the one fixed line, keeping the typed address in view', async () => {
    const { fixture } = setup();

    expect(text(fixture)).not.toContain(RESET_LINK_REASSURANCE);

    await submitAndSettle(fixture);

    expect(text(fixture)).toContain(RESET_LINK_REASSURANCE);
    // The form is still there: re-submitting it is this screen's resend, and
    // the address the person typed has not gone anywhere.
    expect((fixture.nativeElement.querySelector('#email') as HTMLInputElement).value).toBe('ada@example.com');
    expect((fixture.nativeElement as HTMLElement).querySelector('#email')).not.toBeNull();
  });

  /**
   * The wording must not vary with what came back — the whole point of the
   * always-202 (ADR 0015). `AuthService.forgotPassword` swallows its own
   * failures, so this only reaches the component's own guard, and the assertion
   * is that the guard changes nothing the person can see.
   */
  it('says the same line when the ask fails outright', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { fixture } = setup(() => throwError(() => new Error('network down')));

    await submitAndSettle(fixture);

    expect(text(fixture)).toContain(RESET_LINK_REASSURANCE);
    error.mockRestore();
  });

  /** A second ask is a second answer: the line does not linger over a new address. */
  it('clears the line when the address is edited, so a re-submit reads as a new ask', async () => {
    const { fixture } = setup();

    await submitAndSettle(fixture);
    expect(text(fixture)).toContain(RESET_LINK_REASSURANCE);

    enterEmail(fixture, 'ada@example.org');

    expect(text(fixture)).not.toContain(RESET_LINK_REASSURANCE);
  });

  it('does not ask on an address that is not one', async () => {
    const forgotPassword = vi.fn(() => of(undefined));
    const { fixture } = setup(forgotPassword, 'not-an-email');

    await submitAndSettle(fixture);

    expect(forgotPassword).not.toHaveBeenCalled();
    expect(text(fixture)).not.toContain(RESET_LINK_REASSURANCE);
  });
});
