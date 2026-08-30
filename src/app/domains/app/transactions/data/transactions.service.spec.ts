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

  describe('record', () => {
    // The offset the payload carries is the process timezone's — pin it to a
    // fixed, DST-free +05:30 so the sent `transactionDate` is exact.
    const pinTimezone = withPinnedTimezone();
    beforeEach(() => pinTimezone('Asia/Kolkata'));

    /** What a person supplies to record one, with sane income defaults. */
    function newTx(over: Partial<Record<string, unknown>> = {}) {
      return {
        accountId: 3,
        direction: 'income' as const,
        amount: 5000,
        date: new Date(2026, 7, 29, 9, 0, 0),
        categoryId: 2,
        transferToAccountId: null,
        ...over,
      };
    }

    it('POSTs an income to the un-scoped endpoint with its Category and an offset-stamped date', async () => {
      const result = firstValueFrom(service.record(newTx()));

      const request = http.expectOne(`${BASE_URL}/api/transactions`);
      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({
        accountId: 3,
        type: 'Income',
        amount: 5000,
        categoryId: 2,
        transactionDate: '2026-08-29T09:00:00+05:30',
        transferToAccountId: null,
      });

      request.flush(resource({ id: 55, type: 'Income', amount: 5000 }));
      await result;
    });

    it('sends an expense as its own type, still Category-filed, offset-stamped', async () => {
      const result = firstValueFrom(
        service.record(
          newTx({ direction: 'expense', amount: 120.5, categoryId: 4 })
        )
      );

      const request = http.expectOne(`${BASE_URL}/api/transactions`);
      expect(request.request.body).toEqual({
        accountId: 3,
        type: 'Expense',
        amount: 120.5,
        categoryId: 4,
        transactionDate: '2026-08-29T09:00:00+05:30',
        transferToAccountId: null,
      });

      request.flush(resource({ id: 56, type: 'Expense' }));
      await result;
    });

    it('forces categoryId to null on a Transfer even when the caller passes one', async () => {
      const result = firstValueFrom(
        service.record(
          newTx({
            direction: 'transfer',
            categoryId: 4,
            transferToAccountId: 9,
          })
        )
      );

      const request = http.expectOne(`${BASE_URL}/api/transactions`);
      expect(request.request.body).toMatchObject({
        type: 'Transfer',
        categoryId: null,
        transferToAccountId: 9,
      });

      request.flush(
        resource({
          id: 58,
          type: 'Transfer',
          categoryId: null,
          transferToAccountId: 9,
        })
      );
      await result;
    });

    it('forces transferToAccountId to null on an income or expense', async () => {
      const result = firstValueFrom(
        service.record(newTx({ direction: 'income', transferToAccountId: 9 }))
      );

      const request = http.expectOne(`${BASE_URL}/api/transactions`);
      expect(request.request.body).toMatchObject({
        type: 'Income',
        transferToAccountId: null,
      });

      request.flush(resource({ id: 59, type: 'Income' }));
      await result;
    });

    it('sends a Transfer with a destination Account and no Category', async () => {
      const result = firstValueFrom(
        service.record(
          newTx({
            direction: 'transfer',
            amount: 750,
            categoryId: null,
            transferToAccountId: 9,
          })
        )
      );

      const request = http.expectOne(`${BASE_URL}/api/transactions`);
      expect(request.request.body).toEqual({
        accountId: 3,
        type: 'Transfer',
        amount: 750,
        categoryId: null,
        transactionDate: '2026-08-29T09:00:00+05:30',
        transferToAccountId: 9,
      });

      request.flush(
        resource({
          id: 57,
          type: 'Transfer',
          categoryId: null,
          transferToAccountId: 9,
        })
      );
      await result;
    });

    it('maps the created row back to the domain shape', async () => {
      const result = firstValueFrom(service.record(newTx()));

      http
        .expectOne(`${BASE_URL}/api/transactions`)
        .flush(
          resource({ id: 99, type: 'Income', amount: 5000, categoryId: 2 })
        );

      await expect(result).resolves.toMatchObject({
        id: 99,
        direction: 'income',
        amount: 5000,
        categoryId: 2,
      });
    });

    it('surfaces a rejection with no body as a form-level ApiError with an empty field map', async () => {
      const result = firstValueFrom(service.record(newTx()));

      http
        .expectOne(`${BASE_URL}/api/transactions`)
        .flush(null, { status: 400, statusText: 'Bad Request' });

      const error = await result.catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(400);
      expect((error as ApiError).fieldErrors).toEqual({});
      expect((error as ApiError).message.length).toBeGreaterThan(0);
    });
  });
});
