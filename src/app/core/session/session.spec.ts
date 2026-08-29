import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { API_BASE_URL, errorInterceptor } from '@/app/core/api';
import { LocalStorage } from '@/app/core/local-storage';
import { TEST_API_BASE_URL as BASE_URL } from '@/testing/api-base-url';
import { Session } from './session';

const TOKEN_KEY = 'pitaka.token';

function fakeStorage(seed: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    _map: map,
  };
}

describe('Session', () => {
  let http: HttpTestingController;
  let router: { url: string; navigate: ReturnType<typeof vi.fn> };
  let storage: ReturnType<typeof fakeStorage>;

  function configure(seed: Record<string, string> = {}) {
    storage = fakeStorage(seed);
    router = { url: '/accounts', navigate: vi.fn() };

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: BASE_URL },
        { provide: LocalStorage, useValue: storage },
        { provide: Router, useValue: router },
      ],
    });

    http = TestBed.inject(HttpTestingController);
    return TestBed.inject(Session);
  }

  /** A session the server has confirmed, so `isAuthenticated()` is genuinely true. */
  async function verifiedSession(token = 'live-token') {
    const session = configure({ [TOKEN_KEY]: token });

    const pending = session.verifyBoot();
    http
      .expectOne(`${BASE_URL}/api/auth/me`)
      .flush({ id: 7, name: 'Ada', email: 'ada@example.com' });
    await pending;

    return session;
  }

  afterEach(() => http.verify());

  it('starts unauthenticated and makes no request when no token is stored', async () => {
    const session = configure();

    await session.verifyBoot();

    expect(session.isAuthenticated()).toBe(false);
    expect(session.profile()).toBeNull();
    http.expectNone(`${BASE_URL}/api/auth/me`);
  });

  it('admits a stored token to the shell once the server confirms it', async () => {
    const session = configure({ [TOKEN_KEY]: 'stored-token' });

    const pending = session.verifyBoot();
    http
      .expectOne(`${BASE_URL}/api/auth/me`)
      .flush({ id: 7, name: 'Ada', email: 'ada@example.com' });
    await pending;

    expect(session.isAuthenticated()).toBe(true);
    expect(session.profile()).toEqual({ id: 7, name: 'Ada', email: 'ada@example.com' });
  });

  it('clears a stored token whose Profile no longer exists on the server', async () => {
    const session = configure({ [TOKEN_KEY]: 'stale-token' });

    const pending = session.verifyBoot();
    http
      .expectOne(`${BASE_URL}/api/auth/me`)
      .flush(null, { status: 401, statusText: 'Unauthorized' });
    await pending;

    expect(session.isAuthenticated()).toBe(false);
    expect(session.profile()).toBeNull();
    expect(storage.getItem(TOKEN_KEY)).toBeNull();
  });

  it('keeps a stored token but stays unauthenticated when boot verification hits a transport failure', async () => {
    const session = configure({ [TOKEN_KEY]: 'stored-token' });

    const pending = session.verifyBoot();
    http
      .expectOne(`${BASE_URL}/api/auth/me`)
      .error(new ProgressEvent('error'));
    await pending;

    // Unverified, so the shell stays shut; the token survives so a refresh once
    // the API is reachable signs the person straight back in.
    expect(session.isAuthenticated()).toBe(false);
    expect(session.profile()).toBeNull();
    expect(storage.getItem(TOKEN_KEY)).toBe('stored-token');
  });

  it('stores the token and Profile on a successful sign-in', async () => {
    const session = configure();

    const pending = session.signIn({ email: 'ada@example.com', password: 'secret12' });
    const request = http.expectOne(`${BASE_URL}/api/auth/login`);
    expect(request.request.body).toEqual({ email: 'ada@example.com', password: 'secret12' });
    request.flush({ token: 'fresh-token', user: { id: 7, name: 'Ada', email: 'ada@example.com' } });
    await pending;

    expect(storage.getItem(TOKEN_KEY)).toBe('fresh-token');
    expect(session.isAuthenticated()).toBe(true);
    expect(session.profile()).toEqual({ id: 7, name: 'Ada', email: 'ada@example.com' });
  });

  it('rejects and stays unauthenticated when sign-in credentials are wrong', async () => {
    const session = configure();

    const pending = session.signIn({ email: 'ada@example.com', password: 'wrong' });
    http
      .expectOne(`${BASE_URL}/api/auth/login`)
      .flush('Invalid email or password.', { status: 401, statusText: 'Unauthorized' });

    await expect(pending).rejects.toMatchObject({ status: 401 });
    expect(session.isAuthenticated()).toBe(false);
    expect(storage.getItem(TOKEN_KEY)).toBeNull();
  });

  it('stores the token and Profile on a successful registration', async () => {
    const session = configure();

    const pending = session.register({
      name: 'Ada',
      email: 'ada@example.com',
      password: 'secret12',
    });
    const request = http.expectOne(`${BASE_URL}/api/auth/register`);
    expect(request.request.body).toEqual({
      name: 'Ada',
      email: 'ada@example.com',
      password: 'secret12',
    });
    request.flush(
      { token: 'fresh-token', user: { id: 7, name: 'Ada', email: 'ada@example.com' } },
      { status: 201, statusText: 'Created' }
    );
    await pending;

    expect(storage.getItem(TOKEN_KEY)).toBe('fresh-token');
    expect(session.isAuthenticated()).toBe(true);
    expect(session.profile()).toEqual({ id: 7, name: 'Ada', email: 'ada@example.com' });
  });

  it('rejects and stays unauthenticated when the email is already registered', async () => {
    const session = configure();

    const pending = session.register({
      name: 'Ada',
      email: 'taken@example.com',
      password: 'secret12',
    });
    http.expectOne(`${BASE_URL}/api/auth/register`).flush(
      { detail: 'A user with this email already exists.', status: 409 },
      { status: 409, statusText: 'Conflict' }
    );

    await expect(pending).rejects.toMatchObject({ status: 409 });
    expect(session.isAuthenticated()).toBe(false);
    expect(storage.getItem(TOKEN_KEY)).toBeNull();
  });

  it('on expiry clears the token and returns to sign-in preserving the return URL', async () => {
    const session = await verifiedSession();
    expect(session.isAuthenticated()).toBe(true);

    session.expire();

    expect(session.isAuthenticated()).toBe(false);
    expect(session.profile()).toBeNull();
    expect(storage.getItem(TOKEN_KEY)).toBeNull();
    expect(router.navigate).toHaveBeenCalledWith(
      ['/auth/sign-in'],
      { queryParams: { returnUrl: '/accounts' } }
    );
  });

  it('on sign-out clears the session and returns to sign-in without a return URL', async () => {
    const session = await verifiedSession();
    expect(session.isAuthenticated()).toBe(true);

    session.signOut();

    expect(session.isAuthenticated()).toBe(false);
    expect(session.profile()).toBeNull();
    expect(storage.getItem(TOKEN_KEY)).toBeNull();
    // A deliberate leave, not a lapse: nowhere to send the person back to.
    expect(router.navigate).toHaveBeenCalledWith(['/auth/sign-in']);
  });

  it('ignores a second sign-out once the session is already clear', async () => {
    const session = await verifiedSession();

    session.signOut();
    session.signOut();

    expect(router.navigate).toHaveBeenCalledTimes(1);
  });
});
