import { WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FieldTree } from '@angular/forms/signals';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of, throwError } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { AuthService, ResetLinkRejectedError } from '@/app/core/auth';
import { provideIcons } from '@/app/core/icons';
import { Session } from '@/app/core/session';
import AuthResetPassword from './reset-password';

/** The slice of the component the tests reach into. */
type ResetPasswordInternals = {
  resetFormModel: WritableSignal<{ newPassword: string }>;
  resetForm: { newPassword: FieldTree<string> };
  resetPassword(event: Event): void;
};

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
    } = {}
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
    const cmp = fixture.componentInstance as unknown as ResetPasswordInternals;
    fixture.detectChanges();
    return { fixture, cmp, completePasswordReset };
  }

  async function submitAndSettle(
    fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void },
    cmp: ResetPasswordInternals
  ) {
    cmp.resetPassword(new Event('submit'));
    await fixture.whenStable();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function text(fixture: { nativeElement: HTMLElement }): string {
    return fixture.nativeElement.textContent ?? '';
  }

  it('shows the new-password form for a well-formed link', () => {
    const { fixture } = setup({ userId: '7', token: 'a-token' });

    expect(
      (fixture.nativeElement as HTMLElement).querySelector('#new-password')
    ).not.toBeNull();
    expect(text(fixture)).not.toContain('This link is no longer valid');
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
    const { fixture } = setup(
      { userId: 'not-a-number', token: 'a-token' },
      { resetPassword }
    );

    expect(resetPassword).not.toHaveBeenCalled();
    expect(text(fixture)).toContain('This link is no longer valid');
  });

  it('resets with the userId coerced to a number, the token as given, and the typed password', async () => {
    const resetPassword = vi.fn(() => of(undefined));
    const { fixture, cmp } = setup(
      { userId: '7', token: 'a-token' },
      { resetPassword }
    );
    cmp.resetFormModel.set({ newPassword: 'a-new-password' });
    fixture.detectChanges();

    await submitAndSettle(fixture, cmp);

    expect(resetPassword).toHaveBeenCalledWith(7, 'a-token', 'a-new-password');
  });

  it('clears the local session and lands at sign-in on a clean reset', async () => {
    const { fixture, cmp, completePasswordReset } = setup({
      userId: '7',
      token: 'a-token',
    });
    cmp.resetFormModel.set({ newPassword: 'a-new-password' });
    fixture.detectChanges();

    await submitAndSettle(fixture, cmp);

    expect(completePasswordReset).toHaveBeenCalled();
  });

  it('shows a server-rejected password bound to the field, not the dead-link state', async () => {
    const { fixture, cmp, completePasswordReset } = setup(
      { userId: '7', token: 'a-token' },
      {
        resetPassword: () =>
          throwError(
            () =>
              new ApiError(
                'Please correct the highlighted fields and try again.',
                400,
                {
                  password: [
                    'The field Password must be a string with a minimum length of 8.',
                  ],
                }
              )
          ),
      }
    );
    // Long enough to pass the client's own minLength(8), so the failure
    // reaching the component is the server's alone.
    cmp.resetFormModel.set({ newPassword: 'a-new-password' });
    fixture.detectChanges();

    await submitAndSettle(fixture, cmp);

    expect(text(fixture)).toContain(
      'The field Password must be a string with a minimum length of 8.'
    );
    expect(text(fixture)).not.toContain('This link is no longer valid');
    expect(completePasswordReset).not.toHaveBeenCalled();
  });

  /**
   * `AuthService.resetPassword` turns an undifferentiated 400 with no field
   * errors into a `ResetLinkRejectedError` — the token itself, not the
   * password (ADR 0015) — and the screen asks `instanceof`, never
   * `error.status === 400`. The dead-link state takes over rather than a
   * banner over a form that can no longer succeed.
   */
  it('lands on the dead-link state when the reset link is rejected', async () => {
    const { fixture, cmp, completePasswordReset } = setup(
      { userId: '7', token: 'stale-token' },
      {
        resetPassword: () => throwError(() => new ResetLinkRejectedError()),
      }
    );
    cmp.resetFormModel.set({ newPassword: 'a-new-password' });
    fixture.detectChanges();

    await submitAndSettle(fixture, cmp);

    expect(text(fixture)).toContain('This link is no longer valid');
    expect(completePasswordReset).not.toHaveBeenCalled();
  });

  it('shows a banner rather than the dead-link state for a failure that is not a 400', async () => {
    const { fixture, cmp, completePasswordReset } = setup(
      { userId: '7', token: 'a-token' },
      {
        resetPassword: () =>
          throwError(
            () => new ApiError('Something went wrong on the server.', 500)
          ),
      }
    );
    cmp.resetFormModel.set({ newPassword: 'a-new-password' });
    fixture.detectChanges();

    await submitAndSettle(fixture, cmp);

    expect(text(fixture)).toContain('Something went wrong on the server.');
    expect(text(fixture)).not.toContain('This link is no longer valid');
    expect(completePasswordReset).not.toHaveBeenCalled();
  });
});
