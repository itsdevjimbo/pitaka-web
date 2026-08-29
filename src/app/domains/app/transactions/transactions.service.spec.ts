import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { ApiError, API_BASE_URL, errorInterceptor } from '@/app/core/api';
import { TEST_API_BASE_URL as BASE_URL } from '@/testing/api-base-url';
import { TransactionsService } from './transactions.service';

/** One Transaction row shaped the way the API sends it, with sane defaults. */
function resource(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    userId: 7,
    accountId: 3,
    type: 'Expense',
    amount: 120.5,
    transactionDate: '2026-08-29T07:00:00',
    isRecurring: false,
    categoryId: 4,
    recurringTransactionId: null,
    transferToAccountId: null,
    description: 'Coffee',
    tags: [],
    ...over,
  };
}

/**
 * The HTTP adapter boundary for one Account's Transactions. Feeds real-shaped
 * `GET /api/accounts/:id/transactions` responses through the service and its
 * interceptor and asserts the domain shape that comes out the top.
 */
describe('TransactionsService', () => {
  let service: TransactionsService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: BASE_URL },
      ],
    });
    service = TestBed.inject(TransactionsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('GETs the per-Account endpoint and maps to the domain shape', async () => {
    const result = firstValueFrom(service.list(3));

    const request = http.expectOne(`${BASE_URL}/api/accounts/3/transactions`);
    expect(request.request.method).toBe('GET');
    request.flush([
      resource({
        id: 10,
        type: 'Expense',
        amount: 120.5,
        categoryId: 4,
        description: 'Coffee',
        tags: [{ id: 1, name: 'treats' }],
      }),
    ]);

    await expect(result).resolves.toEqual([
      {
        id: 10,
        amount: 120.5,
        direction: 'expense',
        date: new Date('2026-08-29T07:00:00'),
        accountId: 3,
        transferToAccountId: null,
        categoryId: 4,
        generated: false,
        description: 'Coffee',
        tags: [{ id: 1, name: 'treats' }],
      },
    ]);
  });

  it('keeps the source and destination Account ids so a Transfer can be signed', async () => {
    const result = firstValueFrom(service.list(3));

    http.expectOne(`${BASE_URL}/api/accounts/3/transactions`).flush([
      resource({
        id: 1,
        type: 'Transfer',
        accountId: 3,
        transferToAccountId: 9,
      }),
    ]);

    const [tx] = await result;
    expect(tx.accountId).toBe(3);
    expect(tx.transferToAccountId).toBe(9);
  });

  it('reads each transaction type as a direction', async () => {
    const result = firstValueFrom(service.list(3));

    http
      .expectOne(`${BASE_URL}/api/accounts/3/transactions`)
      .flush([
        resource({ id: 1, type: 'Income' }),
        resource({ id: 2, type: 'Expense' }),
        resource({ id: 3, type: 'Transfer', categoryId: null }),
      ]);

    const directions = (await result).map((t) => t.direction);
    expect(directions).toEqual(['income', 'expense', 'transfer']);
  });

  it('marks a Transaction a Schedule created as generated', async () => {
    const result = firstValueFrom(service.list(3));

    http
      .expectOne(`${BASE_URL}/api/accounts/3/transactions`)
      .flush([
        resource({ id: 1, recurringTransactionId: 88, isRecurring: true }),
        resource({ id: 2, recurringTransactionId: null }),
      ]);

    expect((await result).map((t) => t.generated)).toEqual([true, false]);
  });

  it('parses a wall-clock timestamp (no zone) as local, keeping the calendar day', async () => {
    const result = firstValueFrom(service.list(3));

    http
      .expectOne(`${BASE_URL}/api/accounts/3/transactions`)
      .flush([resource({ transactionDate: '2026-08-29T00:00:00' })]);

    const [tx] = await result;
    expect(tx.date.getFullYear()).toBe(2026);
    expect(tx.date.getMonth()).toBe(7); // August
    expect(tx.date.getDate()).toBe(29);
  });

  it('yields an empty list, not an error, for an Account with no Transactions', async () => {
    const result = firstValueFrom(service.list(3));

    http.expectOne(`${BASE_URL}/api/accounts/3/transactions`).flush([]);

    await expect(result).resolves.toEqual([]);
  });

  it('surfaces a server failure as a normalised ApiError', async () => {
    const result = firstValueFrom(service.list(3));

    http
      .expectOne(`${BASE_URL}/api/accounts/3/transactions`)
      .flush(null, { status: 404, statusText: 'Not Found' });

    const error = await result.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(404);
  });
});
