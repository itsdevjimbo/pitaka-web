import { HttpHeaders, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { API_BASE_URL, errorInterceptor } from '@/app/core/api';
import { LocalStorage } from '@/app/core/local-storage';
import { TEST_API_BASE_URL as BASE_URL } from '@/testing/api-base-url';
import { authInterceptor } from './auth.interceptor';
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

function stubObjectUrls(url = 'blob:profile-picture') {
  const NativeURL = globalThis.URL;
  const createObjectURL = vi.fn(() => url);
  const revokeObjectURL = vi.fn();
  vi.stubGlobal(
    'URL',
    Object.assign(class extends NativeURL {}, {
      createObjectURL,
      revokeObjectURL,
    }),
  );
  return { createObjectURL, revokeObjectURL };
}

describe('Session', () => {
  let http: HttpTestingController;
  let router: { url: string; navigate: ReturnType<typeof vi.fn> };
  let storage: ReturnType<typeof fakeStorage>;
  let dialogs: { closeAll: ReturnType<typeof vi.fn> };

  function configure(seed: Record<string, string> = {}) {
    storage = fakeStorage(seed);
    router = { url: '/accounts', navigate: vi.fn() };
    dialogs = { closeAll: vi.fn() };

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor, errorInterceptor])),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: BASE_URL },
        { provide: LocalStorage, useValue: storage },
        { provide: Router, useValue: router },
        { provide: MatDialog, useValue: dialogs },
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
      .expectOne(`${BASE_URL}/api/profile`)
      .flush({ id: 7, name: 'Ada', email: 'ada@example.com', pendingEmail: null, hasPicture: false });
    await pending;

    return session;
  }

  afterEach(() => {
    http.verify();
    vi.unstubAllGlobals();
  });

  it('starts unauthenticated and makes no request when no token is stored', async () => {
    const session = configure();

    await session.verifyBoot();

    expect(session.isAuthenticated()).toBe(false);
    expect(session.profile()).toBeNull();
    http.expectNone(`${BASE_URL}/api/profile`);
  });

  it('admits a stored token to the shell once the server confirms it', async () => {
    const session = configure({ [TOKEN_KEY]: 'stored-token' });

    const pending = session.verifyBoot();
    http
      .expectOne(`${BASE_URL}/api/profile`)
      .flush({ id: 7, name: 'Ada', email: 'ada@example.com', pendingEmail: null, hasPicture: false });
    await pending;

    expect(session.isAuthenticated()).toBe(true);
    expect(session.profile()).toEqual({
      id: 7,
      name: 'Ada',
      email: 'ada@example.com',
      pendingEmail: null,
      hasPicture: false,
    });
  });

  it('clears a stored token whose Profile no longer exists on the server', async () => {
    const session = configure({ [TOKEN_KEY]: 'stale-token' });

    const pending = session.verifyBoot();
    http.expectOne(`${BASE_URL}/api/profile`).flush(null, { status: 401, statusText: 'Unauthorized' });
    await pending;

    expect(session.isAuthenticated()).toBe(false);
    expect(session.profile()).toBeNull();
    expect(storage.getItem(TOKEN_KEY)).toBeNull();
  });

  it('keeps a stored token but stays unauthenticated when boot verification hits a transport failure', async () => {
    const session = configure({ [TOKEN_KEY]: 'stored-token' });

    const pending = session.verifyBoot();
    http.expectOne(`${BASE_URL}/api/profile`).error(new ProgressEvent('error'));
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
    request.flush({
      token: 'fresh-token',
      user: { id: 7, name: 'Ada', email: 'ada@example.com', pendingEmail: null, hasPicture: false },
    });
    await pending;

    expect(storage.getItem(TOKEN_KEY)).toBe('fresh-token');
    expect(session.isAuthenticated()).toBe(true);
    expect(session.profile()).toEqual({
      id: 7,
      name: 'Ada',
      email: 'ada@example.com',
      pendingEmail: null,
      hasPicture: false,
    });
  });

  it('loads private picture bytes into one session URL and revokes it when signing out', async () => {
    const objectUrls = stubObjectUrls();
    const session = configure({ [TOKEN_KEY]: 'live-token' });

    const pending = session.verifyBoot();
    http.expectOne(`${BASE_URL}/api/profile`).flush({
      id: 7,
      name: 'Ada',
      email: 'ada@example.com',
      pendingEmail: null,
      hasPicture: true,
    });
    await pending;

    const picture = new Blob(['picture bytes'], { type: 'image/webp' });
    const request = http.expectOne(`${BASE_URL}/api/profile/picture`);
    expect(request.request.method).toBe('GET');
    expect(request.request.responseType).toBe('blob');
    expect(request.request.headers.get('Authorization')).toBe('Bearer live-token');
    request.flush(picture, { headers: new HttpHeaders({ 'Cache-Control': 'no-store' }) });

    expect(objectUrls.createObjectURL).toHaveBeenCalledWith(picture);
    expect(session.profilePictureUrl()).toBe('blob:profile-picture');
    expect(storage.getItem(TOKEN_KEY)).toBe('live-token');

    session.signOut();

    expect(session.profilePictureUrl()).toBeNull();
    expect(objectUrls.revokeObjectURL).toHaveBeenCalledWith('blob:profile-picture');
  });

  it('revokes an undecodable image URL without claiming the saved picture was removed', async () => {
    const objectUrls = stubObjectUrls();
    const session = configure({ [TOKEN_KEY]: 'live-token' });

    const pending = session.verifyBoot();
    http.expectOne(`${BASE_URL}/api/profile`).flush({
      id: 7,
      name: 'Ada',
      email: 'ada@example.com',
      pendingEmail: null,
      hasPicture: true,
    });
    await pending;
    http.expectOne(`${BASE_URL}/api/profile/picture`).flush(new Blob(['invalid image bytes']));

    session.profilePictureDecodeFailed('blob:profile-picture');

    expect(session.profilePictureUrl()).toBeNull();
    expect(session.profile()?.hasPicture).toBe(true);
    expect(objectUrls.revokeObjectURL).toHaveBeenCalledWith('blob:profile-picture');
  });

  it('keeps hasPicture true and shows the fallback when private picture storage fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const session = configure({ [TOKEN_KEY]: 'live-token' });

    const pending = session.verifyBoot();
    http.expectOne(`${BASE_URL}/api/profile`).flush({
      id: 7,
      name: 'Ada',
      email: 'ada@example.com',
      pendingEmail: null,
      hasPicture: true,
    });
    await pending;

    http
      .expectOne(`${BASE_URL}/api/profile/picture`)
      .error(new ProgressEvent('error'), { status: 500, statusText: 'Internal Server Error' });

    expect(session.profile()?.hasPicture).toBe(true);
    expect(session.profilePictureUrl()).toBeNull();
    warn.mockRestore();
  });

  it('cancels an earlier session picture read and keeps the newer session image', async () => {
    const objectUrls = stubObjectUrls('blob:new-profile-picture');
    const session = configure();

    const firstSignIn = session.signIn({ email: 'ada@example.com', password: 'secret12' });
    http.expectOne(`${BASE_URL}/api/auth/login`).flush({
      token: 'first-token',
      user: { id: 7, name: 'Ada', email: 'ada@example.com', pendingEmail: null, hasPicture: true },
    });
    await firstSignIn;
    const earlierRead = http.expectOne(`${BASE_URL}/api/profile/picture`);

    const secondSignIn = session.signIn({ email: 'grace@example.com', password: 'secret12' });
    http.expectOne(`${BASE_URL}/api/auth/login`).flush({
      token: 'second-token',
      user: { id: 8, name: 'Grace', email: 'grace@example.com', pendingEmail: null, hasPicture: true },
    });
    await secondSignIn;
    expect(earlierRead.cancelled).toBe(true);

    const currentRead = http.expectOne(`${BASE_URL}/api/profile/picture`);
    expect(currentRead.request.headers.get('Authorization')).toBe('Bearer second-token');
    currentRead.flush(new Blob(['Grace picture'], { type: 'image/webp' }));

    expect(session.profile()?.name).toBe('Grace');
    expect(session.profilePictureUrl()).toBe('blob:new-profile-picture');
    expect(objectUrls.createObjectURL).toHaveBeenCalledOnce();
  });

  it('revokes a displayed picture when signing in switches to another Profile', async () => {
    const objectUrls = stubObjectUrls('blob:unused');
    objectUrls.createObjectURL
      .mockReturnValueOnce('blob:first-profile-picture')
      .mockReturnValueOnce('blob:second-profile-picture');
    const session = configure();

    const firstSignIn = session.signIn({ email: 'ada@example.com', password: 'secret12' });
    http.expectOne(`${BASE_URL}/api/auth/login`).flush({
      token: 'first-token',
      user: { id: 7, name: 'Ada', email: 'ada@example.com', pendingEmail: null, hasPicture: true },
    });
    await firstSignIn;
    http.expectOne(`${BASE_URL}/api/profile/picture`).flush(new Blob(['Ada picture'], { type: 'image/webp' }));
    expect(session.profilePictureUrl()).toBe('blob:first-profile-picture');

    const secondSignIn = session.signIn({ email: 'grace@example.com', password: 'secret12' });
    http.expectOne(`${BASE_URL}/api/auth/login`).flush({
      token: 'second-token',
      user: { id: 8, name: 'Grace', email: 'grace@example.com', pendingEmail: null, hasPicture: true },
    });
    await secondSignIn;

    expect(session.profile()?.name).toBe('Grace');
    expect(session.profilePictureUrl()).toBeNull();
    expect(objectUrls.revokeObjectURL).toHaveBeenCalledWith('blob:first-profile-picture');

    http.expectOne(`${BASE_URL}/api/profile/picture`).flush(new Blob(['Grace picture'], { type: 'image/webp' }));
    expect(session.profilePictureUrl()).toBe('blob:second-profile-picture');
  });

  it('ignores a boot Profile response that arrives after sign-out', async () => {
    const session = configure({ [TOKEN_KEY]: 'live-token' });
    const pending = session.verifyBoot();

    const me = http.expectOne(`${BASE_URL}/api/profile`);
    session.signOut();
    me.flush({
      id: 7,
      name: 'Ada',
      email: 'ada@example.com',
      pendingEmail: null,
      hasPicture: true,
    });
    await pending;

    expect(session.profile()).toBeNull();
    http.expectNone(`${BASE_URL}/api/profile/picture`);
  });

  it('adopts a complete-Profile response only when it belongs to the signed-in Profile', async () => {
    const session = await verifiedSession();

    session.applyProfileUpdate({
      id: 7,
      name: 'Augusta Ada King',
      email: 'ada@example.com',
      pendingEmail: null,
      hasPicture: false,
    });
    expect(session.profile()?.name).toBe('Augusta Ada King');

    session.applyProfileUpdate({
      id: 8,
      name: 'Grace Hopper',
      email: 'grace@example.com',
      pendingEmail: null,
      hasPicture: false,
    });
    expect(session.profile()).toEqual({
      id: 7,
      name: 'Augusta Ada King',
      email: 'ada@example.com',
      pendingEmail: null,
      hasPicture: false,
    });
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

  it('on expiry clears the token and returns to sign-in preserving the return URL and the lapse marker', async () => {
    const session = await verifiedSession();
    expect(session.isAuthenticated()).toBe(true);

    session.expire();

    expect(session.isAuthenticated()).toBe(false);
    expect(session.profile()).toBeNull();
    expect(storage.getItem(TOKEN_KEY)).toBeNull();
    expect(dialogs.closeAll).toHaveBeenCalledOnce();
    expect(router.navigate).toHaveBeenCalledWith(['/auth/sign-in'], {
      queryParams: { returnUrl: '/accounts', reason: 'session-expired' },
    });
  });

  it('on sign-out clears the session and returns to sign-in without a return URL or a lapse marker', async () => {
    const session = await verifiedSession();
    expect(session.isAuthenticated()).toBe(true);

    session.signOut();

    expect(session.isAuthenticated()).toBe(false);
    expect(session.profile()).toBeNull();
    expect(storage.getItem(TOKEN_KEY)).toBeNull();
    // A deliberate leave, not a lapse: nowhere to send the person back to, and
    // nothing to explain.
    expect(router.navigate).toHaveBeenCalledWith(['/auth/sign-in']);
  });

  it('clears the local session after a password reset and returns to sign-in with the reset notice', async () => {
    const session = await verifiedSession();

    session.completePasswordReset();

    expect(session.isAuthenticated()).toBe(false);
    expect(session.profile()).toBeNull();
    expect(storage.getItem(TOKEN_KEY)).toBeNull();
    expect(router.navigate).toHaveBeenCalledWith(['/auth/sign-in'], {
      queryParams: { reason: 'password-reset' },
    });
  });

  it('ignores a second sign-out once the session is already clear', async () => {
    const session = await verifiedSession();

    session.signOut();
    session.signOut();

    expect(router.navigate).toHaveBeenCalledTimes(1);
  });
});
