import { WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FieldTree } from '@angular/forms/signals';
import { provideRouter } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { AuthService, Profile } from '@/app/core/auth';
import AuthSignUp from './sign-up';

/** The slice of the component the tests reach into. */
type SignUpInternals = {
  signUpFormModel: WritableSignal<{
    name: string;
    email: string;
    password: string;
  }>;
  signUpForm: {
    name: FieldTree<string>;
    email: FieldTree<string>;
    password: FieldTree<string>;
  };
  errorMessage: () => string | null;
  registeredEmail: () => string | null;
  signUp(event: Event): void;
};

describe('AuthSignUp', () => {
  function setup(register: () => Observable<Profile>) {
    TestBed.configureTestingModule({
      imports: [AuthSignUp],
      providers: [provideRouter([]), { provide: AuthService, useValue: { register } }],
    });

    const fixture = TestBed.createComponent(AuthSignUp);
    const cmp = fixture.componentInstance as unknown as SignUpInternals;
    cmp.signUpFormModel.set({
      name: 'Ada',
      email: 'ada@example.com',
      password: 'secret1!',
    });
    fixture.detectChanges();
    return { fixture, cmp };
  }

  /** Drive a submit to completion. */
  async function submitAndSettle(
    fixture: { whenStable: () => Promise<unknown> },
    cmp: SignUpInternals
  ) {
    cmp.signUp(new Event('submit'));
    await fixture.whenStable();
    await fixture.whenStable();
  }

  it('swaps to the check-your-inbox state, naming the address, on a successful registration', async () => {
    const register = vi
      .fn()
      .mockReturnValue(
        of<Profile>({ id: 7, name: 'Ada', email: 'ada@example.com' })
      );
    const { fixture, cmp } = setup(register);

    await submitAndSettle(fixture, cmp);

    expect(register).toHaveBeenCalledWith({
      name: 'Ada',
      email: 'ada@example.com',
      password: 'secret1!',
    });
    expect(cmp.registeredEmail()).toBe('ada@example.com');
    expect(cmp.errorMessage()).toBeNull();
  });

  it('does not call the server when the password is under the API length floor', async () => {
    const register = vi.fn();
    const { fixture, cmp } = setup(register);
    cmp.signUpFormModel.set({
      name: 'Ada',
      email: 'ada@example.com',
      password: 'short12', // 7 chars — under the 8-character floor
    });
    fixture.detectChanges();

    await submitAndSettle(fixture, cmp);

    expect(register).not.toHaveBeenCalled();
    expect(cmp.registeredEmail()).toBeNull();
  });

  it('binds server-blamed fields onto the matching form controls', async () => {
    const { fixture, cmp } = setup(() =>
      throwError(
        () =>
          new ApiError(
            'Please correct the highlighted fields and try again.',
            400,
            { password: ['The Password must be at least 8 characters.'] }
          )
      )
    );

    await submitAndSettle(fixture, cmp);

    const messages = cmp.signUpForm
      .password()
      .errors()
      .map((error) => error.message);
    expect(messages).toContain('The Password must be at least 8 characters.');
    expect(cmp.errorMessage()).toBeNull();
    expect(cmp.registeredEmail()).toBeNull();
  });

  it('shows an already-registered email as one form-level message pointing at sign-in', async () => {
    const { fixture, cmp } = setup(() =>
      throwError(
        () =>
          new ApiError(
            'That email is already registered. Try signing in instead.',
            409
          )
      )
    );

    await submitAndSettle(fixture, cmp);

    expect(cmp.signUpForm.email().errors()).toEqual([]);
    expect(cmp.errorMessage()).toBe(
      'That email is already registered. Try signing in instead.'
    );
    expect(cmp.registeredEmail()).toBeNull();
  });

  it('explains a failure that never reached the server rather than blanking out', async () => {
    const { fixture, cmp } = setup(() => throwError(() => new Error('offline')));

    await submitAndSettle(fixture, cmp);

    expect(cmp.errorMessage()).toBe(
      'Something went wrong creating your profile. Please try again.'
    );
    expect(cmp.registeredEmail()).toBeNull();
  });

  it('clears the banner as soon as the person edits the form', async () => {
    const { fixture, cmp } = setup(() =>
      throwError(
        () =>
          new ApiError(
            'That email is already registered. Try signing in instead.',
            409
          )
      )
    );

    await submitAndSettle(fixture, cmp);
    expect(cmp.errorMessage()).not.toBeNull();

    cmp.signUpFormModel.set({
      name: 'Ada',
      email: 'ada2@example.com',
      password: 'secret1!',
    });

    expect(cmp.errorMessage()).toBeNull();
  });
});
