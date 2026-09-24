import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { API_BASE_URL, errorInterceptor } from '@/app/core/api';
import { AuthService } from '@/app/core/auth';
import { TEST_API_BASE_URL as BASE_URL } from '@/testing/api-base-url';
import AuthForgotPassword, { RESET_LINK_REASSURANCE } from './forgot-password';

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
    submitButton(fixture).click();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function enterEmail(fixture: ComponentFixture<AuthForgotPassword>, value: string) {
    const input = emailInput(fixture);
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function emailInput(fixture: ComponentFixture<AuthForgotPassword>): HTMLInputElement {
    const element = fixture.nativeElement as HTMLElement;
    const label = Array.from(element.querySelectorAll('label')).find(
      (candidate) => candidate.textContent?.trim() === 'Email address',
    );
    if (!(label?.control instanceof HTMLInputElement)) {
      throw new Error('Expected an input labelled Email address');
    }

    return label.control;
  }

  function text(fixture: { nativeElement: HTMLElement }): string {
    return fixture.nativeElement.textContent ?? '';
  }

  function submitButton(fixture: ComponentFixture<AuthForgotPassword>): HTMLButtonElement {
    const element = fixture.nativeElement as HTMLElement;
    const button = Array.from(element.querySelectorAll('button')).find((candidate) =>
      ['Send reset link', 'Send another reset link', 'Sending…'].includes(candidate.textContent?.trim() ?? ''),
    );
    if (!button) {
      throw new Error('Expected the Send reset link button');
    }

    return button;
  }

  it('shows an enabled invalid Submit, reveals email errors, and focuses the field without asking', async () => {
    const forgotPassword = vi.fn(() => of(undefined));
    const { fixture } = setup(forgotPassword, 'not-an-email');
    const input = emailInput(fixture);

    expect(submitButton(fixture).disabled).toBe(false);
    await submitAndSettle(fixture);

    expect(text(fixture)).toContain('You must enter a valid email address');
    expect(document.activeElement).toBe(input);
    expect(forgotPassword).not.toHaveBeenCalled();

    enterEmail(fixture, '');

    expect(text(fixture)).toContain('You must enter an email address');
    expect(submitButton(fixture).disabled).toBe(false);
  });

  it('shows an invalid email error after the field is blurred', () => {
    const { fixture } = setup();
    const input = emailInput(fixture);

    input.focus();
    enterEmail(fixture, 'not-an-email');
    input.blur();
    fixture.detectChanges();

    expect(text(fixture)).toContain('You must enter a valid email address');
    expect(submitButton(fixture).disabled).toBe(false);
  });

  it('asks for a reset link and keeps the email in the compact result state', async () => {
    const forgotPassword = vi.fn(() => of(undefined));
    const { fixture } = setup(forgotPassword);

    await submitAndSettle(fixture);

    expect(forgotPassword).toHaveBeenCalledWith('ada@example.com');
    expect(text(fixture)).toContain(RESET_LINK_REASSURANCE);
    expect(fixture.nativeElement.querySelector('[role="status"]')?.getAttribute('aria-live')).toBe('polite');
    expect(emailInput(fixture).value).toBe('ada@example.com');
    expect(submitButton(fixture).textContent).toContain('Send another reset link');
    const element = fixture.nativeElement as HTMLElement;
    const signInLink = Array.from(element.querySelectorAll('a')).find(
      (candidate) => candidate.textContent?.trim() === 'Back to sign in',
    );
    expect(signInLink?.getAttribute('href')).toBe('/auth/sign-in');
  });

  it('keeps the same privacy-safe result if the request fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { fixture } = setup(() => throwError(() => new Error('network down')));

    await submitAndSettle(fixture);

    expect(text(fixture)).toContain(RESET_LINK_REASSURANCE);
    expect(text(fixture)).not.toContain('network down');
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();

    error.mockRestore();
  });

  it('keeps the generic result after an HTTP failure and recovers on an HTTP retry', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    TestBed.configureTestingModule({
      imports: [AuthForgotPassword],
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: BASE_URL },
      ],
    });

    const fixture = TestBed.createComponent(AuthForgotPassword);
    fixture.detectChanges();
    enterEmail(fixture, 'ada@example.com');
    const http = TestBed.inject(HttpTestingController);

    submitButton(fixture).click();
    const failedRequest = http.expectOne(`${BASE_URL}/api/auth/forgot-password`);
    expect(failedRequest.request.body).toEqual({ email: 'ada@example.com' });
    failedRequest.flush('Temporary failure', { status: 500, statusText: 'Internal Server Error' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(text(fixture)).toContain(RESET_LINK_REASSURANCE);
    expect(text(fixture)).not.toContain('Temporary failure');
    expect(submitButton(fixture).textContent).toContain('Send another reset link');

    submitButton(fixture).click();
    const retriedRequest = http.expectOne(`${BASE_URL}/api/auth/forgot-password`);
    expect(retriedRequest.request.body).toEqual({ email: 'ada@example.com' });
    retriedRequest.flush(null, { status: 202, statusText: 'Accepted' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(text(fixture)).toContain(RESET_LINK_REASSURANCE);
    expect(submitButton(fixture).textContent).toContain('Send another reset link');
    http.verify();
    warn.mockRestore();
  });

  it('allows an explicit retry and clears the result after the email changes', async () => {
    const forgotPassword = vi.fn(() => of(undefined));
    const { fixture } = setup(forgotPassword);

    await submitAndSettle(fixture);
    submitButton(fixture).click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(forgotPassword).toHaveBeenCalledTimes(2);
    expect(text(fixture)).toContain(RESET_LINK_REASSURANCE);

    enterEmail(fixture, 'ada@example.org');

    expect(fixture.nativeElement.querySelector('[role="status"]')).toBeNull();
    expect(submitButton(fixture).textContent).toContain('Send reset link');
  });

  it('announces pending work and prevents a second native form submission', async () => {
    const response = new Subject<void>();
    const forgotPassword = vi.fn(() => response.asObservable());
    const { fixture } = setup(forgotPassword);
    const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;

    submitButton(fixture).click();
    await Promise.resolve();
    fixture.detectChanges();

    expect(form.getAttribute('aria-busy')).toBe('true');
    expect(submitButton(fixture).disabled).toBe(true);
    expect(fixture.nativeElement.querySelector('[role="status"]')?.textContent).toContain('Sending a reset link');

    form.requestSubmit();
    expect(forgotPassword).toHaveBeenCalledTimes(1);

    response.next();
    response.complete();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(text(fixture)).toContain(RESET_LINK_REASSURANCE);
    expect(submitButton(fixture).disabled).toBe(false);
  });

  it('does not show an old request result over an email edited while it was pending', async () => {
    const response = new Subject<void>();
    const { fixture } = setup(() => response.asObservable());

    submitButton(fixture).click();
    await Promise.resolve();
    enterEmail(fixture, 'new@example.com');

    response.next();
    response.complete();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(emailInput(fixture).value).toBe('new@example.com');
    expect(fixture.nativeElement.querySelector('[role="status"]')).toBeNull();
  });
});
