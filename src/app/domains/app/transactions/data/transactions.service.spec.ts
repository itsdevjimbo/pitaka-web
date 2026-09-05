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
    // The API stores a person-recorded instant UTC, and its MySQL round-trip
    // drops the `Z` — so the wire value is naive but names a UTC time.
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
        date: new Date('2026-08-29T07:00:00Z'),
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

  describe('reading transactionDate off the wire', () => {
    const pinTimezone = withPinnedTimezone();
    beforeEach(() => pinTimezone('Asia/Manila')); // fixed, DST-free +08:00

    it('reads a person-recorded naive timestamp as UTC, converting to local time', async () => {
      const result = firstValueFrom(service.list(3));

      http.expectOne(`${BASE_URL}/api/accounts/3/transactions`).flush([
        resource({ recurringTransactionId: null, transactionDate: '2026-08-29T05:00:00' }),
      ]);

      // 05:00 UTC is 13:00 in Manila — the 1 PM the person entered, not 5 AM.
      const [tx] = await result;
      expect(tx.date.getHours()).toBe(13);
      expect(tx.date.getDate()).toBe(29);
    });

    it('reads a generated naive timestamp as a local wall-clock day', async () => {
      const result = firstValueFrom(service.list(3));

      http.expectOne(`${BASE_URL}/api/accounts/3/transactions`).flush([
        resource({ recurringTransactionId: 88, transactionDate: '2026-08-29T00:00:00' }),
      ]);

      // The bare midnight day is kept as written, never pulled UTC-wards.
      const [tx] = await result;
      expect(tx.date.getFullYear()).toBe(2026);
      expect(tx.date.getMonth()).toBe(7); // August
      expect(tx.date.getDate()).toBe(29);
      expect(tx.date.getHours()).toBe(0);
    });
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

  describe('refile', () => {
    // As with `record`, the sent `transactionDate` carries the process
    // timezone's offset — pin it DST-free so the wire value is exact.
    const pinTimezone = withPinnedTimezone();
    beforeEach(() => pinTimezone('Asia/Kolkata'));

    /** The Transaction as it stands before the correction, an expense by default. */
    function existing(over: Partial<Record<string, unknown>> = {}) {
      return {
        id: 42,
        amount: 120.5,
        direction: 'expense' as const,
        accountId: 3,
        transferToAccountId: null,
        date: new Date(2026, 7, 29, 9, 0, 0),
        categoryId: 4,
        generated: false,
        description: 'Coffee',
        tags: [{ id: 1, name: 'treats' }],
        ...over,
      };
    }

    /** The full mutable set the form hands over, defaulting to "nothing changed". */
    function correction(over: Partial<Record<string, unknown>> = {}) {
      return {
        date: new Date(2026, 7, 29, 9, 0, 0),
        categoryId: 4,
        description: 'Coffee',
        tagIds: [1],
        ...over,
      };
    }

    it('PUTs the by-id endpoint with the whole mutable set and an offset-stamped date', async () => {
      const result = firstValueFrom(
        service.refile(existing(), correction({ categoryId: 7 }))
      );

      const request = http.expectOne(`${BASE_URL}/api/transactions/42`);
      expect(request.request.method).toBe('PUT');
      expect(request.request.body).toEqual({
        transactionDate: '2026-08-29T09:00:00+05:30',
        categoryId: 7,
        description: 'Coffee',
        tagIds: [1],
      });

      request.flush(resource({ id: 42, categoryId: 7 }));
      await result;
    });

    it('carries an untouched note and Tags through a Category correction, so neither is nulled', async () => {
      const result = firstValueFrom(
        service.refile(
          existing({ description: 'Flat white', tags: [{ id: 2, name: 'work' }] }),
          correction({
            categoryId: 9,
            description: 'Flat white',
            tagIds: [2],
          })
        )
      );

      const request = http.expectOne(`${BASE_URL}/api/transactions/42`);
      expect(request.request.body).toEqual({
        transactionDate: '2026-08-29T09:00:00+05:30',
        categoryId: 9,
        description: 'Flat white',
        tagIds: [2],
      });

      request.flush(resource({ id: 42 }));
      await result;
    });

    it('sends categoryId and description as explicit keys even when cleared', async () => {
      const result = firstValueFrom(
        service.refile(
          existing(),
          correction({ categoryId: null, description: null, tagIds: [] })
        )
      );

      const request = http.expectOne(`${BASE_URL}/api/transactions/42`);
      expect(request.request.body).toEqual({
        transactionDate: '2026-08-29T09:00:00+05:30',
        categoryId: null,
        description: null,
        tagIds: [],
      });

      request.flush(resource({ id: 42, categoryId: null, description: null }));
      await result;
    });

    it('forces a Transfer to send no Category, even if the caller passes one', async () => {
      const result = firstValueFrom(
        service.refile(
          existing({ direction: 'transfer', transferToAccountId: 9, categoryId: null }),
          correction({ categoryId: 4 })
        )
      );

      const request = http.expectOne(`${BASE_URL}/api/transactions/42`);
      expect(request.request.body).toMatchObject({ categoryId: null });

      request.flush(
        resource({ id: 42, type: 'Transfer', categoryId: null, transferToAccountId: 9 })
      );
      await result;
    });

    it('maps the refiled row back to the domain shape', async () => {
      const result = firstValueFrom(
        service.refile(existing(), correction({ categoryId: 7 }))
      );

      http
        .expectOne(`${BASE_URL}/api/transactions/42`)
        .flush(resource({ id: 42, type: 'Expense', categoryId: 7 }));

      await expect(result).resolves.toMatchObject({
        id: 42,
        direction: 'expense',
        categoryId: 7,
      });
    });

    it('keeps a generated transaction generated after a refile', async () => {
      const result = firstValueFrom(
        service.refile(
          existing({ generated: true }),
          correction({ categoryId: 7 })
        )
      );

      http
        .expectOne(`${BASE_URL}/api/transactions/42`)
        .flush(resource({ id: 42, recurringTransactionId: 88, categoryId: 7 }));

      await expect(result).resolves.toMatchObject({ generated: true });
    });

    it('surfaces a bodyless rejection as a form-level ApiError with an empty field map', async () => {
      const result = firstValueFrom(
        service.refile(existing(), correction())
      );

      http
        .expectOne(`${BASE_URL}/api/transactions/42`)
        .flush(null, { status: 400, statusText: 'Bad Request' });

      const error = await result.catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(400);
      expect((error as ApiError).fieldErrors).toEqual({});
      expect((error as ApiError).message.length).toBeGreaterThan(0);
    });
  });

  describe('remove', () => {
    it('DELETEs the by-id endpoint and completes on a 204', async () => {
      const result = firstValueFrom(service.remove(42));

      const request = http.expectOne(`${BASE_URL}/api/transactions/42`);
      expect(request.request.method).toBe('DELETE');
      request.flush(null, { status: 204, statusText: 'No Content' });

      await expect(result).resolves.toBeUndefined();
    });

    it('collapses a 404 — the Transaction is gone or was never ours — to one not-found ApiError', async () => {
      const result = firstValueFrom(service.remove(42));

      http
        .expectOne(`${BASE_URL}/api/transactions/42`)
        .flush(null, { status: 404, statusText: 'Not Found' });

      const error = await result.catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(404);
      expect((error as ApiError).message.length).toBeGreaterThan(0);
    });

    it('gives a 403 the same not-found wording, never leaking that the row exists', async () => {
      const result = firstValueFrom(service.remove(42));

      http
        .expectOne(`${BASE_URL}/api/transactions/42`)
        .flush(null, { status: 403, statusText: 'Forbidden' });

      const error = await result.catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(403);
      expect((error as ApiError).message).toBe(
        "We couldn't find that. It may have been deleted, or it may not be yours."
      );
    });

    it('surfaces a server failure as a normalised ApiError the caller can show', async () => {
      const result = firstValueFrom(service.remove(42));

      http
        .expectOne(`${BASE_URL}/api/transactions/42`)
        .flush(null, { status: 500, statusText: 'Server Error' });

      const error = await result.catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(500);
      expect((error as ApiError).message.length).toBeGreaterThan(0);
    });
  });

  describe('search', () => {
    /** The envelope `GET /api/transactions` sends, with sane defaults. */
    function envelope(over: Partial<Record<string, unknown>> = {}) {
      return {
        data: [],
        page: 1,
        pageSize: 50,
        totalCount: 0,
        ...over,
      };
    }

    it('GETs the un-scoped endpoint with only page for empty criteria', async () => {
      const result = firstValueFrom(service.search({}, 1));

      const request = http.expectOne(
        (req) => req.url === `${BASE_URL}/api/transactions`
      );
      expect(request.request.method).toBe('GET');
      expect(request.request.params.keys().sort()).toEqual(['page']);
      expect(request.request.params.get('page')).toBe('1');

      request.flush(envelope());
      await result;
    });

    it('emits no parameter at all for an axis criteria leaves unset', async () => {
      const result = firstValueFrom(service.search({ accountId: 3 }, 2));

      const request = http.expectOne(
        (req) => req.url === `${BASE_URL}/api/transactions`
      );
      expect(request.request.params.keys().sort()).toEqual([
        'accountId',
        'page',
      ]);
      expect(request.request.params.get('accountId')).toBe('3');
      expect(request.request.params.get('page')).toBe('2');

      request.flush(envelope());
      await result;
    });

    it('serialises every axis when all three are set', async () => {
      const result = firstValueFrom(
        service.search(
          { direction: 'expense', accountId: 3, categoryId: 4 },
          1
        )
      );

      const request = http.expectOne(
        (req) => req.url === `${BASE_URL}/api/transactions`
      );
      expect(request.request.params.keys().sort()).toEqual([
        'accountId',
        'categoryId',
        'page',
        'type',
      ]);
      expect(request.request.params.get('accountId')).toBe('3');
      expect(request.request.params.get('categoryId')).toBe('4');
      expect(request.request.params.get('type')).toBe('Expense');

      request.flush(envelope());
      await result;
    });

    it("sends direction through the API's TransactionType casing for each value", async () => {
      for (const [direction, wireType] of [
        ['income', 'Income'],
        ['expense', 'Expense'],
        ['transfer', 'Transfer'],
      ] as const) {
        const result = firstValueFrom(service.search({ direction }, 1));

        const request = http.expectOne(
          (req) => req.url === `${BASE_URL}/api/transactions`
        );
        expect(request.request.params.get('type')).toBe(wireType);

        request.flush(envelope());
        await result;
      }
    });

    it('unwraps the envelope into rows and totalCount', async () => {
      const result = firstValueFrom(service.search({}, 1));

      http
        .expectOne((req) => req.url === `${BASE_URL}/api/transactions`)
        .flush(
          envelope({
            data: [resource({ id: 10 }), resource({ id: 11 })],
            totalCount: 37,
          })
        );

      const { transactions, totalCount } = await result;
      expect(transactions.map((t) => t.id)).toEqual([10, 11]);
      expect(totalCount).toBe(37);
    });

    it('maps a Transfer with both Account ids intact', async () => {
      const result = firstValueFrom(service.search({}, 1));

      http
        .expectOne((req) => req.url === `${BASE_URL}/api/transactions`)
        .flush(
          envelope({
            data: [
              resource({
                id: 1,
                type: 'Transfer',
                categoryId: null,
                accountId: 3,
                transferToAccountId: 9,
              }),
            ],
            totalCount: 1,
          })
        );

      const [tx] = (await result).transactions;
      expect(tx.direction).toBe('transfer');
      expect(tx.accountId).toBe(3);
      expect(tx.transferToAccountId).toBe(9);
    });

    it('narrowing by accountId still matches a Transfer arriving once', async () => {
      const result = firstValueFrom(service.search({ accountId: 9 }, 1));

      http
        .expectOne((req) => req.url === `${BASE_URL}/api/transactions`)
        .flush(
          envelope({
            data: [
              resource({
                id: 1,
                type: 'Transfer',
                categoryId: null,
                accountId: 3,
                transferToAccountId: 9,
              }),
            ],
            totalCount: 1,
          })
        );

      expect((await result).transactions).toHaveLength(1);
    });

    it('yields an empty list and a truthful totalCount for a page beyond the end', async () => {
      const result = firstValueFrom(service.search({}, 5));

      http
        .expectOne((req) => req.url === `${BASE_URL}/api/transactions`)
        .flush(envelope({ data: [], totalCount: 3 }));

      const { transactions, totalCount } = await result;
      expect(transactions).toEqual([]);
      expect(totalCount).toBe(3);
    });

    it('yields an empty list, not an error, for a Profile with no Transactions', async () => {
      const result = firstValueFrom(service.search({}, 1));

      http
        .expectOne((req) => req.url === `${BASE_URL}/api/transactions`)
        .flush(envelope({ data: [], totalCount: 0 }));

      await expect(result).resolves.toEqual({
        transactions: [],
        totalCount: 0,
      });
    });

    it('surfaces a server failure as a normalised ApiError', async () => {
      const result = firstValueFrom(service.search({}, 1));

      http
        .expectOne((req) => req.url === `${BASE_URL}/api/transactions`)
        .flush(null, { status: 500, statusText: 'Server Error' });

      const error = await result.catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(500);
      expect((error as ApiError).message.length).toBeGreaterThan(0);
    });

    describe('reading transactionDate off the wire', () => {
      const pinTimezone = withPinnedTimezone();
      beforeEach(() => pinTimezone('Asia/Manila')); // fixed, DST-free +08:00

      it('reads a person-recorded naive timestamp as UTC, converting to local time', async () => {
        const result = firstValueFrom(service.search({}, 1));

        http.expectOne((req) => req.url === `${BASE_URL}/api/transactions`).flush(
          envelope({
            data: [
              resource({
                recurringTransactionId: null,
                transactionDate: '2026-08-29T05:00:00',
              }),
            ],
            totalCount: 1,
          })
        );

        const [tx] = (await result).transactions;
        expect(tx.date.getHours()).toBe(13);
        expect(tx.date.getDate()).toBe(29);
      });

      it('reads a generated naive timestamp as a local wall-clock day', async () => {
        const result = firstValueFrom(service.search({}, 1));

        http.expectOne((req) => req.url === `${BASE_URL}/api/transactions`).flush(
          envelope({
            data: [
              resource({
                recurringTransactionId: 88,
                transactionDate: '2026-08-29T00:00:00',
              }),
            ],
            totalCount: 1,
          })
        );

        const [tx] = (await result).transactions;
        expect(tx.date.getFullYear()).toBe(2026);
        expect(tx.date.getMonth()).toBe(7); // August
        expect(tx.date.getDate()).toBe(29);
        expect(tx.date.getHours()).toBe(0);
      });
    });
  });
});
