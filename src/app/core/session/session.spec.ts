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

  it('keeps a stored token when boot verification hits a transport failure', async () => {
    const session = configure({ [TOKEN_KEY]: 'stored-token' });

    const pending = session.verifyBoot();
    http
      .expectOne(`${BASE_URL}/api/auth/me`)
      .error(new ProgressEvent('error'));
    await pending;

    expect(session.isAuthenticated()).toBe(true);
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

  it('on expiry clears the token and returns to sign-in preserving the return URL', async () => {
    const session = configure({ [TOKEN_KEY]: 'live-token' });

    session.expire();

    expect(session.isAuthenticated()).toBe(false);
    expect(storage.getItem(TOKEN_KEY)).toBeNull();
    expect(router.navigate).toHaveBeenCalledWith(
      ['/auth/sign-in'],
      { queryParams: { returnUrl: '/accounts' } }
    );
  });
});
