import { WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FieldTree } from '@angular/forms/signals';
import { ActivatedRoute, provideRouter } from '@angular/router';
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
  function setup(signIn: () => Promise<void>) {
    TestBed.configureTestingModule({
      imports: [AuthSignIn],
      providers: [
        provideRouter([]),
        { provide: Session, useValue: { signIn } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: new Map() } },
        },
      ],
    });

    const fixture = TestBed.createComponent(AuthSignIn);
    const cmp = fixture.componentInstance as unknown as SignInInternals;
    cmp.signInFormModel.set({
      email: 'nobody@example.com',
      password: 'secret1!',
    });
    fixture.detectChanges();
    return { fixture, cmp };
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

    cmp.signIn(new Event('submit'));
    await fixture.whenStable();
    await fixture.whenStable();

    const messages = cmp.signInForm
      .email()
      .errors()
      .map((error) => error.message);
    expect(messages).toContain('That email is not registered.');
    expect(cmp.errorMessage()).toBeNull();
  });

  it('shows a wrong-credentials failure as one form-level message, not a field error', async () => {
    const { fixture, cmp } = setup(() =>
      Promise.reject(new ApiError('Invalid email or password.', 401))
    );

    cmp.signIn(new Event('submit'));
    await fixture.whenStable();
    await fixture.whenStable();

    expect(cmp.signInForm.email().errors()).toEqual([]);
    expect(cmp.errorMessage()).toBe(
      'That email and password do not match. Please try again.'
    );
  });
});
