import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { ApiError, API_BASE_URL, errorInterceptor } from '@/app/core/api';
import { TEST_API_BASE_URL as BASE_URL } from '@/testing/api-base-url';
import { AccountsService } from './accounts.service';

/**
 * The HTTP adapter boundary. Feeds a real-shaped `GET /api/accounts` response
 * and a server failure through the service *and its interceptor*, and asserts
 * what comes out the top.
 */
describe('AccountsService', () => {
  let service: AccountsService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: BASE_URL },
      ],
    });
    service = TestBed.inject(AccountsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('GETs /api/accounts and drops the owner id the API attaches', async () => {
    const result = firstValueFrom(service.list());

    const request = http.expectOne(`${BASE_URL}/api/accounts`);
    expect(request.request.method).toBe('GET');
    request.flush([
      {
        id: 1,
        userId: 7,
        name: 'Cash on hand',
        type: 'Cash',
        currentBalance: 1500.5,
        isActive: true,
      },
      {
        id: 2,
        userId: 7,
        name: 'BPI Savings',
        type: 'Bank',
        currentBalance: 84210,
        isActive: false,
      },
    ]);

    await expect(result).resolves.toEqual([
      {
        id: 1,
        name: 'Cash on hand',
        type: 'Cash',
        currentBalance: 1500.5,
        isActive: true,
      },
      {
        id: 2,
        name: 'BPI Savings',
        type: 'Bank',
        currentBalance: 84210,
        isActive: false,
      },
    ]);
  });

  it('yields an empty list, not an error, when the person owns no Accounts', async () => {
    const result = firstValueFrom(service.list());

    http.expectOne(`${BASE_URL}/api/accounts`).flush([]);

    await expect(result).resolves.toEqual([]);
  });

  it('surfaces a server failure as a normalised ApiError', async () => {
    const result = firstValueFrom(service.list());

    http
      .expectOne(`${BASE_URL}/api/accounts`)
      .flush(null, { status: 500, statusText: 'Internal Server Error' });

    const error = await result.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(500);
    expect((error as ApiError).message).toBe(
      'Something went wrong on the server. Please try again.'
    );
  });

  describe('create', () => {
    it('POSTs name, type, and starting balance and returns the created Account without the owner id', async () => {
      const result = firstValueFrom(
        service.create({ name: 'Cash on hand', type: 'Cash', initialBalance: 0 })
      );

      const request = http.expectOne(`${BASE_URL}/api/accounts`);
      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({
        name: 'Cash on hand',
        type: 'Cash',
        initialBalance: 0,
      });
      request.flush(
        {
          id: 9,
          userId: 7,
          name: 'Cash on hand',
          type: 'Cash',
          initialBalance: 0,
          currentBalance: 0,
          isActive: true,
        },
        { status: 201, statusText: 'Created' }
      );

      await expect(result).resolves.toEqual({
        id: 9,
        name: 'Cash on hand',
        type: 'Cash',
        currentBalance: 0,
        isActive: true,
      });
    });

    it('re-files a duplicate-name 409 as a name field error against the conflict reason', async () => {
      const result = firstValueFrom(
        service.create({
          name: 'Savings',
          type: 'Bank',
          initialBalance: 1000,
        })
      );

      http.expectOne(`${BASE_URL}/api/accounts`).flush(
        {
          type: 'https://tools.ietf.org/html/rfc9110#section-15.5.10',
          title: 'Conflict',
          status: 409,
          detail: 'An account with this name already exists.',
        },
        { status: 409, statusText: 'Conflict' }
      );

      const error = await result.catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(409);
      expect((error as ApiError).message).toBe(
        'An account with this name already exists.'
      );
      expect((error as ApiError).fieldErrors).toEqual({
        name: ['An account with this name already exists.'],
      });
    });

    it('camelCases a PascalCase field error so it binds to the name control', async () => {
      const result = firstValueFrom(
        service.create({ name: '', type: 'Cash', initialBalance: 0 })
      );

      http.expectOne(`${BASE_URL}/api/accounts`).flush(
        {
          title: 'One or more validation errors occurred.',
          status: 400,
          errors: { Name: ['The Name field is required.'] },
        },
        { status: 400, statusText: 'Bad Request' }
      );

      const error = await result.catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).fieldErrors).toEqual({
        name: ['The Name field is required.'],
      });
    });
  });
});
