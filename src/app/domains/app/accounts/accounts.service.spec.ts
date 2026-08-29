import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { ApiError, API_BASE_URL, errorInterceptor } from '@/app/core/api';
import { TEST_API_BASE_URL as BASE_URL } from '@/testing/api-base-url';
import {
  AccountDeleteBlockedError,
  AccountModifiedError,
} from './account-errors';
import { AccountsService } from './accounts.service';

/** A ProblemDetails body shaped the way the API sends its bare 409s. */
function problem(detail: string) {
  return {
    type: 'https://tools.ietf.org/html/rfc9110#section-15.5.10',
    title: 'Conflict',
    status: 409,
    detail,
  };
}

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

  describe('rename', () => {
    it('PUTs the new name and returns the updated Account without the owner id', async () => {
      const result = firstValueFrom(service.rename(9, 'Everyday cash'));

      const request = http.expectOne(`${BASE_URL}/api/accounts/9`);
      expect(request.request.method).toBe('PUT');
      expect(request.request.body).toEqual({ name: 'Everyday cash' });
      request.flush({
        id: 9,
        userId: 7,
        name: 'Everyday cash',
        type: 'Cash',
        initialBalance: 0,
        currentBalance: 250,
        isActive: true,
      });

      await expect(result).resolves.toEqual({
        id: 9,
        name: 'Everyday cash',
        type: 'Cash',
        currentBalance: 250,
        isActive: true,
      });
    });

    it('re-files a duplicate-name 409 as a name field error against the conflict reason', async () => {
      const result = firstValueFrom(service.rename(9, 'Savings'));

      http
        .expectOne(`${BASE_URL}/api/accounts/9`)
        .flush(problem('An account with this name already exists.'), {
          status: 409,
          statusText: 'Conflict',
        });

      const error = await result.catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).fieldErrors).toEqual({
        name: ['An account with this name already exists.'],
      });
    });

    it('surfaces a concurrency 409 as an AccountModifiedError, not a name clash', async () => {
      const result = firstValueFrom(service.rename(9, 'Everyday cash'));

      http
        .expectOne(`${BASE_URL}/api/accounts/9`)
        .flush(
          problem('This account was updated by another request. Please try again.'),
          { status: 409, statusText: 'Conflict' }
        );

      const error = await result.catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AccountModifiedError);
      expect((error as AccountModifiedError).message).toContain(
        'updated by another request'
      );
    });
  });

  describe('setActive', () => {
    it('PATCHes the status endpoint to retire an Account and returns it', async () => {
      const result = firstValueFrom(service.setActive(9, false));

      const request = http.expectOne(`${BASE_URL}/api/accounts/9/status`);
      expect(request.request.method).toBe('PATCH');
      expect(request.request.body).toEqual({ isActive: false });
      request.flush({
        id: 9,
        userId: 7,
        name: 'Old GCash',
        type: 'Wallet',
        initialBalance: 0,
        currentBalance: 300,
        isActive: false,
      });

      await expect(result).resolves.toEqual({
        id: 9,
        name: 'Old GCash',
        type: 'Wallet',
        currentBalance: 300,
        isActive: false,
      });
    });

    it('PATCHes isActive true to reactivate an Account', async () => {
      const result = firstValueFrom(service.setActive(9, true));

      const request = http.expectOne(`${BASE_URL}/api/accounts/9/status`);
      expect(request.request.body).toEqual({ isActive: true });
      request.flush({
        id: 9,
        userId: 7,
        name: 'Old GCash',
        type: 'Wallet',
        initialBalance: 0,
        currentBalance: 300,
        isActive: true,
      });

      await expect(result).resolves.toMatchObject({ isActive: true });
    });

    it('surfaces a concurrency 409 as an AccountModifiedError', async () => {
      const result = firstValueFrom(service.setActive(9, false));

      http
        .expectOne(`${BASE_URL}/api/accounts/9/status`)
        .flush(
          problem('This account was updated by another request. Please try again.'),
          { status: 409, statusText: 'Conflict' }
        );

      const error = await result.catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AccountModifiedError);
    });
  });

  describe('remove', () => {
    it('DELETEs the Account and completes on 204', async () => {
      const result = firstValueFrom(service.remove(9));

      const request = http.expectOne(`${BASE_URL}/api/accounts/9`);
      expect(request.request.method).toBe('DELETE');
      request.flush(null, { status: 204, statusText: 'No Content' });

      await expect(result).resolves.toBeUndefined();
    });

    it('maps the transaction-history 409 to a delete-blocked error naming that reason', async () => {
      const result = firstValueFrom(service.remove(9));

      http
        .expectOne(`${BASE_URL}/api/accounts/9`)
        .flush(
          problem('This account has transaction history and cannot be deleted.'),
          { status: 409, statusText: 'Conflict' }
        );

      const error = await result.catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AccountDeleteBlockedError);
      expect((error as AccountDeleteBlockedError).reason).toBe(
        'transaction-history'
      );
    });

    it('maps the goal-allocation 409 to a distinct delete-blocked reason', async () => {
      const result = firstValueFrom(service.remove(9));

      http
        .expectOne(`${BASE_URL}/api/accounts/9`)
        .flush(
          problem('This account contains funds allocated toward a specific goal.'),
          { status: 409, statusText: 'Conflict' }
        );

      const error = await result.catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AccountDeleteBlockedError);
      expect((error as AccountDeleteBlockedError).reason).toBe('goal-allocation');
    });

    it('surfaces a concurrency 409 as an AccountModifiedError, not a delete block', async () => {
      const result = firstValueFrom(service.remove(9));

      http
        .expectOne(`${BASE_URL}/api/accounts/9`)
        .flush(
          problem('This account was updated by another request. Please try again.'),
          { status: 409, statusText: 'Conflict' }
        );

      const error = await result.catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AccountModifiedError);
    });
  });
});
