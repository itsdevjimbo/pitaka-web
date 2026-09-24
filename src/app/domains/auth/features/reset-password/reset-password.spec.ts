import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { AuthService, ResetLinkRejectedError } from '@/app/core/auth';
import { provideIcons } from '@/app/core/icons';
import { Session } from '@/app/core/session';
import AuthResetPassword from './reset-password';

/**
 * The reset-password screen's own seam (ADR 0015). Unlike confirm-email, it
 * does not spend the link on init — it needs a new password only the person
 * can supply — so what matters here is: a well-formed link shows the form, a
 * malformed one lands on the shared dead-link state without ever calling the
 * API, a submitted weak password surfaces under the field, and anything else
 * on a 400 (the token itself) lands on the dead-link state instead of a
 * banner over a form that can no longer succeed. A clean success clears the
 * local session and lands at sign-in, told why.
 */
describe('AuthResetPassword', () => {
  function setup(
    queryParams: Record<string, string>,
    {
      resetPassword = () => of(undefined),
    }: {
      resetPassword?: AuthService['resetPassword'];
    } = {},
  ) {
    const completePasswordReset = vi.fn();

    TestBed.configureTestingModule({
      imports: [AuthResetPassword],
      providers: [
        provideIcons(),
        { provide: AuthService, useValue: { resetPassword } },
        { provide: Session, useValue: { completePasswordReset } },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { queryParamMap: convertToParamMap(queryParams) },
          },
        },
      ],
    });

    const fixture = TestBed.createComponent(AuthResetPassword);
    fixture.detectChanges();
    return { fixture, completePasswordReset, resetPassword };
  }

  async function submitAndSettle(fixture: ComponentFixture<AuthResetPassword>) {
    (fixture.nativeElement.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function enterPassword(fixture: ComponentFixture<AuthResetPassword>, value: string) {
    const input = fixture.nativeElement.querySelector('#new-password') as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function text(fixture: { nativeElement: HTMLElement }): string {
    return fixture.nativeElement.textContent ?? '';
  }

  it('shows the new-password form for a well-formed link', () => {
    const { fixture } = setup({ userId: '7', token: 'a-token' });

    expect((fixture.nativeElement as HTMLElement).querySelector('#new-password')).not.toBeNull();
    expect(text(fixture)).not.toContain('This link is no longer valid');
  });

  it('focuses the page heading when opened from a valid reset link', async () => {
    const { fixture } = setup({ userId: '7', token: 'a-token' });
    await fixture.whenStable();

    expect(document.activeElement).toBe(fixture.nativeElement.querySelector('#reset-password-heading'));
  });

  it('keeps invalid Submit enabled, shows the password error, and focuses it without sending', async () => {
    const resetPassword = vi.fn(() => of(undefined));
    const { fixture } = setup({ userId: '7', token: 'a-token' }, { resetPassword });
    enterPassword(fixture, 'short');
    const button = fixture.nativeElement.querySelector('button[type="submit"]') as HTMLButtonElement;

    expect(button.disabled).toBe(false);
    await submitAndSettle(fixture);

    expect(text(fixture)).toContain('Your password must be at least 8 characters');
    expect(document.activeElement).toBe(fixture.nativeElement.querySelector('#new-password'));
    expect(resetPassword).not.toHaveBeenCalled();
  });

  it('reveals and hides the password through an accessible control', () => {
    const { fixture } = setup({ userId: '7', token: 'a-token' });
    const password = fixture.nativeElement.querySelector('#new-password') as HTMLInputElement;
    const showPassword = fixture.nativeElement.querySelector(
      'button[aria-label="Show password"]',
    ) as HTMLButtonElement | null;

    expect(showPassword).not.toBeNull();
    expect(showPassword?.getAttribute('aria-controls')).toBe('new-password');
    showPassword?.click();
    fixture.detectChanges();

    expect(password.type).toBe('text');
    const hidePassword = fixture.nativeElement.querySelector(
      'button[aria-label="Hide password"]',
    ) as HTMLButtonElement | null;
    expect(hidePassword).not.toBeNull();
    hidePassword?.click();
    fixture.detectChanges();

    expect(password.type).toBe('password');
  });

  it('announces a pending reset and ignores duplicate submissions until it settles', async () => {
    const pendingReset = new Subject<void>();
    const resetPassword = vi.fn(() => pendingReset.asObservable());
    const { fixture } = setup({ userId: '7', token: 'a-token' }, { resetPassword });
    enterPassword(fixture, 'a-new-password');
    const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;

    form.dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    expect(resetPassword).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.querySelector('button[type="submit"]').disabled).toBe(true);
    expect(fixture.nativeElement.querySelector('[role="status"]')?.textContent).toContain('Setting your password');

    form.dispatchEvent(new Event('submit'));
    expect(resetPassword).toHaveBeenCalledTimes(1);

    pendingReset.next();
    pendingReset.complete();
    await fixture.whenStable();
  });

  it('lands on the dead-link state for a missing token, without calling the API', () => {
    const resetPassword = vi.fn(() => of(undefined));
    const { fixture } = setup({ userId: '7' }, { resetPassword });

    expect(resetPassword).not.toHaveBeenCalled();
    expect(text(fixture)).toContain('This link is no longer valid');
  });

  /**
   * `ResetPasswordRequest.UserId` is an `int` with no `AllowReadingFromString`
   * on the API, exactly as `ConfirmEmailRequest.UserId` is, so a non-numeric
   * userId is caught here before it is ever sent.
   */
  it('lands on the dead-link state for a non-integer userId, without calling the API', () => {
    const resetPassword = vi.fn(() => of(undefined));
    const { fixture } = setup({ userId: 'not-a-number', token: 'a-token' }, { resetPassword });

    expect(resetPassword).not.toHaveBeenCalled();
    expect(text(fixture)).toContain('This link is no longer valid');
  });

  it('resets with the userId coerced to a number, the token as given, and the typed password', async () => {
    const resetPassword = vi.fn(() => of(undefined));
    const { fixture } = setup({ userId: '7', token: 'a-token' }, { resetPassword });
    enterPassword(fixture, 'a-new-password');

    await submitAndSettle(fixture);

    expect(resetPassword).toHaveBeenCalledWith(7, 'a-token', 'a-new-password');
  });

  it('clears the local session and lands at sign-in on a clean reset', async () => {
    const { fixture, completePasswordReset } = setup({
      userId: '7',
      token: 'a-token',
    });
    enterPassword(fixture, 'a-new-password');

    await submitAndSettle(fixture);

    expect(completePasswordReset).toHaveBeenCalled();
  });

  it('shows a server-rejected password bound to the field, not the dead-link state', async () => {
    const { fixture, completePasswordReset } = setup(
      { userId: '7', token: 'a-token' },
      {
        resetPassword: () =>
          throwError(
            () =>
              new ApiError('Please correct the highlighted fields and try again.', 400, {
                password: ['The field Password must be a string with a minimum length of 8.'],
              }),
          ),
      },
    );
    // Long enough to pass the client's own minLength(8), so the failure
    // reaching the component is the server's alone.
    enterPassword(fixture, 'a-new-password');

    await submitAndSettle(fixture);

    expect(text(fixture)).toContain('The field Password must be a string with a minimum length of 8.');
    expect(text(fixture)).not.toContain('This link is no longer valid');
    expect(completePasswordReset).not.toHaveBeenCalled();
    const input = fixture.nativeElement.querySelector('#new-password') as HTMLInputElement;
    const error = fixture.nativeElement.querySelector('mat-error') as HTMLElement;
    expect(input.value).toBe('a-new-password');
    expect(input.getAttribute('aria-describedby')?.split(' ')).toContain(error.id);
  });

  /**
   * `AuthService.resetPassword` turns an undifferentiated 400 with no field
   * errors into a `ResetLinkRejectedError` — the token itself, not the
   * password (ADR 0015) — and the screen asks `instanceof`, never
   * `error.status === 400`. The dead-link state takes over rather than a
   * banner over a form that can no longer succeed.
   */
  it('lands on the dead-link state when the reset link is rejected', async () => {
    const { fixture, completePasswordReset } = setup(
      { userId: '7', token: 'stale-token' },
      {
        resetPassword: () => throwError(() => new ResetLinkRejectedError()),
      },
    );
    enterPassword(fixture, 'a-new-password');

    await submitAndSettle(fixture);

    expect(text(fixture)).toContain('This link is no longer valid');
    const recoveryHeading = fixture.nativeElement.querySelector('auth-dead-link h1') as HTMLHeadingElement;
    expect(recoveryHeading).not.toBeNull();
    expect(document.activeElement).toBe(recoveryHeading);
    expect(completePasswordReset).not.toHaveBeenCalled();
  });

  it('shows a banner rather than the dead-link state for a failure that is not a 400', async () => {
    const { fixture, completePasswordReset } = setup(
      { userId: '7', token: 'a-token' },
      {
        resetPassword: () => throwError(() => new ApiError('Something went wrong on the server.', 500)),
      },
    );
    enterPassword(fixture, 'a-new-password');

    await submitAndSettle(fixture);

    expect(text(fixture)).toContain('Something went wrong on the server.');
    expect(text(fixture)).not.toContain('This link is no longer valid');
    expect(completePasswordReset).not.toHaveBeenCalled();
    expect((fixture.nativeElement.querySelector('#new-password') as HTMLInputElement).value).toBe('a-new-password');
  });
});
