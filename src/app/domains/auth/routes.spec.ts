import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, RouterOutlet } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of } from 'rxjs';
import { routes } from '@/app/app.routes';
import { API_BASE_URL } from '@/app/core/api';
import { provideIcons } from '@/app/core/icons';
import { Session } from '@/app/core/session';
import { AccountsService } from '@/app/domains/app/accounts';
import { AppLayout } from '@/app/domains/app/layout/layout';
import { TEST_API_BASE_URL } from '@/testing/api-base-url';

/**
 * Acceptance criterion for the reset arc's entrance (#70): someone who has
 * forgotten their password can find the way out from sign-in, and it goes
 * somewhere. The screens' own behaviour is proved at their seams; what is proved
 * here is that the two are wired together and sit on the right side of
 * `guestGuard`.
 */
describe('the auth area routes', () => {
  function setup(isAuthenticated = false) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideIcons(),
        { provide: API_BASE_URL, useValue: TEST_API_BASE_URL },
        {
          provide: Session,
          useValue: { isAuthenticated: () => isAuthenticated },
        },
        { provide: AccountsService, useValue: { list: () => of([]) } },
      ],
    });
    // Where the guard sends a signed-in visitor is the app shell, whose chrome
    // is irrelevant here — swap it for a bare outlet so this stays a test about
    // the auth routes.
    TestBed.overrideComponent(AppLayout, {
      set: { template: '<router-outlet />', imports: [RouterOutlet] },
    });
  }

  it('offers the way out on sign-in, pointing at the forgot-password screen', async () => {
    setup();

    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/auth/sign-in');

    const link = (
      harness.routeNativeElement as HTMLElement
    ).querySelector<HTMLAnchorElement>('a[href="/auth/forgot-password"]');
    expect(link?.textContent?.trim()).toBe('Forgot password?');
  });

  it('resolves /auth/forgot-password for a guest', async () => {
    setup();

    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/auth/forgot-password');

    expect(TestBed.inject(Router).url).toBe('/auth/forgot-password');
    expect((harness.routeNativeElement as HTMLElement).textContent).toContain(
      'Forgot password?'
    );
  });

  /**
   * Unlike the two link-landing screens, this one is a guest action a live
   * session makes meaningless, so it belongs behind `guestGuard` (ADR 0015).
   */
  it('sends someone who already has a session into the app instead', async () => {
    setup(true);

    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/auth/forgot-password');

    expect(TestBed.inject(Router).url.startsWith('/app')).toBe(true);
  });
});
