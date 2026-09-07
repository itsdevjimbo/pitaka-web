import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { ApiError, API_BASE_URL, errorInterceptor } from '@/app/core/api';
import { TEST_API_BASE_URL as BASE_URL } from '@/testing/api-base-url';
import { CategoriesService } from './categories.service';
import { CategoryInUseError } from './category-errors';

/** One Category row shaped the way `GET /api/categories` sends it. */
function resource(
  id: number,
  name: string,
  over: Partial<{
    type: 'Income' | 'Expense';
    isDefault: boolean;
    isActive: boolean;
  }> = {}
) {
  return {
    id,
    name,
    type: over.type ?? 'Expense',
    isDefault: over.isDefault ?? false,
    isActive: over.isActive ?? true,
  };
}

/** A ProblemDetails body shaped the way the API sends its bare 409s. */
function problem(detail: string) {
  return {
    type: 'https://tools.ietf.org/html/rfc9110#section-15.5.10',
    title: 'Conflict',
    status: 409,
    detail,
  };
}

const CATEGORIES_URL = `${BASE_URL}/api/categories`;

/**
 * The reference-cache boundary. Feeds real wire-shaped JSON through the service
 * and the real `errorInterceptor`, and asserts what comes out the top: which
 * set each of the four readers returns, that `isActive` survives the adapter,
 * that each of the five writes drops the cache (proven by a later read issuing a
 * second request), and that the two 409 meanings arrive distinguishably.
 */
describe('CategoriesService', () => {
  let service: CategoriesService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: BASE_URL },
      ],
    });
    service = TestBed.inject(CategoriesService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  describe('the four readers', () => {
    it('names() resolves ids to names across the whole set, retired included', async () => {
      const result = firstValueFrom(service.names());

      const request = http.expectOne(CATEGORIES_URL);
      expect(request.request.method).toBe('GET');
      request.flush([
        resource(1, 'Groceries'),
        resource(2, 'Motoring', { isActive: false }),
      ]);

      const names = await result;
      expect(names.get(1)).toBe('Groceries');
      expect(names.get(2)).toBe('Motoring');
      expect(names.get(99)).toBeUndefined();
    });

    it('list() returns the active Categories only, each carrying its kind', async () => {
      const result = firstValueFrom(service.list());

      http
        .expectOne(CATEGORIES_URL)
        .flush([
          resource(1, 'Groceries', { type: 'Expense' }),
          resource(2, 'Salary', { type: 'Income' }),
          resource(3, 'Motoring', { type: 'Expense', isActive: false }),
        ]);

      await expect(result).resolves.toEqual([
        { id: 1, name: 'Groceries', kind: 'expense', isActive: true, isDefault: false },
        { id: 2, name: 'Salary', kind: 'income', isActive: true, isDefault: false },
      ]);
    });

    it('all() returns the whole set, retired included, carrying kind and isActive', async () => {
      const result = firstValueFrom(service.all());

      http
        .expectOne(CATEGORIES_URL)
        .flush([
          resource(1, 'Groceries', { type: 'Expense' }),
          resource(3, 'Motoring', { type: 'Expense', isActive: false }),
        ]);

      await expect(result).resolves.toEqual([
        { id: 1, name: 'Groceries', kind: 'expense', isActive: true, isDefault: false },
        { id: 3, name: 'Motoring', kind: 'expense', isActive: false, isDefault: false },
      ]);
    });

    it('lifts isDefault through the adapter, so a supplied Category reads as one', async () => {
      const result = firstValueFrom(service.all());

      http
        .expectOne(CATEGORIES_URL)
        .flush([
          resource(1, 'Groceries', { isDefault: true }),
          resource(2, 'Holidays', { isDefault: false }),
        ]);

      await expect(result).resolves.toEqual([
        { id: 1, name: 'Groceries', kind: 'expense', isActive: true, isDefault: true },
        { id: 2, name: 'Holidays', kind: 'expense', isActive: true, isDefault: false },
      ]);
    });

    it('shares the one cached request between names(), list() and all()', async () => {
      const all = firstValueFrom(service.all());
      http.expectOne(CATEGORIES_URL).flush([resource(1, 'Groceries')]);
      await all;

      const names = await firstValueFrom(service.names());
      const list = await firstValueFrom(service.list());
      http.expectNone(CATEGORIES_URL);
      expect(names.get(1)).toBe('Groceries');
      expect(list).toEqual([
        { id: 1, name: 'Groceries', kind: 'expense', isActive: true, isDefault: false },
      ]);
    });

    it('readAll() is cold — it re-requests even when the cache is warm', async () => {
      const warm = firstValueFrom(service.all());
      http.expectOne(CATEGORIES_URL).flush([resource(1, 'Groceries')]);
      await warm;

      const cold = firstValueFrom(service.readAll());
      http.expectOne(CATEGORIES_URL).flush([
        resource(1, 'Groceries'),
        resource(3, 'Motoring', { isActive: false }),
      ]);

      await expect(cold).resolves.toEqual([
        { id: 1, name: 'Groceries', kind: 'expense', isActive: true, isDefault: false },
        { id: 3, name: 'Motoring', kind: 'expense', isActive: false, isDefault: false },
      ]);
    });

    it('readAll() does not populate the cache the other readers share', async () => {
      const cold = firstValueFrom(service.readAll());
      http.expectOne(CATEGORIES_URL).flush([resource(1, 'Groceries')]);
      await cold;

      // A cached reader still has to make the first shared request.
      const warm = firstValueFrom(service.names());
      http.expectOne(CATEGORIES_URL).flush([resource(1, 'Groceries')]);
      expect((await warm).get(1)).toBe('Groceries');
    });

    it('fetches once and replays to every later reader', async () => {
      const first = firstValueFrom(service.names());
      http.expectOne(CATEGORIES_URL).flush([resource(1, 'Groceries')]);
      await first;

      const second = await firstValueFrom(service.names());
      http.expectNone(CATEGORIES_URL);
      expect(second.get(1)).toBe('Groceries');
    });

    it('surfaces a server failure as a normalised ApiError', async () => {
      const result = firstValueFrom(service.names());

      http
        .expectOne(CATEGORIES_URL)
        .flush(null, { status: 500, statusText: 'Internal Server Error' });

      const error = await result.catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ApiError);
    });

    it('does not cache a failed fetch — the next read retries', async () => {
      const failed = firstValueFrom(service.names());
      http
        .expectOne(CATEGORIES_URL)
        .flush(null, { status: 503, statusText: 'Service Unavailable' });
      await failed.catch(() => undefined);

      const retried = firstValueFrom(service.names());
      http.expectOne(CATEGORIES_URL).flush([resource(1, 'Groceries')]);

      expect((await retried).get(1)).toBe('Groceries');
    });
  });

  describe('create', () => {
    it('POSTs the name and the raised kind, and returns the created Category', async () => {
      const result = firstValueFrom(
        service.create({ name: 'Holidays', kind: 'expense' })
      );

      const request = http.expectOne(CATEGORIES_URL);
      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({
        name: 'Holidays',
        type: 'Expense',
      });
      request.flush(resource(7, 'Holidays'), {
        status: 201,
        statusText: 'Created',
      });

      await expect(result).resolves.toEqual({
        id: 7,
        name: 'Holidays',
        kind: 'expense',
        isActive: true,
        isDefault: false,
      });
    });

    it('re-files a duplicate-name 409 as a name field error', async () => {
      const result = firstValueFrom(
        service.create({ name: 'Groceries', kind: 'expense' })
      );

      http
        .expectOne(CATEGORIES_URL)
        .flush(problem('A category with this name already exists.'), {
          status: 409,
          statusText: 'Conflict',
        });

      const error = await result.catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(409);
      expect((error as ApiError).fieldErrors).toEqual({
        name: ['A category with this name already exists.'],
      });
    });

    it('camelCases a PascalCase validation error so it binds to the name control', async () => {
      const result = firstValueFrom(
        service.create({ name: '', kind: 'income' })
      );

      http.expectOne(CATEGORIES_URL).flush(
        {
          title: 'One or more validation errors occurred.',
          status: 400,
          errors: { Name: ['The Name field is required.'] },
        },
        { status: 400, statusText: 'Bad Request' }
      );

      const error = await result.catch((e: unknown) => e);
      expect((error as ApiError).fieldErrors).toEqual({
        name: ['The Name field is required.'],
      });
    });
  });

  describe('rename', () => {
    it('PUTs the new name to /{id} and returns the updated Category', async () => {
      const result = firstValueFrom(service.rename(7, 'Vacations'));

      const request = http.expectOne(`${CATEGORIES_URL}/7`);
      expect(request.request.method).toBe('PUT');
      expect(request.request.body).toEqual({ name: 'Vacations' });
      request.flush(resource(7, 'Vacations'));

      await expect(result).resolves.toEqual({
        id: 7,
        name: 'Vacations',
        kind: 'expense',
        isActive: true,
        isDefault: false,
      });
    });

    it('re-files a duplicate-name 409 as a name field error', async () => {
      const result = firstValueFrom(service.rename(7, 'Groceries'));

      http
        .expectOne(`${CATEGORIES_URL}/7`)
        .flush(problem('A category with this name already exists.'), {
          status: 409,
          statusText: 'Conflict',
        });

      const error = await result.catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).fieldErrors).toEqual({
        name: ['A category with this name already exists.'],
      });
    });
  });

  describe('setActive', () => {
    it('PATCHes /{id}/status with isActive false to retire, and returns the row', async () => {
      const result = firstValueFrom(service.setActive(7, false));

      const request = http.expectOne(`${CATEGORIES_URL}/7/status`);
      expect(request.request.method).toBe('PATCH');
      expect(request.request.body).toEqual({ isActive: false });
      request.flush(resource(7, 'Holidays', { isActive: false }));

      await expect(result).resolves.toEqual({
        id: 7,
        name: 'Holidays',
        kind: 'expense',
        isActive: false,
        isDefault: false,
      });
    });

    it('PATCHes isActive true to reactivate', async () => {
      const result = firstValueFrom(service.setActive(7, true));

      const request = http.expectOne(`${CATEGORIES_URL}/7/status`);
      expect(request.request.body).toEqual({ isActive: true });
      request.flush(resource(7, 'Holidays', { isActive: true }));

      await expect(result).resolves.toMatchObject({ isActive: true });
    });
  });

  describe('remove', () => {
    it('DELETEs /{id} and completes on 204', async () => {
      const result = firstValueFrom(service.remove(7));

      const request = http.expectOne(`${CATEGORIES_URL}/7`);
      expect(request.request.method).toBe('DELETE');
      request.flush(null, { status: 204, statusText: 'No Content' });

      await expect(result).resolves.toBeUndefined();
    });

    it('re-files an in-use 409 as a CategoryInUseError, distinct from a name clash', async () => {
      const result = firstValueFrom(service.remove(7));

      http
        .expectOne(`${CATEGORIES_URL}/7`)
        .flush(problem('This category is in use and cannot be deleted.'), {
          status: 409,
          statusText: 'Conflict',
        });

      const error = await result.catch((e: unknown) => e);
      expect(error).toBeInstanceOf(CategoryInUseError);
      expect((error as CategoryInUseError).message).toBe(
        'This category is in use and cannot be deleted.'
      );
      expect(error).not.toBeInstanceOf(ApiError);
    });
  });

  describe('every write drops the cache', () => {
    /** Warm the shared cache and prove it warm: a second read makes no request. */
    async function warmCache() {
      const first = firstValueFrom(service.all());
      http.expectOne(CATEGORIES_URL).flush([resource(1, 'Groceries')]);
      await first;
      await firstValueFrom(service.all());
      http.expectNone(CATEGORIES_URL);
    }

    /** A read after the write must hit the network again. */
    async function expectReadRefetches() {
      const after = firstValueFrom(service.all());
      http.expectOne(CATEGORIES_URL).flush([resource(1, 'Groceries')]);
      await after;
    }

    it('create drops it', async () => {
      await warmCache();

      const created = firstValueFrom(
        service.create({ name: 'Holidays', kind: 'expense' })
      );
      http
        .expectOne(CATEGORIES_URL)
        .flush(resource(7, 'Holidays'), { status: 201, statusText: 'Created' });
      await created;

      await expectReadRefetches();
    });

    it('rename drops it', async () => {
      await warmCache();

      const renamed = firstValueFrom(service.rename(1, 'Food'));
      http.expectOne(`${CATEGORIES_URL}/1`).flush(resource(1, 'Food'));
      await renamed;

      await expectReadRefetches();
    });

    it('retire drops it', async () => {
      await warmCache();

      const retired = firstValueFrom(service.setActive(1, false));
      http
        .expectOne(`${CATEGORIES_URL}/1/status`)
        .flush(resource(1, 'Groceries', { isActive: false }));
      await retired;

      await expectReadRefetches();
    });

    it('reactivate drops it', async () => {
      await warmCache();

      const reactivated = firstValueFrom(service.setActive(1, true));
      http
        .expectOne(`${CATEGORIES_URL}/1/status`)
        .flush(resource(1, 'Groceries', { isActive: true }));
      await reactivated;

      await expectReadRefetches();
    });

    it('delete drops it', async () => {
      await warmCache();

      const removed = firstValueFrom(service.remove(1));
      http
        .expectOne(`${CATEGORIES_URL}/1`)
        .flush(null, { status: 204, statusText: 'No Content' });
      await removed;

      await expectReadRefetches();
    });

    it('a failed write leaves the cache intact', async () => {
      await warmCache();

      const failed = firstValueFrom(
        service.create({ name: 'Groceries', kind: 'expense' })
      );
      http
        .expectOne(CATEGORIES_URL)
        .flush(problem('A category with this name already exists.'), {
          status: 409,
          statusText: 'Conflict',
        });
      await failed.catch(() => undefined);

      await firstValueFrom(service.all());
      http.expectNone(CATEGORIES_URL);
    });
  });
});
