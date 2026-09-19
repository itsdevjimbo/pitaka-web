import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { ApiError, API_BASE_URL, errorInterceptor } from '@/app/core/api';
import { TEST_API_BASE_URL as BASE_URL } from '@/testing/api-base-url';
import { withPinnedTimezone } from '@/testing/timezone';
import { SchedulesService } from './schedules.service';

function resource(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 7,
    accountId: 2,
    categoryId: 4,
    name: 'Rent',
    type: 'Expense',
    amount: 18500,
    description: 'Home',
    frequency: 'Monthly',
    startDate: '2026-08-01',
    endDate: null,
    nextRunDate: '2026-10-01',
    status: 'Active',
    generatedTransactionCount: 9,
    canDelete: false,
    ...over,
  };
}

describe('SchedulesService', () => {
  const pinTimezone = withPinnedTimezone();
  beforeEach(() => pinTimezone('America/New_York'));

  let service: SchedulesService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: BASE_URL },
      ],
    });
    service = TestBed.inject(SchedulesService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('GETs recurring transactions and translates the complete list resource', async () => {
    const result = firstValueFrom(service.list());

    const request = http.expectOne(`${BASE_URL}/api/recurring-transactions`);
    expect(request.request.method).toBe('GET');
    request.flush([resource()]);

    await expect(result).resolves.toEqual([
      {
        id: 7,
        accountId: 2,
        categoryId: 4,
        name: 'Rent',
        direction: 'expense',
        amount: 18500,
        frequency: 'monthly',
        firstGeneration: new Date(2026, 7, 1),
        lastGeneration: null,
        nextGeneration: new Date(2026, 9, 1),
        status: 'active',
        generatedTransactionCount: 9,
        canDelete: false,
      },
    ]);
  });

  it('preserves date-only values as local calendar days west of UTC', async () => {
    const result = firstValueFrom(service.list());

    http.expectOne(`${BASE_URL}/api/recurring-transactions`).flush([
      resource({
        startDate: '2026-08-01',
        endDate: '2026-12-31',
        nextRunDate: '2026-08-15',
      }),
    ]);

    const [schedule] = await result;
    expect(schedule.firstGeneration).toEqual(new Date(2026, 7, 1));
    expect(schedule.lastGeneration).toEqual(new Date(2026, 11, 31));
    expect(schedule.nextGeneration).toEqual(new Date(2026, 7, 15));
  });

  it('maps every lifecycle state and keeps Cancelled reversible in product vocabulary', async () => {
    const result = firstValueFrom(service.list());

    http.expectOne(`${BASE_URL}/api/recurring-transactions`).flush([
      resource({ id: 1, status: 'Active' }),
      resource({ id: 2, status: 'Paused' }),
      resource({ id: 3, status: 'Completed' }),
      resource({
        id: 4,
        status: 'Cancelled',
        generatedTransactionCount: 0,
        canDelete: false,
      }),
    ]);

    const schedules = await result;
    expect(schedules.map((schedule) => schedule.status)).toEqual(['active', 'paused', 'completed', 'cancelled']);
    expect(schedules[3].generatedTransactionCount).toBe(0);
    expect(schedules[3].canDelete).toBe(false);
  });

  it('surfaces list failures as normalized API errors', async () => {
    const result = firstValueFrom(service.list());

    http.expectOne(`${BASE_URL}/api/recurring-transactions`).flush(null, { status: 500, statusText: 'Server Error' });

    const error = await result.catch((value: unknown) => value);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(500);
  });
});
