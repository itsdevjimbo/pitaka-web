import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import {
  API_BASE_URL,
  errorInterceptor,
  handlesOwn401,
} from '@/app/core/api';
import { TEST_API_BASE_URL as BASE_URL } from '@/testing/api-base-url';
import { authInterceptor } from './auth.interceptor';
import { Session } from './session';

describe('authInterceptor', () => {
  let http: HttpTestingController;
  let client: HttpClient;
  let session: { token: ReturnType<typeof vi.fn>; expire: ReturnType<typeof vi.fn> };

  function configure(token: string | null) {
    session = { token: vi.fn().mockReturnValue(token), expire: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor, errorInterceptor])),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: BASE_URL },
        { provide: Session, useValue: session },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    client = TestBed.inject(HttpClient);
  }

  afterEach(() => http.verify());

  it('attaches the bearer token when the session has one', () => {
    configure('a.b.c');

    client.get(`${BASE_URL}/api/auth/me`).subscribe();

    const request = http.expectOne(`${BASE_URL}/api/auth/me`);
    expect(request.request.headers.get('Authorization')).toBe('Bearer a.b.c');
    request.flush({});
  });

  it('never attaches the token to a request bound for another host', () => {
    configure('a.b.c');

    client.get('https://example.com/widgets').subscribe();

    const request = http.expectOne('https://example.com/widgets');
    expect(request.request.headers.has('Authorization')).toBe(false);
    request.flush({});
  });

  it('sends no Authorization header when the session is empty', () => {
    configure(null);

    client.get(`${BASE_URL}/api/auth/me`).subscribe();

    const request = http.expectOne(`${BASE_URL}/api/auth/me`);
    expect(request.request.headers.has('Authorization')).toBe(false);
    request.flush({});
  });

  it('treats a 401 on an ordinary request as the session lapsing', async () => {
    configure('a.b.c');

    const result = firstValueFrom(client.get(`${BASE_URL}/api/accounts`));
    http
      .expectOne(`${BASE_URL}/api/accounts`)
      .flush(null, { status: 401, statusText: 'Unauthorized' });

    await result.catch(() => undefined);
    expect(session.expire).toHaveBeenCalledTimes(1);
  });

  it('does not treat a 401 on boot verification as a lapse', async () => {
    configure('a.b.c');

    const result = firstValueFrom(
      client.get(`${BASE_URL}/api/auth/me`, { context: handlesOwn401() })
    );
    http
      .expectOne(`${BASE_URL}/api/auth/me`)
      .flush(null, { status: 401, statusText: 'Unauthorized' });

    await result.catch(() => undefined);
    expect(session.expire).not.toHaveBeenCalled();
  });

  it('does not treat a 401 on the sign-in request as a lapse', async () => {
    configure(null);

    const result = firstValueFrom(
      client.post(`${BASE_URL}/api/auth/login`, {}, { context: handlesOwn401() })
    );
    http
      .expectOne(`${BASE_URL}/api/auth/login`)
      .flush('Invalid email or password.', {
        status: 401,
        statusText: 'Unauthorized',
      });

    await result.catch(() => undefined);
    expect(session.expire).not.toHaveBeenCalled();
  });

  it('exempts by the request flag, not by the URL it was sent to', async () => {
    configure('a.b.c');

    // Same endpoint as boot verification, but built without the flag: an
    // ordinary caller's 401 there is still a lapse.
    const result = firstValueFrom(client.get(`${BASE_URL}/api/auth/me`));
    http
      .expectOne(`${BASE_URL}/api/auth/me`)
      .flush(null, { status: 401, statusText: 'Unauthorized' });

    await result.catch(() => undefined);
    expect(session.expire).toHaveBeenCalledTimes(1);
  });
});
