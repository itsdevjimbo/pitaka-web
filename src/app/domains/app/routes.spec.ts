import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, RouterOutlet } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of } from 'rxjs';
import { routes } from '@/app/app.routes';
import { provideIcons } from '@/app/core/icons';
import { Session } from '@/app/core/session';
import { AccountsService } from './accounts';
import { AppLayout } from './layout/layout';

/**
 * Acceptance criterion: signing in lands on the Accounts route. Sign-in
 * navigates to `/app` (see `sign-in.ts`); this proves `/app` resolves the rest
 * of the way to the Accounts list for a signed-in visitor.
 */
describe('the app area routes', () => {
  it('sends a signed-in visitor from /app to the Accounts list', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideIcons(),
        { provide: Session, useValue: { isAuthenticated: () => true } },
        { provide: AccountsService, useValue: { list: () => of([]) } },
      ],
    });
    // The shell chrome is irrelevant here — swap it for a bare outlet so the
    // test is about routing, not the sidebar.
    TestBed.overrideComponent(AppLayout, {
      set: { template: '<router-outlet />', imports: [RouterOutlet] },
    });

    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/app');

    expect(TestBed.inject(Router).url).toBe('/app/accounts');
    expect(
      (harness.routeNativeElement as HTMLElement).textContent
    ).toContain('No accounts yet');
  });
});
