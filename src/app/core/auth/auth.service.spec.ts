import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import {
  ApiError,
  API_BASE_URL,
  errorInterceptor,
  HANDLES_OWN_401,
} from '@/app/core/api';
import { TEST_API_BASE_URL as BASE_URL } from '@/testing/api-base-url';
import { AuthService } from './auth.service';

/**
 * The HTTP adapter boundary — the primary seam (see the spec's Testing
 * Decisions). Feeds real-shaped responses and the two failure shapes sign-in
 * meets (a bare-string login failure and a ValidationProblemDetails body)
 * through the service *and its interceptor*, and asserts what comes out the top.
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

  it('turns the bare-string login failure into one clear message of our own', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

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
    expect((error as ApiError).fieldErrors).toEqual({});
    // Ours, not the server's text, and not the generic "session has ended"
    // wording a 401 gets anywhere else.
    expect((error as ApiError).message).toBe(
      'That email and password do not match. Please try again.'
    );

    warn.mockRestore();
  });

  it('marks its two requests as handling their own 401', () => {
    firstValueFrom(service.login({ email: 'a@b.co', password: 'x' })).catch(
      () => undefined
    );
    const login = http.expectOne(`${BASE_URL}/api/auth/login`);
    expect(login.request.context.get(HANDLES_OWN_401)).toBe(true);
    login.flush({ token: 't', user: { id: 1, name: 'A', email: 'a@b.co' } });

    firstValueFrom(service.me()).catch(() => undefined);
    const me = http.expectOne(`${BASE_URL}/api/auth/me`);
    expect(me.request.context.get(HANDLES_OWN_401)).toBe(true);
    me.flush({ id: 1, name: 'A', email: 'a@b.co' });
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
    // Not the server's raw "One or more validation errors occurred." title.
    expect((error as ApiError).message).toBe(
      'Please correct the highlighted fields and try again.'
    );
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
