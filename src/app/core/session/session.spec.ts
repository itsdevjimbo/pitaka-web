import { HttpHeaders, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL, errorInterceptor } from '@/app/core/api';
import { AuthService, type Profile } from '@/app/core/auth';
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

  it('treats a missing image response as an absent saved picture', async () => {
    const session = configure({ [TOKEN_KEY]: 'live-token' });
    const boot = session.verifyBoot();
    http.expectOne(`${BASE_URL}/api/profile`).flush({
      id: 7,
      name: 'Ada',
      email: 'ada@example.com',
      pendingEmail: null,
      hasPicture: true,
    });
    await boot;

    http
      .expectOne(`${BASE_URL}/api/profile/picture`)
      .error(new ProgressEvent('error'), { status: 404, statusText: 'Not Found' });

    expect(session.profile()?.hasPicture).toBe(false);
    expect(session.profilePictureUrl()).toBeNull();
  });

  it('refreshes a replaced picture without letting an older Profile response undo newer identity fields', async () => {
    const objectUrls = stubObjectUrls('blob:unused');
    objectUrls.createObjectURL
      .mockReturnValueOnce('blob:old-profile-picture')
      .mockReturnValueOnce('blob:new-profile-picture');
    const session = configure({ [TOKEN_KEY]: 'live-token' });
    const boot = session.verifyBoot();
    http.expectOne(`${BASE_URL}/api/profile`).flush({
      id: 7,
      name: 'Ada',
      email: 'ada@example.com',
      pendingEmail: null,
      hasPicture: true,
    });
    await boot;
    http.expectOne(`${BASE_URL}/api/profile/picture`).flush(new Blob(['old picture']));

    const olderRead = session.beginProfileRead();
    const refreshing = session.refreshProfileAfterPictureUpload();
    const profileRequest = http.expectOne(`${BASE_URL}/api/profile`);
    const currentProfile = session.profile() as Profile;
    const nameWrite = session.beginProfileWrite(['name']);
    if (nameWrite === null) {
      throw new Error('Expected the verified session to reserve a name update');
    }
    session.applyProfileWriteUpdate({ ...currentProfile, name: 'Augusta Ada King' }, nameWrite, ['name']);
    const renamedProfile = session.profile() as Profile;
    const emailWrite = session.beginProfileWrite(['email']);
    if (emailWrite === null) {
      throw new Error('Expected the verified session to reserve an email update');
    }
    session.applyProfileWriteUpdate({ ...renamedProfile, email: 'ada.new@example.com' }, emailWrite, ['email']);
    profileRequest.flush({
      id: 7,
      name: 'Ada',
      email: 'ada@example.com',
      pendingEmail: null,
      hasPicture: true,
    });
    await Promise.resolve();
    http.expectOne(`${BASE_URL}/api/profile/picture`).flush(new Blob(['new picture']));
    await expect(refreshing).resolves.toBe('refreshed');

    session.applyProfileUpdate(
      { id: 7, name: 'Ada', email: 'old@example.com', pendingEmail: null, hasPicture: false },
      olderRead,
    );

    expect(session.profile()).toEqual({
      id: 7,
      name: 'Augusta Ada King',
      email: 'ada.new@example.com',
      pendingEmail: null,
      hasPicture: true,
    });
    expect(session.profilePictureUrl()).toBe('blob:new-profile-picture');
    expect(objectUrls.revokeObjectURL).toHaveBeenCalledWith('blob:old-profile-picture');
  });

  it('keeps the displayed picture through a failed refresh and replaces it after recovery', async () => {
    const objectUrls = stubObjectUrls('blob:unused');
    objectUrls.createObjectURL
      .mockReturnValueOnce('blob:current-picture')
      .mockReturnValueOnce('blob:refreshed-picture');
    const session = configure({ [TOKEN_KEY]: 'live-token' });
    const boot = session.verifyBoot();
    http.expectOne(`${BASE_URL}/api/profile`).flush({
      id: 7,
      name: 'Ada',
      email: 'ada@example.com',
      pendingEmail: null,
      hasPicture: true,
    });
    await boot;
    http.expectOne(`${BASE_URL}/api/profile/picture`).flush(new Blob(['old picture']));

    const failedRefresh = session.refreshProfile();
    http.expectOne(`${BASE_URL}/api/profile`).flush({
      id: 7,
      name: 'Ada',
      email: 'ada@example.com',
      pendingEmail: null,
      hasPicture: true,
    });
    await Promise.resolve();
    http
      .expectOne(`${BASE_URL}/api/profile/picture`)
      .error(new ProgressEvent('error'), { status: 500, statusText: 'Internal Server Error' });
    await expect(failedRefresh).rejects.toMatchObject({ status: 500 });
    expect(session.profilePictureUrl()).toBe('blob:current-picture');

    const recoveredRefresh = session.refreshProfile();
    http.expectOne(`${BASE_URL}/api/profile`).flush({
      id: 7,
      name: 'Ada',
      email: 'ada@example.com',
      pendingEmail: null,
      hasPicture: true,
    });
    await Promise.resolve();
    http.expectOne(`${BASE_URL}/api/profile/picture`).flush(new Blob(['new picture']));
    await expect(recoveredRefresh).resolves.toBe('refreshed');

    expect(session.profilePictureUrl()).toBe('blob:refreshed-picture');
    expect(objectUrls.revokeObjectURL).toHaveBeenCalledWith('blob:current-picture');
  });

  it('reports confirmed missing metadata separately from a failed refresh', async () => {
    const objectUrls = stubObjectUrls('blob:old-profile-picture');
    const session = configure({ [TOKEN_KEY]: 'live-token' });
    const boot = session.verifyBoot();
    http.expectOne(`${BASE_URL}/api/profile`).flush({
      id: 7,
      name: 'Ada',
      email: 'ada@example.com',
      pendingEmail: null,
      hasPicture: true,
    });
    await boot;
    http.expectOne(`${BASE_URL}/api/profile/picture`).flush(new Blob(['old picture']));

    const refreshing = session.refreshProfileAfterPictureUpload();
    http.expectOne(`${BASE_URL}/api/profile`).flush({
      id: 7,
      name: 'Ada',
      email: 'ada@example.com',
      pendingEmail: null,
      hasPicture: false,
    });

    await expect(refreshing).resolves.toBe('absent');
    expect(session.profile()?.hasPicture).toBe(false);
    expect(session.profilePictureUrl()).toBeNull();
    expect(objectUrls.revokeObjectURL).toHaveBeenCalledWith('blob:old-profile-picture');
  });

  it('keeps a removed picture absent across delayed metadata and newer identity writes', async () => {
    const objectUrls = stubObjectUrls('blob:saved-profile-picture');
    const session = configure({ [TOKEN_KEY]: 'live-token' });
    const boot = session.verifyBoot();
    http.expectOne(`${BASE_URL}/api/profile`).flush({
      id: 7,
      name: 'Ada',
      email: 'ada@example.com',
      pendingEmail: null,
      hasPicture: true,
    });
    await boot;
    http.expectOne(`${BASE_URL}/api/profile/picture`).flush(new Blob(['saved picture']));

    const earlierRead = session.beginProfileRead();
    const operation = session.beginProfilePictureOperation();
    if (operation === null) {
      throw new Error('Expected the signed-in Profile to claim its picture operation');
    }
    const write = session.beginProfilePictureWrite(operation);
    if (write === null) {
      throw new Error('Expected the picture operation to reserve hasPicture');
    }
    session.applyProfilePictureRemoval(write);

    expect(session.profile()?.hasPicture).toBe(false);
    expect(session.profilePictureUrl()).toBeNull();
    expect(session.profilePictureOperationPending()).toBe(true);
    expect(objectUrls.revokeObjectURL).toHaveBeenCalledWith('blob:saved-profile-picture');

    const refreshing = session.refreshProfileAfterPictureRemoval();
    const profileRequest = http.expectOne(`${BASE_URL}/api/profile`);
    const current = session.profile();
    if (current === null) {
      throw new Error('Expected the Profile to remain signed in');
    }
    const nameWrite = session.beginProfileWrite(['name']);
    if (nameWrite === null) {
      throw new Error('Expected the Profile to reserve a name update');
    }
    session.applyProfileWriteUpdate({ ...current, name: 'Augusta Ada King' }, nameWrite, ['name']);
    const renamed = session.profile();
    if (renamed === null) {
      throw new Error('Expected the renamed Profile to remain signed in');
    }
    const emailWrite = session.beginProfileWrite(['email']);
    if (emailWrite === null) {
      throw new Error('Expected the Profile to reserve an email update');
    }
    session.applyProfileWriteUpdate({ ...renamed, email: 'ada.new@example.com' }, emailWrite, ['email']);

    profileRequest.flush({
      id: 7,
      name: 'Ada',
      email: 'ada@example.com',
      pendingEmail: null,
      hasPicture: true,
    });
    await expect(refreshing).resolves.toBe('picture-present');
    session.applyProfileUpdate(
      { id: 7, name: 'Old Ada', email: 'old@example.com', pendingEmail: null, hasPicture: true },
      earlierRead,
    );
    session.releaseProfilePictureOperation(operation);

    expect(session.profile()).toEqual({
      id: 7,
      name: 'Augusta Ada King',
      email: 'ada.new@example.com',
      pendingEmail: null,
      hasPicture: false,
    });
    expect(session.profilePictureUrl()).toBeNull();
    expect(session.profilePictureOperationPending()).toBe(false);
    expect(objectUrls.createObjectURL).toHaveBeenCalledOnce();
  });

  it('cancels an in-flight saved-picture read when removal succeeds', async () => {
    const session = configure({ [TOKEN_KEY]: 'live-token' });
    const boot = session.verifyBoot();
    http.expectOne(`${BASE_URL}/api/profile`).flush({
      id: 7,
      name: 'Ada',
      email: 'ada@example.com',
      pendingEmail: null,
      hasPicture: true,
    });
    await boot;
    const pictureRead = http.expectOne(`${BASE_URL}/api/profile/picture`);
    const operation = session.beginProfilePictureOperation();
    if (operation === null) {
      throw new Error('Expected the signed-in Profile to claim its picture operation');
    }
    const write = session.beginProfilePictureWrite(operation);
    if (write === null) {
      throw new Error('Expected the picture operation to reserve hasPicture');
    }

    session.applyProfilePictureRemoval(write);

    expect(pictureRead.cancelled).toBe(true);
    expect(session.profile()?.hasPicture).toBe(false);
    expect(session.profilePictureUrl()).toBeNull();
    session.releaseProfilePictureOperation(operation);
  });

  it('discards a removal refresh after the session ends', async () => {
    const session = await verifiedSession();
    const refreshing = session.refreshProfileAfterPictureRemoval();
    const request = http.expectOne(`${BASE_URL}/api/profile`);

    session.signOut();
    request.flush({
      id: 7,
      name: 'Ada',
      email: 'ada@example.com',
      pendingEmail: null,
      hasPicture: false,
    });

    await expect(refreshing).resolves.toBe('stale');
    expect(session.profile()).toBeNull();
  });

  it('allows only one Profile picture operation at a time and clears it on session expiry', async () => {
    const session = await verifiedSession();
    const operation = session.beginProfilePictureOperation();
    if (operation === null) {
      throw new Error('Expected the signed-in Profile to claim its picture operation');
    }

    expect(session.beginProfilePictureOperation()).toBeNull();
    expect(session.profilePictureOperationPending()).toBe(true);

    session.expire();

    expect(session.profilePictureOperationPending()).toBe(false);
    expect(session.profile()).toBeNull();
    expect(dialogs.closeAll).toHaveBeenCalledOnce();
    session.releaseProfilePictureOperation(operation);
    expect(session.beginProfilePictureOperation()).toBeNull();
  });

  it('keeps the latest-started whole-Profile refresh when an earlier response arrives first', async () => {
    const session = await verifiedSession();
    const earlierRefresh = session.refreshProfile();
    const earlierRequest = http.expectOne(`${BASE_URL}/api/profile`);
    const laterRefresh = session.refreshProfile();
    const laterRequest = http.expectOne(`${BASE_URL}/api/profile`);

    earlierRequest.flush({
      id: 7,
      name: 'Older response',
      email: 'ada@example.com',
      pendingEmail: null,
      hasPicture: false,
    });
    await expect(earlierRefresh).resolves.toBe('stale');
    laterRequest.flush({
      id: 7,
      name: 'Newer response',
      email: 'ada@example.com',
      pendingEmail: null,
      hasPicture: false,
    });

    await expect(laterRefresh).resolves.toBe('absent');
    expect(session.profile()?.name).toBe('Newer response');
  });

  it('orders ProfileEmail reads against picture refreshes through the shared Session owner', async () => {
    const session = await verifiedSession();
    const earlierRevision = session.beginProfileRead();
    if (earlierRevision === null) {
      throw new Error('Expected the verified session to begin a Profile read');
    }
    const earlierRead = firstValueFrom(TestBed.inject(AuthService).me());
    const earlierRequest = http.expectOne(`${BASE_URL}/api/profile`);
    const laterRefresh = session.refreshProfile();
    const laterRequest = http.expectOne(`${BASE_URL}/api/profile`);

    earlierRequest.flush({
      id: 7,
      name: 'Older ProfileEmail read',
      email: 'ada@example.com',
      pendingEmail: null,
      hasPicture: false,
    });
    session.applyProfileUpdate(await earlierRead, earlierRevision);
    expect(session.profile()?.name).toBe('Ada');

    laterRequest.flush({
      id: 7,
      name: 'Newer picture refresh',
      email: 'ada@example.com',
      pendingEmail: null,
      hasPicture: false,
    });
    await expect(laterRefresh).resolves.toBe('absent');
    expect(session.profile()?.name).toBe('Newer picture refresh');
  });

  it('does not let a Profile read suppress a name write that is still pending', async () => {
    const session = await verifiedSession();
    const writeRevision = session.beginProfileWrite(['name']);
    if (writeRevision === null) {
      throw new Error('Expected the verified session to reserve a name update');
    }
    const refreshing = session.refreshProfile();
    http.expectOne(`${BASE_URL}/api/profile`).flush({
      id: 7,
      name: 'Name from the older read',
      email: 'ada@example.com',
      pendingEmail: null,
      hasPicture: false,
    });

    await expect(refreshing).resolves.toBe('absent');
    expect(session.profile()?.name).toBe('Ada');

    session.applyProfileWriteUpdate(
      { id: 7, name: 'Name from the completed write', email: 'ada@example.com', pendingEmail: null, hasPicture: false },
      writeRevision,
      ['name'],
    );

    expect(session.profile()?.name).toBe('Name from the completed write');
  });

  it('ignores a superseded picture read when a newer Profile refresh starts', async () => {
    const objectUrls = stubObjectUrls('blob:unused');
    objectUrls.createObjectURL.mockReturnValueOnce('blob:current-picture').mockReturnValueOnce('blob:latest-picture');
    const session = configure({ [TOKEN_KEY]: 'live-token' });
    const boot = session.verifyBoot();
    http.expectOne(`${BASE_URL}/api/profile`).flush({
      id: 7,
      name: 'Ada',
      email: 'ada@example.com',
      pendingEmail: null,
      hasPicture: true,
    });
    await boot;
    http.expectOne(`${BASE_URL}/api/profile/picture`).flush(new Blob(['current picture']));

    const earlierRefresh = session.refreshProfile();
    http.expectOne(`${BASE_URL}/api/profile`).flush({
      id: 7,
      name: 'Ada',
      email: 'ada@example.com',
      pendingEmail: null,
      hasPicture: true,
    });
    await Promise.resolve();
    const earlierPictureRead = http.expectOne(`${BASE_URL}/api/profile/picture`);

    const laterRefresh = session.refreshProfile();
    const laterProfileRead = http.expectOne(`${BASE_URL}/api/profile`);
    earlierPictureRead.flush(new Blob(['superseded picture']));
    await expect(earlierRefresh).resolves.toBe('stale');
    expect(session.profilePictureUrl()).toBe('blob:current-picture');

    laterProfileRead.flush({
      id: 7,
      name: 'Ada',
      email: 'ada@example.com',
      pendingEmail: null,
      hasPicture: true,
    });
    await Promise.resolve();
    http.expectOne(`${BASE_URL}/api/profile/picture`).flush(new Blob(['latest picture']));
    await expect(laterRefresh).resolves.toBe('refreshed');

    expect(session.profilePictureUrl()).toBe('blob:latest-picture');
    expect(objectUrls.createObjectURL).toHaveBeenCalledTimes(2);
  });

  it('does not expire a session for a superseded Profile refresh 401', async () => {
    const session = await verifiedSession();
    const earlierRefresh = session.refreshProfile();
    const earlierRequest = http.expectOne(`${BASE_URL}/api/profile`);
    const laterRefresh = session.refreshProfile();
    const laterRequest = http.expectOne(`${BASE_URL}/api/profile`);

    earlierRequest.flush(null, { status: 401, statusText: 'Unauthorized' });
    await expect(earlierRefresh).resolves.toBe('stale');
    expect(session.isAuthenticated()).toBe(true);
    expect(storage.getItem(TOKEN_KEY)).toBe('live-token');

    laterRequest.flush({
      id: 7,
      name: 'Ada',
      email: 'ada@example.com',
      pendingEmail: null,
      hasPicture: false,
    });
    await expect(laterRefresh).resolves.toBe('absent');
    expect(session.isAuthenticated()).toBe(true);
  });

  it('reports a confirmed missing picture response separately from a failed refresh', async () => {
    const objectUrls = stubObjectUrls('blob:old-profile-picture');
    const session = configure({ [TOKEN_KEY]: 'live-token' });
    const boot = session.verifyBoot();
    http.expectOne(`${BASE_URL}/api/profile`).flush({
      id: 7,
      name: 'Ada',
      email: 'ada@example.com',
      pendingEmail: null,
      hasPicture: true,
    });
    await boot;
    http.expectOne(`${BASE_URL}/api/profile/picture`).flush(new Blob(['old picture']));

    const refreshing = session.refreshProfileAfterPictureUpload();
    http.expectOne(`${BASE_URL}/api/profile`).flush({
      id: 7,
      name: 'Ada',
      email: 'ada@example.com',
      pendingEmail: null,
      hasPicture: true,
    });
    await Promise.resolve();
    http
      .expectOne(`${BASE_URL}/api/profile/picture`)
      .error(new ProgressEvent('error'), { status: 404, statusText: 'Not Found' });

    await expect(refreshing).resolves.toBe('absent');
    expect(session.profile()?.hasPicture).toBe(false);
    expect(session.profilePictureUrl()).toBeNull();
    expect(objectUrls.revokeObjectURL).toHaveBeenCalledWith('blob:old-profile-picture');
  });

  it('ignores a Profile refresh that finishes after the signed-in session has ended', async () => {
    const session = await verifiedSession();
    const refreshing = session.refreshProfile();
    const profileRequest = http.expectOne(`${BASE_URL}/api/profile`);

    session.signOut();
    profileRequest.flush({
      id: 7,
      name: 'Ada',
      email: 'ada@example.com',
      pendingEmail: null,
      hasPicture: true,
    });

    await expect(refreshing).resolves.toBe('stale');
    expect(session.profile()).toBeNull();
    http.expectNone(`${BASE_URL}/api/profile/picture`);
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
