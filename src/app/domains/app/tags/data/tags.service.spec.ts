import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { ApiError, API_BASE_URL, errorInterceptor } from '@/app/core/api';
import { TEST_API_BASE_URL as BASE_URL } from '@/testing/api-base-url';
import { TagsService } from './tags.service';

/** One Tag row shaped the way `GET /api/tags` sends it. */
function resource(id: number, name: string) {
  return { id, name };
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

const TAGS_URL = `${BASE_URL}/api/tags`;

/**
 * The reference-cache boundary. Feeds real wire-shaped JSON through the service
 * and the real `errorInterceptor`, and asserts what comes out the top: which set
 * each reader returns, that `all()` is shared and `readAll()` is cold, that each
 * of the three writes drops the cache (proven by a later read issuing a second
 * request), and that the duplicate-name 409, the 403 and the 404 arrive
 * distinguishably.
 */
describe('TagsService', () => {
  let service: TagsService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: BASE_URL },
      ],
    });
    service = TestBed.inject(TagsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  describe('the two readers', () => {
    it('all() returns the whole set as domain Tags', async () => {
      const result = firstValueFrom(service.all());

      const request = http.expectOne(TAGS_URL);
      expect(request.request.method).toBe('GET');
      request.flush([resource(1, 'groceries'), resource(2, 'holiday')]);

      await expect(result).resolves.toEqual([
        { id: 1, name: 'groceries' },
        { id: 2, name: 'holiday' },
      ]);
    });

    it('all() returns an empty list when the person has no Tags', async () => {
      const result = firstValueFrom(service.all());

      http.expectOne(TAGS_URL).flush([]);

      await expect(result).resolves.toEqual([]);
    });

    it('readAll() returns the whole set as domain Tags', async () => {
      const result = firstValueFrom(service.readAll());

      http
        .expectOne(TAGS_URL)
        .flush([resource(1, 'groceries'), resource(2, 'holiday')]);

      await expect(result).resolves.toEqual([
        { id: 1, name: 'groceries' },
        { id: 2, name: 'holiday' },
      ]);
    });

    it('all() serves a second caller without a second request', async () => {
      const first = firstValueFrom(service.all());
      http.expectOne(TAGS_URL).flush([resource(1, 'groceries')]);
      await first;

      const second = await firstValueFrom(service.all());
      http.expectNone(TAGS_URL);
      expect(second).toEqual([{ id: 1, name: 'groceries' }]);
    });

    it('readAll() always issues a request, even when the shared cache is warm', async () => {
      const warm = firstValueFrom(service.all());
      http.expectOne(TAGS_URL).flush([resource(1, 'groceries')]);
      await warm;

      const cold = firstValueFrom(service.readAll());
      http
        .expectOne(TAGS_URL)
        .flush([resource(1, 'groceries'), resource(2, 'holiday')]);

      await expect(cold).resolves.toEqual([
        { id: 1, name: 'groceries' },
        { id: 2, name: 'holiday' },
      ]);
    });

    it('readAll() does not populate the cache all() shares', async () => {
      const cold = firstValueFrom(service.readAll());
      http.expectOne(TAGS_URL).flush([resource(1, 'groceries')]);
      await cold;

      // all() still has to make the first shared request.
      const warm = firstValueFrom(service.all());
      http.expectOne(TAGS_URL).flush([resource(1, 'groceries')]);
      expect(await warm).toEqual([{ id: 1, name: 'groceries' }]);
    });

    it('surfaces a server failure as a normalised ApiError', async () => {
      const result = firstValueFrom(service.all());

      http
        .expectOne(TAGS_URL)
        .flush(null, { status: 500, statusText: 'Internal Server Error' });

      const error = await result.catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ApiError);
    });

    it('does not cache a failed fetch — the next read retries', async () => {
      const failed = firstValueFrom(service.all());
      http
        .expectOne(TAGS_URL)
        .flush(null, { status: 503, statusText: 'Service Unavailable' });
      await failed.catch(() => undefined);

      const retried = firstValueFrom(service.all());
      http.expectOne(TAGS_URL).flush([resource(1, 'groceries')]);

      expect(await retried).toEqual([{ id: 1, name: 'groceries' }]);
    });
  });

  describe('create', () => {
    it('POSTs the name and returns the created Tag', async () => {
      const result = firstValueFrom(service.create('holiday'));

      const request = http.expectOne(TAGS_URL);
      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({ name: 'holiday' });
      request.flush(resource(7, 'holiday'), {
        status: 201,
        statusText: 'Created',
      });

      await expect(result).resolves.toEqual({ id: 7, name: 'holiday' });
    });

    it('re-files a duplicate-name 409 as a name field error', async () => {
      const result = firstValueFrom(service.create('groceries'));

      http
        .expectOne(TAGS_URL)
        .flush(problem('You already have a tag with this name.'), {
          status: 409,
          statusText: 'Conflict',
        });

      const error = await result.catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(409);
      expect((error as ApiError).fieldErrors).toEqual({
        name: ['You already have a tag with this name.'],
      });
    });

    it('camelCases a PascalCase validation error so it binds to the name control', async () => {
      const result = firstValueFrom(service.create(''));

      http.expectOne(TAGS_URL).flush(
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
    it('PUTs the new name to /{id} and returns the updated Tag', async () => {
      const result = firstValueFrom(service.rename(7, 'vacation'));

      const request = http.expectOne(`${TAGS_URL}/7`);
      expect(request.request.method).toBe('PUT');
      expect(request.request.body).toEqual({ name: 'vacation' });
      request.flush(resource(7, 'vacation'));

      await expect(result).resolves.toEqual({ id: 7, name: 'vacation' });
    });

    it('re-files a duplicate-name 409 as a name field error', async () => {
      const result = firstValueFrom(service.rename(7, 'groceries'));

      http
        .expectOne(`${TAGS_URL}/7`)
        .flush(problem('You already have a tag with this name.'), {
          status: 409,
          statusText: 'Conflict',
        });

      const error = await result.catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(409);
      expect((error as ApiError).fieldErrors).toEqual({
        name: ['You already have a tag with this name.'],
      });
    });

    it('passes a 403 on a Tag owned by someone else straight through, distinguishable by status', async () => {
      const result = firstValueFrom(service.rename(7, 'vacation'));

      http
        .expectOne(`${TAGS_URL}/7`)
        .flush(null, { status: 403, statusText: 'Forbidden' });

      const error = await result.catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(403);
      expect((error as ApiError).fieldErrors).toEqual({});
    });

    it('passes a 404 on an unknown id straight through, distinguishable by status', async () => {
      const result = firstValueFrom(service.rename(99, 'vacation'));

      http
        .expectOne(`${TAGS_URL}/99`)
        .flush(null, { status: 404, statusText: 'Not Found' });

      const error = await result.catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(404);
      expect((error as ApiError).fieldErrors).toEqual({});
    });
  });

  describe('remove', () => {
    it('DELETEs /{id} and completes on 204', async () => {
      const result = firstValueFrom(service.remove(7));

      const request = http.expectOne(`${TAGS_URL}/7`);
      expect(request.request.method).toBe('DELETE');
      request.flush(null, { status: 204, statusText: 'No Content' });

      await expect(result).resolves.toBeUndefined();
    });

    it('has no in-use 409 to catch — a failure passes through as a plain ApiError', async () => {
      const result = firstValueFrom(service.remove(7));

      http
        .expectOne(`${TAGS_URL}/7`)
        .flush(null, { status: 500, statusText: 'Internal Server Error' });

      const error = await result.catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).fieldErrors).toEqual({});
    });

    it('passes a 403 and a 404 straight through, distinguishable by status', async () => {
      const forbidden = firstValueFrom(service.remove(7));
      http
        .expectOne(`${TAGS_URL}/7`)
        .flush(null, { status: 403, statusText: 'Forbidden' });
      expect(
        ((await forbidden.catch((e: unknown) => e)) as ApiError).status
      ).toBe(403);

      const missing = firstValueFrom(service.remove(99));
      http
        .expectOne(`${TAGS_URL}/99`)
        .flush(null, { status: 404, statusText: 'Not Found' });
      expect(((await missing.catch((e: unknown) => e)) as ApiError).status).toBe(
        404
      );
    });
  });

  describe('every write drops the cache', () => {
    /** Warm the shared cache and prove it warm: a second read makes no request. */
    async function warmCache() {
      const first = firstValueFrom(service.all());
      http.expectOne(TAGS_URL).flush([resource(1, 'groceries')]);
      await first;
      await firstValueFrom(service.all());
      http.expectNone(TAGS_URL);
    }

    /** A read after the write must hit the network again. */
    async function expectReadRefetches() {
      const after = firstValueFrom(service.all());
      http.expectOne(TAGS_URL).flush([resource(1, 'groceries')]);
      await after;
    }

    it('create drops it', async () => {
      await warmCache();

      const created = firstValueFrom(service.create('holiday'));
      http
        .expectOne(TAGS_URL)
        .flush(resource(7, 'holiday'), { status: 201, statusText: 'Created' });
      await created;

      await expectReadRefetches();
    });

    it('rename drops it', async () => {
      await warmCache();

      const renamed = firstValueFrom(service.rename(1, 'food'));
      http.expectOne(`${TAGS_URL}/1`).flush(resource(1, 'food'));
      await renamed;

      await expectReadRefetches();
    });

    it('delete drops it', async () => {
      await warmCache();

      const removed = firstValueFrom(service.remove(1));
      http
        .expectOne(`${TAGS_URL}/1`)
        .flush(null, { status: 204, statusText: 'No Content' });
      await removed;

      await expectReadRefetches();
    });

    it('a failed write leaves the cache intact', async () => {
      await warmCache();

      const failed = firstValueFrom(service.create('groceries'));
      http
        .expectOne(TAGS_URL)
        .flush(problem('You already have a tag with this name.'), {
          status: 409,
          statusText: 'Conflict',
        });
      await failed.catch(() => undefined);

      await firstValueFrom(service.all());
      http.expectNone(TAGS_URL);
    });
  });
});
