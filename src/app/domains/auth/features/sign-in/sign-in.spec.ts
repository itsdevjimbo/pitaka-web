import { WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FieldTree } from '@angular/forms/signals';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { ApiError } from '@/app/core/api';
import { Session } from '@/app/core/session';
import AuthSignIn from './sign-in';

/** The slice of the component the tests reach into. */
type SignInInternals = {
  signInFormModel: WritableSignal<{ email: string; password: string }>;
  signInForm: { email: FieldTree<string>; password: FieldTree<string> };
  errorMessage: () => string | null;
  signIn(event: Event): void;
};

describe('AuthSignIn', () => {
  function setup(
    signIn: () => Promise<void>,
    queryParams: Record<string, string> = {}
  ) {
    TestBed.configureTestingModule({
      imports: [AuthSignIn],
      providers: [
        provideRouter([]),
        { provide: Session, useValue: { signIn } },
        {
          provide: ActivatedRoute,
          useValue: {
            // Angular's ParamMap returns null for a missing key; a bare Map
            // returns undefined, which production code never sees.
            snapshot: {
              queryParamMap: { get: (key: string) => queryParams[key] ?? null },
            },
          },
        },
      ],
    });

    const router = TestBed.inject(Router);
    const navigateByUrl = vi
      .spyOn(router, 'navigateByUrl')
      .mockResolvedValue(true);

    const fixture = TestBed.createComponent(AuthSignIn);
    const cmp = fixture.componentInstance as unknown as SignInInternals;
    cmp.signInFormModel.set({
      email: 'nobody@example.com',
      password: 'secret1!',
    });
    fixture.detectChanges();
    return { fixture, cmp, navigateByUrl };
  }

  /** Drive a submit to completion. */
  async function submitAndSettle(fixture: { whenStable: () => Promise<unknown> }, cmp: SignInInternals) {
    cmp.signIn(new Event('submit'));
    await fixture.whenStable();
    await fixture.whenStable();
  }

  it('binds server-blamed fields onto the matching form controls', async () => {
    const { fixture, cmp } = setup(() =>
      Promise.reject(
        new ApiError(
          'Please correct the highlighted fields and try again.',
          400,
          { email: ['That email is not registered.'] }
        )
      )
    );

    await submitAndSettle(fixture, cmp);

    const messages = cmp.signInForm
      .email()
      .errors()
      .map((error) => error.message);
    expect(messages).toContain('That email is not registered.');
    expect(cmp.errorMessage()).toBeNull();
  });

  it('shows a wrong-credentials failure as one form-level message, not a field error', async () => {
    const { fixture, cmp } = setup(() =>
      Promise.reject(
        new ApiError('That email and password do not match. Please try again.', 401)
      )
    );

    await submitAndSettle(fixture, cmp);

    expect(cmp.signInForm.email().errors()).toEqual([]);
    // The adapter already produced the display message; the component surfaces
    // it as-is rather than re-branching on the 401 (ADR 0002).
    expect(cmp.errorMessage()).toBe(
      'That email and password do not match. Please try again.'
    );
  });

  it('navigates to the app on a successful sign-in', async () => {
    const signIn = vi.fn().mockResolvedValue(undefined);
    const { fixture, cmp, navigateByUrl } = setup(signIn);

    await submitAndSettle(fixture, cmp);

    expect(signIn).toHaveBeenCalledWith({
      email: 'nobody@example.com',
      password: 'secret1!',
    });
    expect(navigateByUrl).toHaveBeenCalledWith('/app');
    expect(cmp.errorMessage()).toBeNull();
  });

  it('returns to where the person was headed when a safe returnUrl was remembered', async () => {
    const { fixture, cmp, navigateByUrl } = setup(
      () => Promise.resolve(),
      { returnUrl: '/app/accounts/42' }
    );

    await submitAndSettle(fixture, cmp);

    expect(navigateByUrl).toHaveBeenCalledWith('/app/accounts/42');
  });

  it('ignores a hostile returnUrl and lands on the app home', async () => {
    const { fixture, cmp, navigateByUrl } = setup(
      () => Promise.resolve(),
      { returnUrl: '//evil.example' }
    );

    await submitAndSettle(fixture, cmp);

    expect(navigateByUrl).toHaveBeenCalledWith('/app');
  });

  it('surfaces a server-blamed field this form has no control for', async () => {
    const { fixture, cmp } = setup(() =>
      Promise.reject(
        new ApiError('Please correct the highlighted fields and try again.', 400, {
          tenantCode: ['That workspace is not accepting sign-ins.'],
        })
      )
    );

    await submitAndSettle(fixture, cmp);

    // Nothing to highlight, so the banner must carry the message rather than
    // telling the person to correct highlights that do not exist.
    expect(cmp.signInForm.email().errors()).toEqual([]);
    expect(cmp.errorMessage()).toBe(
      'That workspace is not accepting sign-ins.'
    );
  });

  it('clears the banner as soon as the person edits the form', async () => {
    const { fixture, cmp } = setup(() =>
      Promise.reject(
        new ApiError('That email and password do not match. Please try again.', 401)
      )
    );

    await submitAndSettle(fixture, cmp);
    expect(cmp.errorMessage()).not.toBeNull();

    cmp.signInFormModel.set({
      email: 'nobody@example.com',
      password: 'secret2!',
    });

    expect(cmp.errorMessage()).toBeNull();
  });
});
