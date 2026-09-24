import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { AuthService, EmailNotConfirmedError } from '@/app/core/auth';
import { provideIcons } from '@/app/core/icons';
import { Session } from '@/app/core/session';
import AuthSignIn from './sign-in';

describe('AuthSignIn', () => {
  function setup(signIn: () => Promise<void>, queryParams: Record<string, string> = {}) {
    const resendConfirmation = vi.fn(() => of(undefined));
    TestBed.configureTestingModule({
      imports: [AuthSignIn],
      providers: [
        provideRouter([]),
        provideIcons(),
        { provide: Session, useValue: { signIn } },
        // Only reached by the resend control on the unconfirmed-email state;
        // stubbed so its host doesn't need a real HTTP setup.
        { provide: AuthService, useValue: { resendConfirmation } },
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
    const navigateByUrl = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    const fixture = TestBed.createComponent(AuthSignIn);
    fixture.detectChanges();
    enter(fixture, '#email', 'nobody@example.com');
    enter(fixture, '#password', 'secret1!');
    return { fixture, navigateByUrl, resendConfirmation };
  }

  /** Drive a submit to completion. */
  async function submitAndSettle(fixture: ComponentFixture<AuthSignIn>) {
    (fixture.nativeElement.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function enter(fixture: ComponentFixture<AuthSignIn>, selector: string, value: string) {
    const input = fixture.nativeElement.querySelector(selector) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function text(fixture: ComponentFixture<AuthSignIn>) {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  it('keeps invalid Sign in enabled, reveals errors, and focuses the first invalid field', async () => {
    const signIn = vi.fn().mockResolvedValue(undefined);
    const { fixture } = setup(signIn);
    enter(fixture, '#email', '');
    enter(fixture, '#password', '');
    const button = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')).find(
      (candidate) => candidate.textContent?.trim() === 'Sign in',
    );
    if (!button) {
      throw new Error('No Sign in button');
    }

    expect(button.disabled).toBe(false);
    await submitAndSettle(fixture);

    expect(text(fixture)).toContain('You must enter an email address');
    expect(document.activeElement).toBe(fixture.nativeElement.querySelector('#email'));
    expect(signIn).not.toHaveBeenCalled();
  });

  it('reveals and hides the password through a clearly named control', () => {
    const { fixture } = setup(() => Promise.resolve());
    const password = fixture.nativeElement.querySelector('#password') as HTMLInputElement;

    const showPassword = fixture.nativeElement.querySelector(
      'button[aria-label="Show password"]',
    ) as HTMLButtonElement | null;
    expect(showPassword).not.toBeNull();
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

  it('announces pending sign-in and ignores duplicate submissions until the request settles', async () => {
    let finishSignIn!: () => void;
    let markSignInStarted!: () => void;
    const signInStarted = new Promise<void>((resolve) => {
      markSignInStarted = resolve;
    });
    const signIn = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishSignIn = resolve;
          markSignInStarted();
        }),
    );
    const { fixture } = setup(signIn);
    const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;
    const button = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')).find(
      (candidate) => candidate.textContent?.trim() === 'Sign in',
    );
    if (!button) {
      throw new Error('No Sign in button');
    }

    form.dispatchEvent(new Event('submit'));
    await signInStarted;
    fixture.detectChanges();

    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain('Signing in…');
    expect(fixture.nativeElement.querySelector('[role="status"]')?.textContent).toContain('Signing in…');

    form.dispatchEvent(new Event('submit'));
    finishSignIn();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(signIn).toHaveBeenCalledTimes(1);
  });

  it('binds server-blamed fields onto the matching form controls', async () => {
    const { fixture } = setup(() =>
      Promise.reject(
        new ApiError('Please correct the highlighted fields and try again.', 400, {
          email: ['That email is not registered.'],
        }),
      ),
    );

    await submitAndSettle(fixture);

    expect(text(fixture)).toContain('That email is not registered.');
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
  });

  it('shows a wrong-credentials failure as one form-level message, not a field error', async () => {
    const { fixture } = setup(() =>
      Promise.reject(new ApiError('That email and password do not match. Please try again.', 401)),
    );

    await submitAndSettle(fixture);

    // The adapter already produced the display message; the component surfaces
    // it as-is rather than re-branching on the 401 (ADR 0002).
    expect(text(fixture)).toContain('That email and password do not match. Please try again.');
    // The other auth failure that must never carry the resend affordance.
    expect(fixture.nativeElement.querySelector('auth-resend-confirmation')).toBeNull();
  });

  it('shows a locked-out failure as one form-level message, not a field error', async () => {
    const { fixture } = setup(() =>
      Promise.reject(new ApiError('Too many failed attempts. Please wait a few minutes and try again.', 423)),
    );

    await submitAndSettle(fixture);

    expect(text(fixture)).toContain('Too many failed attempts. Please wait a few minutes and try again.');
    // The one auth failure that should never carry the resend affordance.
    expect(fixture.nativeElement.querySelector('auth-resend-confirmation')).toBeNull();
  });

  it('offers the resend control on an unconfirmed-email failure, seeded with the typed address', async () => {
    const { fixture, resendConfirmation } = setup(() =>
      Promise.reject(new EmailNotConfirmedError('nobody@example.com')),
    );

    await submitAndSettle(fixture);

    expect(fixture.nativeElement.querySelector('auth-resend-confirmation')).not.toBeNull();
    const resend = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Resend confirmation email'),
    );
    if (!resend) {
      throw new Error('No resend confirmation button');
    }
    resend.click();
    await fixture.whenStable();
    expect(resendConfirmation).toHaveBeenCalledWith('nobody@example.com');
    // Never a suggestion the password was right.
    expect((fixture.nativeElement.querySelector('[role="alert"]') as HTMLElement).textContent).not.toMatch(/password/i);
  });

  it('clears the resend affordance as soon as the person edits the form', async () => {
    const { fixture } = setup(() => Promise.reject(new EmailNotConfirmedError('nobody@example.com')));

    await submitAndSettle(fixture);
    expect(fixture.nativeElement.querySelector('auth-resend-confirmation')).not.toBeNull();

    enter(fixture, '#password', 'secret2!');

    expect(fixture.nativeElement.querySelector('auth-resend-confirmation')).toBeNull();
  });

  it('navigates to the app on a successful sign-in', async () => {
    const signIn = vi.fn().mockResolvedValue(undefined);
    const { fixture, navigateByUrl } = setup(signIn);

    await submitAndSettle(fixture);

    expect(signIn).toHaveBeenCalledWith({
      email: 'nobody@example.com',
      password: 'secret1!',
    });
    expect(navigateByUrl).toHaveBeenCalledWith('/app');
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
  });

  it('does not report a post-sign-in navigation failure as a sign-in failure', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const signIn = vi.fn().mockResolvedValue(undefined);
    const { fixture, navigateByUrl } = setup(signIn);
    navigateByUrl.mockRejectedValueOnce(new Error('router boom'));

    await submitAndSettle(fixture);

    expect(signIn).toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
    expect(error).toHaveBeenCalled();

    error.mockRestore();
  });

  it('returns to where the person was headed when a safe returnUrl was remembered', async () => {
    const { fixture, navigateByUrl } = setup(() => Promise.resolve(), { returnUrl: '/app/accounts/42' });

    await submitAndSettle(fixture);

    expect(navigateByUrl).toHaveBeenCalledWith('/app/accounts/42');
  });

  it('ignores a hostile returnUrl and lands on the app home', async () => {
    const { fixture, navigateByUrl } = setup(() => Promise.resolve(), { returnUrl: '//evil.example' });

    await submitAndSettle(fixture);

    expect(navigateByUrl).toHaveBeenCalledWith('/app');
  });

  it('surfaces a server-blamed field this form has no control for', async () => {
    const { fixture } = setup(() =>
      Promise.reject(
        new ApiError('Please correct the highlighted fields and try again.', 400, {
          tenantCode: ['That workspace is not accepting sign-ins.'],
        }),
      ),
    );

    await submitAndSettle(fixture);

    // Nothing to highlight, so the banner must carry the message rather than
    // telling the person to correct highlights that do not exist.
    expect(text(fixture)).toContain('That workspace is not accepting sign-ins.');
  });

  it('shows a session-ended notice when the lapse marker is on the query string', () => {
    const { fixture } = setup(() => Promise.resolve(), {
      returnUrl: '/app/accounts',
      reason: 'session-expired',
    });

    expect(text(fixture)).toContain('Your session expired. Sign in again. Unsaved changes were discarded.');
  });

  it('shows no notice for a bare returnUrl with no lapse marker', () => {
    const { fixture } = setup(() => Promise.resolve(), {
      returnUrl: '/app/accounts',
    });

    expect(text(fixture)).not.toContain('Your session expired. Sign in again.');
  });

  it('shows no notice for an unrecognised reason value', () => {
    const { fixture } = setup(() => Promise.resolve(), { reason: 'expired' });

    expect(text(fixture)).not.toContain('Your session expired. Sign in again.');
  });

  it('dismisses the session notice on a sign-in attempt so banners never stack', async () => {
    const { fixture } = setup(
      () => Promise.reject(new ApiError('That email and password do not match. Please try again.', 401)),
      { returnUrl: '/app/accounts', reason: 'session-expired' },
    );
    expect(text(fixture)).toContain('Your session expired. Sign in again.');

    await submitAndSettle(fixture);

    expect(text(fixture)).not.toContain('Your session expired. Sign in again.');
    expect(text(fixture)).toContain('That email and password do not match. Please try again.');
  });

  it('clears the banner as soon as the person edits the form', async () => {
    const { fixture } = setup(() =>
      Promise.reject(new ApiError('That email and password do not match. Please try again.', 401)),
    );

    await submitAndSettle(fixture);
    expect(fixture.nativeElement.querySelector('[role="alert"]')).not.toBeNull();

    enter(fixture, '#password', 'secret2!');

    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
  });
});
