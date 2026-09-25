import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, RouterOutlet } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of } from 'rxjs';
import { routes } from '@/app/app.routes';
import { AuthService, Profile } from '@/app/core/auth';
import { provideIcons } from '@/app/core/icons';
import { Session } from '@/app/core/session';
import { AccountsService } from './accounts';
import { CategoriesService } from './categories';
import { GoalsService } from './goals';
import { AppLayout } from './layout/layout';
import { SchedulesService } from './schedules';
import { TransactionsService } from './transactions';

/**
 * Acceptance criterion: signing in lands on the Accounts route. Sign-in
 * navigates to `/app` (see `sign-in.ts`); this proves `/app` resolves the rest
 * of the way to the Accounts list for a signed-in visitor.
 */
describe('the app area routes', () => {
  const ada: Profile = {
    id: 7,
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    pendingEmail: null,
    hasPicture: false,
  };

  it('sends a signed-in visitor from /app to the Accounts list', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideIcons(),
        { provide: Session, useValue: { isAuthenticated: () => true } },
        { provide: AccountsService, useValue: { all: () => of([]) } },
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
    expect((harness.routeNativeElement as HTMLElement).textContent).toContain('No accounts yet');
  });

  it('resolves /app/transactions to the Transactions list, lazily loaded', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideIcons(),
        { provide: Session, useValue: { isAuthenticated: () => true } },
        { provide: AccountsService, useValue: { all: () => of([]) } },
        {
          provide: TransactionsService,
          useValue: { search: () => of({ transactions: [], totalCount: 0 }) },
        },
        {
          provide: CategoriesService,
          useValue: { list: () => of([]), all: () => of([]), names: () => of(new Map()) },
        },
      ],
    });
    TestBed.overrideComponent(AppLayout, {
      set: { template: '<router-outlet />', imports: [RouterOutlet] },
    });

    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/app/transactions');

    expect(TestBed.inject(Router).url).toBe('/app/transactions');
    expect((harness.routeNativeElement as HTMLElement).textContent).toContain('No transactions yet');
  });

  it('resolves /app/categories to the Categories screen, lazily loaded', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideIcons(),
        { provide: Session, useValue: { isAuthenticated: () => true } },
        { provide: AccountsService, useValue: { all: () => of([]) } },
        { provide: CategoriesService, useValue: { readAll: () => of([]) } },
      ],
    });
    TestBed.overrideComponent(AppLayout, {
      set: { template: '<router-outlet />', imports: [RouterOutlet] },
    });

    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/app/categories');

    expect(TestBed.inject(Router).url).toBe('/app/categories');
    expect((harness.routeNativeElement as HTMLElement).textContent).toContain('Expense');
  });

  it('resolves /app/goals to the Goals list, lazily loaded', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideIcons(),
        { provide: Session, useValue: { isAuthenticated: () => true } },
        { provide: GoalsService, useValue: { list: () => of([]) } },
      ],
    });
    TestBed.overrideComponent(AppLayout, {
      set: { template: '<router-outlet />', imports: [RouterOutlet] },
    });

    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/app/goals');

    expect(TestBed.inject(Router).url).toBe('/app/goals');
    expect((harness.routeNativeElement as HTMLElement).textContent).toContain('No goals yet');
  });

  it('resolves /app/schedules to the lifecycle browser, lazily loaded', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideIcons(),
        { provide: Session, useValue: { isAuthenticated: () => true } },
        { provide: SchedulesService, useValue: { list: () => of([]) } },
        { provide: AccountsService, useValue: { all: () => of([]) } },
        { provide: CategoriesService, useValue: { all: () => of([]) } },
      ],
    });
    TestBed.overrideComponent(AppLayout, {
      set: { template: '<router-outlet />', imports: [RouterOutlet] },
    });

    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/app/schedules');

    expect(TestBed.inject(Router).url).toBe('/app/schedules');
    expect((harness.routeNativeElement as HTMLElement).textContent).toContain('No Schedules yet');
  });

  it('resolves /app/profile to the live identity dashboard', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideIcons(),
        { provide: AuthService, useValue: { uploadProfilePicture: vi.fn() } },
        {
          provide: Session,
          useValue: {
            isAuthenticated: () => true,
            profile: () => ada,
            profilePictureUrl: () => null,
            profilePictureOperationPending: () => false,
            profilePictureDecodeFailed: vi.fn(),
          },
        },
      ],
    });
    TestBed.overrideComponent(AppLayout, {
      set: { template: '<router-outlet />', imports: [RouterOutlet] },
    });

    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/app/profile');

    expect(TestBed.inject(Router).url).toBe('/app/profile');
    expect((harness.routeNativeElement as HTMLElement).textContent).toContain('Ada Lovelace');
  });
});
