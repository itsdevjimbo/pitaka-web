import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { AuthService, Profile } from '@/app/core/auth';
import AuthSignUp from './sign-up';

describe('AuthSignUp', () => {
  function setup(register: () => Observable<Profile>) {
    TestBed.configureTestingModule({
      imports: [AuthSignUp],
      providers: [provideRouter([]), { provide: AuthService, useValue: { register } }],
    });

    const fixture = TestBed.createComponent(AuthSignUp);
    fixture.detectChanges();
    enter(fixture, '#name', 'Ada');
    enter(fixture, '#email', 'ada@example.com');
    enter(fixture, '#password', 'secret1!');
    return { fixture };
  }

  /** Drive a submit to completion. */
  async function submitAndSettle(fixture: ComponentFixture<AuthSignUp>) {
    (fixture.nativeElement.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function enter(fixture: ComponentFixture<AuthSignUp>, selector: string, value: string) {
    const input = fixture.nativeElement.querySelector(selector) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function text(fixture: ComponentFixture<AuthSignUp>) {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  it('swaps to the check-your-inbox state, naming the address, on a successful registration', async () => {
    const register = vi
      .fn()
      .mockReturnValue(of<Profile>({ id: 7, name: 'Ada', email: 'ada@example.com', pendingEmail: null }));
    const { fixture } = setup(register);

    await submitAndSettle(fixture);

    expect(register).toHaveBeenCalledWith({
      name: 'Ada',
      email: 'ada@example.com',
      password: 'secret1!',
    });
    expect(text(fixture)).toContain('ada@example.com');
    expect(fixture.nativeElement.querySelector('form')).toBeNull();
  });

  it('does not call the server when the password is under the API length floor', async () => {
    const register = vi.fn();
    const { fixture } = setup(register);
    enter(fixture, '#password', 'short12'); // 7 chars — under the 8-character floor

    await submitAndSettle(fixture);

    expect(register).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('form')).not.toBeNull();
  });

  it('binds server-blamed fields onto the matching form controls', async () => {
    const { fixture } = setup(() =>
      throwError(
        () =>
          new ApiError('Please correct the highlighted fields and try again.', 400, {
            password: ['The Password must be at least 8 characters.'],
          }),
      ),
    );

    await submitAndSettle(fixture);

    expect(text(fixture)).toContain('The Password must be at least 8 characters.');
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('form')).not.toBeNull();
  });

  it('shows an already-registered email as one form-level message pointing at sign-in', async () => {
    const { fixture } = setup(() =>
      throwError(() => new ApiError('That email is already registered. Try signing in instead.', 409)),
    );

    await submitAndSettle(fixture);

    expect(text(fixture)).toContain('That email is already registered. Try signing in instead.');
    expect(fixture.nativeElement.querySelector('form')).not.toBeNull();
  });

  it('explains a failure that never reached the server rather than blanking out', async () => {
    const { fixture } = setup(() => throwError(() => new Error('offline')));

    await submitAndSettle(fixture);

    expect(text(fixture)).toContain('Something went wrong creating your profile. Please try again.');
    expect(fixture.nativeElement.querySelector('form')).not.toBeNull();
  });

  it('clears the banner as soon as the person edits the form', async () => {
    const { fixture } = setup(() =>
      throwError(() => new ApiError('That email is already registered. Try signing in instead.', 409)),
    );

    await submitAndSettle(fixture);
    expect(fixture.nativeElement.querySelector('[role="alert"]')).not.toBeNull();

    enter(fixture, '#email', 'ada2@example.com');

    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
  });
});
