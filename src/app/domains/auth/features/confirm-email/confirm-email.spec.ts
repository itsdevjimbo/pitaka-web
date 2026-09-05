import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { AuthService } from '@/app/core/auth';
import { provideIcons } from '@/app/core/icons';
import { Session } from '@/app/core/session';
import AuthConfirmEmail from './confirm-email';

/**
 * The confirm-email screen's own seam (ADR 0015). It fires the confirm on
 * init off the query string, and what happens next is the whole spec: a live
 * session is left alone and sent into the app, a signed-out one is sent to
 * sign-in already told, and everything that is not a clean success — a
 * failure, or a param that was never going to produce one — lands on the
 * shared dead-link state rather than being told apart.
 */
describe('AuthConfirmEmail', () => {
  function setup(
    queryParams: Record<string, string>,
    {
      confirmEmail = () => of(undefined),
      isAuthenticated = false,
    }: {
      confirmEmail?: AuthService['confirmEmail'];
      isAuthenticated?: boolean;
    } = {}
  ) {
    const navigate = vi.fn(() => Promise.resolve(true));
    const navigateByUrl = vi.fn(() => Promise.resolve(true));

    TestBed.configureTestingModule({
      imports: [AuthConfirmEmail],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
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

  it('confirms with the userId coerced to a number and the token as given', async () => {
    const confirmEmail = vi.fn(() => of(undefined));
    const { fixture } = setup({ userId: '7', token: 'a-token' }, { confirmEmail });

    fixture.detectChanges();
    await fixture.whenStable();

    expect(confirmEmail).toHaveBeenCalledWith(7, 'a-token');
  });

  it('shows a spinner while the confirm is in flight', () => {
    const { fixture } = setup(
      { userId: '7', token: 'a-token' },
      { confirmEmail: () => new Subject() }
    );

    fixture.detectChanges();

    expect(text(fixture)).toContain('Confirming your email');
  });

  it('sends a signed-out visitor to sign-in, told why they are back', async () => {
    const { fixture, navigate } = setup(
      { userId: '7', token: 'a-token' },
      { isAuthenticated: false }
    );

    fixture.detectChanges();
    await fixture.whenStable();

    expect(navigate).toHaveBeenCalledWith(['/auth/sign-in'], {
      queryParams: { reason: 'email-confirmed' },
    });
  });

  it('sends someone who already has a session into the app, not to sign-in', async () => {
    const { fixture, navigateByUrl, navigate } = setup(
      { userId: '7', token: 'a-token' },
      { isAuthenticated: true }
    );

    fixture.detectChanges();
    await fixture.whenStable();

    expect(navigateByUrl).toHaveBeenCalledWith('/app');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('lands on the dead-link state when the API rejects the confirm', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { fixture } = setup(
      { userId: '7', token: 'stale-token' },
      { confirmEmail: () => throwError(() => new Error('gone')) }
    );

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(text(fixture)).toContain('This link is no longer valid');

    error.mockRestore();
  });

  it('lands on the dead-link state for a missing token, without calling the API', async () => {
    const confirmEmail = vi.fn(() => of(undefined));
    const { fixture } = setup({ userId: '7' }, { confirmEmail });

    fixture.detectChanges();
    await fixture.whenStable();

    expect(confirmEmail).not.toHaveBeenCalled();
    expect(text(fixture)).toContain('This link is no longer valid');
  });

  /**
   * `ConfirmEmailRequest.UserId` is an `int` with no `AllowReadingFromString`
   * on the API, so sending the string a query param hands back would come back
   * a 400 this screen would render as a dead link anyway — but coercing here
   * catches it before the round trip, and without misreporting a link that
   * merely lacks a numeric-looking id as one the server rejected.
   */
  it('lands on the dead-link state for a non-integer userId, without calling the API', async () => {
    const confirmEmail = vi.fn(() => of(undefined));
    const { fixture } = setup(
      { userId: 'not-a-number', token: 'a-token' },
      { confirmEmail }
    );

    fixture.detectChanges();
    await fixture.whenStable();

    expect(confirmEmail).not.toHaveBeenCalled();
    expect(text(fixture)).toContain('This link is no longer valid');
  });

  it('never fires the confirm twice, even if init ran more than once', async () => {
    const confirmEmail = vi.fn(() => of(undefined));
    const { fixture } = setup({ userId: '7', token: 'a-token' }, { confirmEmail });

    fixture.componentInstance.ngOnInit();
    await fixture.componentInstance.ngOnInit();

    expect(confirmEmail).toHaveBeenCalledTimes(1);
  });
});
