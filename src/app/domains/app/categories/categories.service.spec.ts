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

/** One Category row shaped the way `GET /api/categories` sends it. */
function resource(id: number, name: string) {
  return { id, name, type: 'Expense', isDefault: true, parentId: null };
}

/**
 * The reference cache boundary. Feeds a real-shaped `GET /api/categories`
 * response through the service and asserts the id-to-name lookup that comes
 * out, that a second reader does not trigger a second request, and that a
 * failed fetch is not the one that gets cached.
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

  it('GETs /api/categories and resolves category ids to names', async () => {
    const result = firstValueFrom(service.names());

    const request = http.expectOne(`${BASE_URL}/api/categories`);
    expect(request.request.method).toBe('GET');
    request.flush([resource(1, 'Groceries'), resource(2, 'Salary')]);

    const names = await result;
    expect(names.get(1)).toBe('Groceries');
    expect(names.get(2)).toBe('Salary');
    expect(names.get(99)).toBeUndefined();
  });

  it('fetches once and replays to every later reader', async () => {
    const first = firstValueFrom(service.names());
    http
      .expectOne(`${BASE_URL}/api/categories`)
      .flush([resource(1, 'Groceries')]);
    await first;

    const second = await firstValueFrom(service.names());
    http.expectNone(`${BASE_URL}/api/categories`);
    expect(second.get(1)).toBe('Groceries');
  });

  it('surfaces a server failure as a normalised ApiError', async () => {
    const result = firstValueFrom(service.names());

    http
      .expectOne(`${BASE_URL}/api/categories`)
      .flush(null, { status: 500, statusText: 'Internal Server Error' });

    const error = await result.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
  });

  it('does not cache a failed fetch — the next read retries', async () => {
    const failed = firstValueFrom(service.names());
    http
      .expectOne(`${BASE_URL}/api/categories`)
      .flush(null, { status: 503, statusText: 'Service Unavailable' });
    await failed.catch(() => undefined);

    const retried = firstValueFrom(service.names());
    http
      .expectOne(`${BASE_URL}/api/categories`)
      .flush([resource(1, 'Groceries')]);

    expect((await retried).get(1)).toBe('Groceries');
  });
});
