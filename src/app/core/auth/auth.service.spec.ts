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
import { AuthService, EmailNotConfirmedError } from './auth.service';

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

  /**
   * `PreSignInCheck` answers 403 before the password is ever checked (issue
   * #68), so this must fire whatever password was typed and must not carry any
   * suggestion the password was right.
   */
  it('turns a 403 unconfirmed-email login failure into an EmailNotConfirmedError naming the address', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = firstValueFrom(
      service.login({ email: 'ada@example.com', password: 'wrong-too' })
    );

    http.expectOne(`${BASE_URL}/api/auth/login`).flush(
      { title: 'Forbidden', status: 403, detail: 'Email not confirmed.' },
      { status: 403, statusText: 'Forbidden' }
    );

    const error = await result.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EmailNotConfirmedError);
    expect((error as EmailNotConfirmedError).email).toBe('ada@example.com');
    // Never the server's own detail, and never a claim about the password.
    expect((error as EmailNotConfirmedError).message).not.toMatch(/password/i);

    warn.mockRestore();
  });

  it('turns a 423 locked-out login failure into our own wording, with no invented countdown', async () => {
    const result = firstValueFrom(
      service.login({ email: 'ada@example.com', password: 'wrong' })
    );

    http
      .expectOne(`${BASE_URL}/api/auth/login`)
      .flush(null, { status: 423, statusText: 'Locked' });

    const error = await result.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(423);
    expect((error as ApiError).message).toBe(
      'Too many failed attempts. Please wait a few minutes and try again.'
    );
    expect((error as ApiError).message).not.toMatch(/\d+\s*(minute|second)/i);
  });

  it('marks its four guest-or-boot requests as handling their own 401', () => {
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

    firstValueFrom(service.resendConfirmation('a@b.co'));
    const resend = http.expectOne(`${BASE_URL}/api/auth/resend-confirmation`);
    expect(resend.request.context.get(HANDLES_OWN_401)).toBe(true);
    resend.flush(null, { status: 202, statusText: 'Accepted' });

    firstValueFrom(service.forgotPassword('a@b.co'));
    const forgot = http.expectOne(`${BASE_URL}/api/auth/forgot-password`);
    expect(forgot.request.context.get(HANDLES_OWN_401)).toBe(true);
    forgot.flush(null, { status: 202, statusText: 'Accepted' });
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

  it('POSTs registration to /api/auth/register and unwraps the Profile — no token (ADR 0015)', async () => {
    const result = firstValueFrom(
      service.register({
        name: 'Ada',
        email: 'ada@example.com',
        password: 'secret12',
      })
    );

    const request = http.expectOne(`${BASE_URL}/api/auth/register`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      name: 'Ada',
      email: 'ada@example.com',
      password: 'secret12',
    });
    request.flush(
      { user: { id: 7, name: 'Ada', email: 'ada@example.com' } },
      { status: 201, statusText: 'Created' }
    );

    await expect(result).resolves.toEqual({
      id: 7,
      name: 'Ada',
      email: 'ada@example.com',
    });
  });

  it('turns a 409 taken-email conflict into wording that points at signing in', async () => {
    const result = firstValueFrom(
      service.register({
        name: 'Ada',
        email: 'taken@example.com',
        password: 'secret12',
      })
    );

    http.expectOne(`${BASE_URL}/api/auth/register`).flush(
      {
        title: 'Conflict',
        status: 409,
        detail: 'A user with this email already exists.',
      },
      { status: 409, statusText: 'Conflict' }
    );

    const error = await result.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(409);
    expect((error as ApiError).fieldErrors).toEqual({});
    // Ours, not the server's bare statement of fact.
    expect((error as ApiError).message).toBe(
      'That email is already registered. Try signing in instead.'
    );
  });

  it('normalises a ValidationProblemDetails register response into field errors, camelCasing keys', async () => {
    const result = firstValueFrom(
      service.register({ name: '', email: 'not-an-email', password: 'short12' })
    );

    http.expectOne(`${BASE_URL}/api/auth/register`).flush(
      {
        title: 'One or more validation errors occurred.',
        status: 400,
        errors: {
          Name: ['The Name field is required.'],
          Email: ['The Email field is not a valid e-mail address.'],
          Password: [
            'The field Password must be a string with a minimum length of 8.',
          ],
        },
      },
      { status: 400, statusText: 'Bad Request' }
    );

    const error = await result.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).fieldErrors).toEqual({
      name: ['The Name field is required.'],
      email: ['The Email field is not a valid e-mail address.'],
      password: [
        'The field Password must be a string with a minimum length of 8.',
      ],
    });
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
  it('POSTs just the email address to /api/auth/resend-confirmation', async () => {
    const result = firstValueFrom(service.resendConfirmation('ada@example.com'));

    const request = http.expectOne(`${BASE_URL}/api/auth/resend-confirmation`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ email: 'ada@example.com' });
    request.flush(null, { status: 202, statusText: 'Accepted' });

    await expect(result).resolves.toBeUndefined();
  });

  /**
   * The endpoint answers 202 for an unknown address, an already-confirmed one
   * and a just-sent one alike, so there is no outcome worth reporting. A
   * transport failure is the only thing left that could distinguish one caller's
   * click from another's, and it is swallowed here rather than in each host so
   * the promise "this never fails" is kept in one place (ADR 0015).
   */
  it('resolves a resend even when the request itself fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = firstValueFrom(service.resendConfirmation('ada@example.com'));

    http
      .expectOne(`${BASE_URL}/api/auth/resend-confirmation`)
      .flush('Nope', { status: 500, statusText: 'Internal Server Error' });

    await expect(result).resolves.toBeUndefined();

    warn.mockRestore();
  });

  it('POSTs just the email address to /api/auth/forgot-password', async () => {
    const result = firstValueFrom(service.forgotPassword('ada@example.com'));

    const request = http.expectOne(`${BASE_URL}/api/auth/forgot-password`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ email: 'ada@example.com' });
    request.flush(null, { status: 202, statusText: 'Accepted' });

    await expect(result).resolves.toBeUndefined();
  });

  /**
   * The same bargain resend strikes: the endpoint answers 202 whether or not
   * that address has a Profile, so the only thing left that could tell one
   * caller's submit from another's is a transport failure — swallowed here so
   * no screen can accidentally turn an outage into an answer (ADR 0015).
   */
  it('resolves a forgot-password ask even when the request itself fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = firstValueFrom(service.forgotPassword('ada@example.com'));

    http
      .expectOne(`${BASE_URL}/api/auth/forgot-password`)
      .flush('Nope', { status: 500, statusText: 'Internal Server Error' });

    await expect(result).resolves.toBeUndefined();

    warn.mockRestore();
  });

  it('POSTs the userId and token to /api/auth/confirm-email', async () => {
    const result = firstValueFrom(service.confirmEmail(7, 'a-token'));

    const request = http.expectOne(`${BASE_URL}/api/auth/confirm-email`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ userId: 7, token: 'a-token' });
    request.flush(null, { status: 204, statusText: 'No Content' });

    await expect(result).resolves.toBeUndefined();
  });

  /**
   * Unlike resend and forgot-password, confirming has a genuine outcome the
   * caller must see, so a failure is left to propagate rather than swallowed
   * (ADR 0015: the API collapses every failure cause into one undifferentiated
   * 400, and the caller is left to treat them all alike).
   */
  it('lets a confirm-email failure propagate as an ApiError', async () => {
    const result = firstValueFrom(service.confirmEmail(7, 'stale-token'));

    http
      .expectOne(`${BASE_URL}/api/auth/confirm-email`)
      .flush(null, { status: 400, statusText: 'Bad Request' });

    const error = await result.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(400);
  });

  it('marks confirm-email as handling its own 401', () => {
    firstValueFrom(service.confirmEmail(7, 'a-token')).catch(() => undefined);

    const request = http.expectOne(`${BASE_URL}/api/auth/confirm-email`);
    expect(request.request.context.get(HANDLES_OWN_401)).toBe(true);
    request.flush(null, { status: 204, statusText: 'No Content' });
  });
});
