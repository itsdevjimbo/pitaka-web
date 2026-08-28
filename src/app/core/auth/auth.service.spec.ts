import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { ApiError, API_BASE_URL, errorInterceptor } from '@/app/core/api';
import { TEST_API_BASE_URL as BASE_URL } from '@/testing/api-base-url';
import { AuthService } from './auth.service';

/**
 * The HTTP adapter boundary — the primary seam (see the spec's Testing
 * Decisions). Feeds real-shaped responses and all four failure shapes through
 * the service *and its interceptor*, and asserts what comes out the top.
 */
describe('AuthService', () => {
  let service: AuthService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: BASE_URL },
      ],
    });
    service = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('POSTs credentials to /api/auth/login and renames the identity to `profile`', async () => {
    const result = firstValueFrom(
      service.login({ email: 'ada@example.com', password: 'secret12' })
    );

    const request = http.expectOne(`${BASE_URL}/api/auth/login`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      email: 'ada@example.com',
      password: 'secret12',
    });
    request.flush({
      token: 'a.b.c',
      user: { id: 7, name: 'Ada', email: 'ada@example.com' },
    });

    await expect(result).resolves.toEqual({
      token: 'a.b.c',
      profile: { id: 7, name: 'Ada', email: 'ada@example.com' },
    });
  });

  it('normalises the bare-string login failure into an ApiError', async () => {
    const result = firstValueFrom(
      service.login({ email: 'ada@example.com', password: 'wrong' })
    );

    http
      .expectOne(`${BASE_URL}/api/auth/login`)
      .flush('Invalid email or password.', {
        status: 401,
        statusText: 'Unauthorized',
      });

    const error = await result.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(401);
    expect((error as ApiError).message).toBe('Invalid email or password.');
    expect((error as ApiError).fieldErrors).toEqual({});
  });

  it('normalises a ValidationProblemDetails response into the same error type, camelCasing keys', async () => {
    const result = firstValueFrom(
      service.login({ email: '', password: '' })
    );

    http.expectOne(`${BASE_URL}/api/auth/login`).flush(
      {
        title: 'One or more validation errors occurred.',
        status: 400,
        errors: {
          Email: ['The Email field is required.'],
          Password: ['The Password field is required.'],
        },
      },
      { status: 400, statusText: 'Bad Request' }
    );

    const error = await result.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).fieldErrors).toEqual({
      email: ['The Email field is required.'],
      password: ['The Password field is required.'],
    });
  });

  it('turns a bodyless 400 into a form-level message with an empty field map', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const result = firstValueFrom(
      service.login({ email: 'ada@example.com', password: 'secret12' })
    );

    http
      .expectOne(`${BASE_URL}/api/auth/login`)
      .flush(null, { status: 400, statusText: 'Bad Request' });

    const error = await result.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).fieldErrors).toEqual({});
    expect((error as ApiError).message).not.toContain('{');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('carries the `detail` of a ProblemDetails response as the message', async () => {
    const result = firstValueFrom(service.me());

    http.expectOne(`${BASE_URL}/api/auth/me`).flush(
      {
        type: 'about:blank',
        title: 'Bad Request',
        status: 400,
        detail: 'The token is malformed.',
      },
      { status: 400, statusText: 'Bad Request' }
    );

    const error = await result.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toBe('The token is malformed.');
  });

  it('GETs the live Profile from /api/auth/me', async () => {
    const result = firstValueFrom(service.me());

    http
      .expectOne(`${BASE_URL}/api/auth/me`)
      .flush({ id: 7, name: 'Ada', email: 'ada@example.com' });

    await expect(result).resolves.toEqual({
      id: 7,
      name: 'Ada',
      email: 'ada@example.com',
    });
  });
});
