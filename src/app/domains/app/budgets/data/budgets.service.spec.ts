import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { ApiError, API_BASE_URL, errorInterceptor } from '@/app/core/api';
import { TEST_API_BASE_URL as BASE_URL } from '@/testing/api-base-url';
import { withPinnedTimezone } from '@/testing/timezone';
import { BudgetsService } from './budgets.service';

/** One Budget row shaped the way `GET /api/budgets` sends it, with sane defaults. */
function resource(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    name: 'Groceries',
    amountLimit: 20000,
    period: 'Monthly',
    startDate: '2026-08-01',
    endDate: null,
    categoryId: 4,
    description: null,
    // GET carries these too (ADR 0012); this slice reads none of them.
    amountSpent: 5000,
    cycleStart: '2026-08-01',
    cycleEnd: '2026-08-31',
    ...over,
  };
}

/**
 * The HTTP adapter boundary for Budgets (ADR 0002). Feeds real-shaped responses
 * through the service and its interceptor and asserts the domain shape out the
 * top — the `DateOnly` ↔ calendar `Date` conversion both ways (ADR 0011), the
 * `Period` lowering, and the duplicate-name 409 refiled as a `name` field error.
 *
 * A **negative UTC offset is pinned** throughout: `new Date("2026-08-01")` would
 * parse as UTC midnight and render 31 July here, which is exactly the bug the
 * calendar conversion exists to avoid (ADR 0011).
 */
describe('BudgetsService', () => {
  const pinTimezone = withPinnedTimezone();
  beforeEach(() => pinTimezone('America/New_York'));

  let service: BudgetsService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: BASE_URL },
      ],
    });
    service = TestBed.inject(BudgetsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  describe('list', () => {
    it('GETs /api/budgets and maps to the domain shape', async () => {
      const result = firstValueFrom(service.list());

      const request = http.expectOne(`${BASE_URL}/api/budgets`);
      expect(request.request.method).toBe('GET');
      request.flush([
        resource({
          id: 10,
          name: 'Groceries',
          amountLimit: 20000,
          period: 'Monthly',
          startDate: '2026-08-01',
          endDate: '2026-12-31',
          categoryId: 4,
        }),
      ]);

      const [budget] = await result;
      expect(budget).toEqual({
        id: 10,
        name: 'Groceries',
        amountLimit: 20000,
        period: 'monthly',
        startDate: new Date(2026, 7, 1),
        endDate: new Date(2026, 11, 31),
        categoryId: 4,
      });
    });

    it('parses startDate at local midnight, not the UTC-midnight day before', async () => {
      const result = firstValueFrom(service.list());

      http
        .expectOne(`${BASE_URL}/api/budgets`)
        .flush([resource({ startDate: '2026-08-01' })]);

      const [budget] = await result;
      expect(budget.startDate.getFullYear()).toBe(2026);
      expect(budget.startDate.getMonth()).toBe(7); // August, not July
      expect(budget.startDate.getDate()).toBe(1);
    });

    it('keeps a null endDate as null', async () => {
      const result = firstValueFrom(service.list());

      http
        .expectOne(`${BASE_URL}/api/budgets`)
        .flush([resource({ endDate: null })]);

      expect((await result)[0].endDate).toBeNull();
    });

    it('lowers each Period the way CategoryKind is lowered', async () => {
      const result = firstValueFrom(service.list());

      http
        .expectOne(`${BASE_URL}/api/budgets`)
        .flush([
          resource({ id: 1, period: 'Daily' }),
          resource({ id: 2, period: 'Weekly' }),
          resource({ id: 3, period: 'Monthly' }),
          resource({ id: 4, period: 'Quarterly' }),
          resource({ id: 5, period: 'Yearly' }),
        ]);

      expect((await result).map((b) => b.period)).toEqual([
        'daily',
        'weekly',
        'monthly',
        'quarterly',
        'yearly',
      ]);
    });

    it('reads a Budget with a null categoryId as watching all spending', async () => {
      const result = firstValueFrom(service.list());

      http
        .expectOne(`${BASE_URL}/api/budgets`)
        .flush([resource({ categoryId: null })]);

      expect((await result)[0].categoryId).toBeNull();
    });

    it('drops the Spent figure and Cycle window this slice does not render', async () => {
      const result = firstValueFrom(service.list());

      http.expectOne(`${BASE_URL}/api/budgets`).flush([resource()]);

      const [budget] = await result;
      expect(budget).not.toHaveProperty('amountSpent');
      expect(budget).not.toHaveProperty('cycleStart');
      expect(budget).not.toHaveProperty('description');
    });

    it('yields an empty list, not an error, when the person has no Budgets', async () => {
      const result = firstValueFrom(service.list());

      http.expectOne(`${BASE_URL}/api/budgets`).flush([]);

      await expect(result).resolves.toEqual([]);
    });

    it('surfaces a server failure as a normalised ApiError', async () => {
      const result = firstValueFrom(service.list());

      http
        .expectOne(`${BASE_URL}/api/budgets`)
        .flush(null, { status: 500, statusText: 'Server Error' });

      const error = await result.catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(500);
    });
  });

  describe('create', () => {
    /** What the form hands over, defaulting to a monthly Groceries Budget. */
    function newBudget(over: Partial<Record<string, unknown>> = {}) {
      return {
        name: 'Groceries',
        amountLimit: 20000,
        period: 'monthly' as const,
        startDate: new Date(2026, 7, 1),
        categoryId: 4,
        ...over,
      };
    }

    it('POSTs /api/budgets with the five fields, Period raised and startDate as YYYY-MM-DD', async () => {
      const result = firstValueFrom(service.create(newBudget()));

      const request = http.expectOne(`${BASE_URL}/api/budgets`);
      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({
        name: 'Groceries',
        amountLimit: 20000,
        period: 'Monthly',
        startDate: '2026-08-01',
        categoryId: 4,
      });

      request.flush(resource({ id: 55 }));
      await result;
    });

    it('assembles startDate from local getters, not toISOString', async () => {
      // 23:30 local on 31 July is already 1 August in UTC; the calendar day the
      // person picked is 31 July and that is what must go on the wire.
      const result = firstValueFrom(
        service.create(newBudget({ startDate: new Date(2026, 6, 31, 23, 30) }))
      );

      const request = http.expectOne(`${BASE_URL}/api/budgets`);
      expect(request.request.body.startDate).toBe('2026-07-31');

      request.flush(resource({ id: 56 }));
      await result;
    });

    it('sends categoryId null for a Budget over all spending', async () => {
      const result = firstValueFrom(
        service.create(newBudget({ categoryId: null }))
      );

      const request = http.expectOne(`${BASE_URL}/api/budgets`);
      expect(request.request.body.categoryId).toBeNull();

      request.flush(resource({ id: 57, categoryId: null }));
      await result;
    });

    it('maps the created row back to the domain shape', async () => {
      const result = firstValueFrom(service.create(newBudget()));

      http
        .expectOne(`${BASE_URL}/api/budgets`)
        .flush(
          resource({ id: 99, period: 'Monthly', startDate: '2026-08-01' })
        );

      await expect(result).resolves.toMatchObject({
        id: 99,
        period: 'monthly',
        startDate: new Date(2026, 7, 1),
      });
    });

    it('refiles the duplicate-name 409 as a name field error', async () => {
      const result = firstValueFrom(service.create(newBudget()));

      http.expectOne(`${BASE_URL}/api/budgets`).flush(
        { detail: 'A budget with this name already exists.' },
        { status: 409, statusText: 'Conflict' }
      );

      const error = await result.catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(409);
      expect((error as ApiError).fieldErrors['name']).toEqual([
        'A budget with this name already exists.',
      ]);
    });

    it('leaves a non-409 failure untouched — no field map invented', async () => {
      const result = firstValueFrom(service.create(newBudget()));

      http
        .expectOne(`${BASE_URL}/api/budgets`)
        .flush(null, { status: 400, statusText: 'Bad Request' });

      const error = await result.catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(400);
      expect((error as ApiError).fieldErrors).toEqual({});
    });
  });
});
