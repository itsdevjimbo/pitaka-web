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
        description: 'Home',
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

  describe('create', () => {
    function newSchedule(over: Partial<Record<string, unknown>> = {}) {
      return {
        accountId: 2,
        categoryId: 4,
        name: 'Rent',
        direction: 'expense' as const,
        amount: 18500,
        description: 'Home',
        frequency: 'monthly' as const,
        firstGeneration: new Date(2026, 9, 1),
        lastGeneration: new Date(2027, 9, 1),
        ...over,
      };
    }

    it('POSTs the complete recurring-transaction request and maps the created Schedule', async () => {
      const result = firstValueFrom(service.create(newSchedule()));

      const request = http.expectOne(`${BASE_URL}/api/recurring-transactions`);
      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({
        accountId: 2,
        categoryId: 4,
        name: 'Rent',
        type: 'Expense',
        amount: 18500,
        description: 'Home',
        frequency: 'Monthly',
        startDate: '2026-10-01',
        endDate: '2027-10-01',
      });
      request.flush(
        resource({
          id: 12,
          startDate: '2026-10-01',
          endDate: '2027-10-01',
          nextRunDate: '2026-10-01',
        }),
      );

      await expect(result).resolves.toMatchObject({
        id: 12,
        description: 'Home',
        firstGeneration: new Date(2026, 9, 1),
        lastGeneration: new Date(2027, 9, 1),
        nextGeneration: new Date(2026, 9, 1),
        status: 'active',
      });
    });

    it('preserves the entered local calendar dates on the wire', async () => {
      const result = firstValueFrom(
        service.create(
          newSchedule({
            firstGeneration: new Date(2026, 8, 30, 23, 30),
            lastGeneration: null,
          }),
        ),
      );

      const request = http.expectOne(`${BASE_URL}/api/recurring-transactions`);
      expect(request.request.body.startDate).toBe('2026-09-30');
      expect(request.request.body.endDate).toBeNull();
      request.flush(resource({ startDate: '2026-09-30', endDate: null }));
      await result;
    });

    it('attributes a duplicate-name conflict to the name field', async () => {
      const result = firstValueFrom(service.create(newSchedule()));

      http
        .expectOne(`${BASE_URL}/api/recurring-transactions`)
        .flush(
          { detail: 'A recurring transaction with this name already exists.' },
          { status: 409, statusText: 'Conflict' },
        );

      const error = await result.catch((value: unknown) => value);
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).fieldErrors['name']).toEqual(['A Schedule with this name already exists.']);
    });

    it('leaves a non-name conflict unattributed for state-conflict recovery', async () => {
      const result = firstValueFrom(service.create(newSchedule()));

      http
        .expectOne(`${BASE_URL}/api/recurring-transactions`)
        .flush({ detail: 'The selected filing destination changed.' }, { status: 409, statusText: 'Conflict' });

      const error = await result.catch((value: unknown) => value);
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(409);
      expect((error as ApiError).fieldErrors).toEqual({});
    });

    it('translates API validation fields into Schedule product vocabulary', async () => {
      const result = firstValueFrom(service.create(newSchedule()));

      http.expectOne(`${BASE_URL}/api/recurring-transactions`).flush(
        {
          errors: {
            Type: ['Choose a direction.'],
            StartDate: ['Choose a later date.'],
            EndDate: ['Choose a later date.'],
          },
        },
        { status: 400, statusText: 'Bad Request' },
      );

      const error = (await result.catch((value: unknown) => value)) as ApiError;
      expect(error.fieldErrors).toEqual({
        direction: ['Choose a direction.'],
        firstGeneration: ['Choose a later date.'],
        lastGeneration: ['Choose a later date.'],
      });
    });

    it('keeps a retired-Category rejection attributed to the Category field', async () => {
      const result = firstValueFrom(service.create(newSchedule()));

      http
        .expectOne(`${BASE_URL}/api/recurring-transactions`)
        .flush({ errors: { CategoryId: ['Choose an active Category.'] } }, { status: 400, statusText: 'Bad Request' });

      const error = await result.catch((value: unknown) => value);
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).fieldErrors['categoryId']).toEqual(['Choose an active Category.']);
    });
  });
});
