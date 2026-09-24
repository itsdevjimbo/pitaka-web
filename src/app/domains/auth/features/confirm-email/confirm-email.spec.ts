import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { Observable, of, Subject, throwError } from 'rxjs';
import { AuthService, EmailConfirmationLinkRejectedError } from '@/app/core/auth';
import { provideIcons } from '@/app/core/icons';
import { Session } from '@/app/core/session';
import AuthConfirmEmail from './confirm-email';

describe('AuthConfirmEmail', () => {
  function setup(
    queryParams: Record<string, string>,
    {
      confirmEmail = () => of(undefined),
      isAuthenticated = false,
    }: {
      confirmEmail?: AuthService['confirmEmail'];
      isAuthenticated?: boolean;
    } = {},
  ) {
    const navigate = vi.fn(() => Promise.resolve(true));
    const navigateByUrl = vi.fn(() => Promise.resolve(true));

    TestBed.configureTestingModule({
      imports: [AuthConfirmEmail],
      providers: [
        provideIcons(),
        { provide: AuthService, useValue: { confirmEmail } },
        { provide: Session, useValue: { isAuthenticated: () => isAuthenticated } },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { queryParamMap: convertToParamMap(queryParams) },
          },
        },
        { provide: Router, useValue: { navigate, navigateByUrl } },
      ],
    });

    const fixture = TestBed.createComponent(AuthConfirmEmail);
    return { fixture, navigate, navigateByUrl };
  }

  function text(fixture: ReturnType<typeof setup>['fixture']): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  function button(fixture: ReturnType<typeof setup>['fixture'], label: string): HTMLButtonElement | null {
    const element = fixture.nativeElement as HTMLElement;
    return (
      Array.from(element.querySelectorAll('button')).find(
        (candidate) => candidate.textContent?.replace(/\s+/g, ' ').trim() === label,
      ) ?? null
    );
  }

  async function click(fixture: ReturnType<typeof setup>['fixture'], label: string): Promise<void> {
    const action = button(fixture, label);
    if (!action) {
      throw new Error(`Expected the ${label} button`);
    }
    action.click();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('confirms automatically on landing and announces progress', () => {
    const confirmEmail = vi.fn(() => new Subject<void>());
    const { fixture } = setup({ userId: '7', token: 'a-token' }, { confirmEmail });

    fixture.detectChanges();

    expect(confirmEmail).toHaveBeenCalledWith(7, 'a-token');
    expect(text(fixture)).toContain('Confirming your email');
    expect(fixture.nativeElement.querySelector('[role="status"][aria-live="polite"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('h1')?.textContent?.trim()).toBe('Confirming your email');
  });

  it('shows the successful result and waits for the person to continue', async () => {
    const { fixture, navigate, navigateByUrl } = setup({ userId: '7', token: 'a-token' });

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(text(fixture)).toContain('Email confirmed');
    expect(text(fixture)).toContain('You can now sign in to Pitaka.');
    expect(fixture.nativeElement.querySelector('[role="status"][aria-live="polite"]')).not.toBeNull();
    expect(button(fixture, 'Continue to sign in')).not.toBeNull();
    expect(document.activeElement).toBe((fixture.nativeElement as HTMLElement).querySelector('h1'));
    expect(navigate).not.toHaveBeenCalled();
    expect(navigateByUrl).not.toHaveBeenCalled();
  });

  it('unsubscribes from confirmation when the screen is destroyed', () => {
    let unsubscribed = false;
    const { fixture } = setup(
      { userId: '7', token: 'a-token' },
      {
        confirmEmail: () =>
          new Observable<void>(() => () => {
            unsubscribed = true;
          }),
      },
    );

    fixture.detectChanges();
    fixture.destroy();

    expect(unsubscribed).toBe(true);
  });

  it('continues a signed-out visitor to sign-in with the confirmation reason', async () => {
    const { fixture, navigate } = setup({ userId: '7', token: 'a-token' });

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await click(fixture, 'Continue to sign in');

    expect(navigate).toHaveBeenCalledWith(['/auth/sign-in'], {
      queryParams: { reason: 'email-confirmed' },
    });
  });

  it('keeps an existing session and continues to the Accounts landing screen', async () => {
    const { fixture, navigate, navigateByUrl } = setup({ userId: '7', token: 'a-token' }, { isAuthenticated: true });

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(text(fixture)).toContain('Continue to your Accounts');
    await click(fixture, 'Continue to your Accounts');

    expect(navigateByUrl).toHaveBeenCalledWith('/app');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('shows the shared recovery state when the API rejects an invalid or expired link', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { fixture } = setup(
      { userId: '7', token: 'stale-token' },
      { confirmEmail: () => throwError(() => new EmailConfirmationLinkRejectedError()) },
    );

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(text(fixture)).toContain('This link is no longer valid');
    expect(text(fixture)).toContain('request a new confirmation link');
    expect(fixture.nativeElement.querySelector('[role="status"][aria-live="polite"]')?.textContent).toContain(
      'This confirmation link is no longer valid.',
    );
    expect(document.activeElement).toBe((fixture.nativeElement as HTMLElement).querySelector('h1'));

    error.mockRestore();
  });

  it('does not send an incomplete link to the API', async () => {
    const confirmEmail = vi.fn(() => of(undefined));
    const { fixture } = setup({ userId: '7' }, { confirmEmail });

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(confirmEmail).not.toHaveBeenCalled();
    expect(text(fixture)).toContain('This link is no longer valid');
  });

  it('does not send a malformed userId to the API', async () => {
    const confirmEmail = vi.fn(() => of(undefined));
    const { fixture } = setup({ userId: 'not-a-number', token: 'a-token' }, { confirmEmail });

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(confirmEmail).not.toHaveBeenCalled();
    expect(text(fixture)).toContain('This link is no longer valid');
  });

  it('offers a deliberate retry for a temporary failure without calling the link invalid', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const confirmEmail = vi
      .fn<AuthService['confirmEmail']>()
      .mockImplementationOnce(() => throwError(() => new Error('offline')))
      .mockImplementationOnce(() => of(undefined));
    const { fixture } = setup({ userId: '7', token: 'a-token' }, { confirmEmail });

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(text(fixture)).toContain('We couldn’t verify the result');
    expect(text(fixture)).not.toContain('This link is no longer valid');
    expect(button(fixture, 'Try again')).not.toBeNull();

    await click(fixture, 'Try again');

    expect(confirmEmail).toHaveBeenCalledTimes(2);
    expect(text(fixture)).toContain('Email confirmed');

    error.mockRestore();
  });

  it('disables retry while a confirmation request is still in flight', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const pending = new Subject<void>();
    const confirmEmail = vi
      .fn<AuthService['confirmEmail']>()
      .mockImplementationOnce(() => throwError(() => new Error('offline')))
      .mockImplementationOnce(() => pending);
    const { fixture } = setup({ userId: '7', token: 'a-token' }, { confirmEmail });

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const retry = button(fixture, 'Try again');
    if (!retry) {
      throw new Error('Expected the Try again button');
    }

    retry.focus();
    retry.click();
    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();

    expect(confirmEmail).toHaveBeenCalledTimes(2);
    expect(document.activeElement).toBe((fixture.nativeElement as HTMLElement).querySelector('h1'));
    const checkingAgain = button(fixture, 'Checking again…');
    expect(checkingAgain?.disabled).toBe(true);
    expect(button(fixture, 'Try again')).toBeNull();

    checkingAgain?.click();
    expect(confirmEmail).toHaveBeenCalledTimes(2);

    pending.complete();
    await fixture.whenStable();

    error.mockRestore();
  });
});
