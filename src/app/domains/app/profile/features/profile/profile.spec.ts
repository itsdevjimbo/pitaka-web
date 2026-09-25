import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { provideRouter, Router, RouterOutlet, type Routes } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of, Subject, throwError } from 'rxjs';
import { ApiError, API_BASE_URL, errorInterceptor } from '@/app/core/api';
import { AuthService, type Profile } from '@/app/core/auth';
import { provideDialogDefaults } from '@/app/core/dialog';
import { provideIcons } from '@/app/core/icons';
import { LocalStorage } from '@/app/core/local-storage';
import { authInterceptor, Session, type ProfileRefreshResult } from '@/app/core/session';
import { Theming } from '@/app/core/theming';
import { TEST_API_BASE_URL as BASE_URL } from '@/testing/api-base-url';
import { withOverlayContainer } from '@/testing/overlay';
import { User } from '../../../layout/ui/user';
import AppProfile from './profile';
import { profileCanDeactivateGuard } from './profile.guard';

const ADA: Profile = {
  id: 7,
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  pendingEmail: null,
  hasPicture: false,
};

@Component({
  selector: 'profile-test-destination',
  template: '<h1>Destination</h1>',
})
class Destination {}

@Component({
  selector: 'profile-picture-integration-host',
  imports: [RouterOutlet, User],
  template: '<user /><router-outlet />',
})
class ProfilePictureIntegrationHost {}

describe('Profile', () => {
  const overlay = withOverlayContainer();

  afterEach(() => vi.unstubAllGlobals());

  function setup(
    profile = signal<Profile | null>(ADA),
    authService: Partial<AuthService> = {},
    profilePictureUrl = signal<string | null>(null),
    sessionActions: {
      refreshProfile?: () => Promise<ProfileRefreshResult>;
      refreshProfileAfterPictureUpload?: () => Promise<ProfileRefreshResult>;
    } = {},
  ) {
    const routes: Routes = [
      { path: 'profile', component: AppProfile, canDeactivate: [profileCanDeactivateGuard] },
      { path: 'elsewhere', component: Destination },
    ];
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideIcons(),
        provideDialogDefaults(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        { provide: AuthService, useValue: authService },
        {
          provide: Session,
          useValue: {
            profile,
            profilePictureUrl,
            profilePictureDecodeFailed: (url: string) => {
              if (profilePictureUrl() === url) {
                profilePictureUrl.set(null);
              }
            },
            captureProfileRevision: () => null,
            beginProfileRead: () => null,
            beginProfileWrite: () => null,
            applyProfileWriteUpdate: vi.fn(),
            releaseProfileWrite: vi.fn(),
            refreshProfile: vi.fn(async () => 'refreshed' as const),
            refreshProfileAfterPictureUpload: vi.fn(async () => 'refreshed' as const),
            applyProfileUpdate: (updated: Profile) => {
              profile.set(updated);
              return true;
            },
            ...sessionActions,
          },
        },
      ],
    });
    return { profile, profilePictureUrl };
  }

  function click(root: HTMLElement, label: string): void {
    const button = Array.from(root.querySelectorAll('button')).find(
      (candidate) => candidate.textContent?.trim() === label,
    );
    if (!button) {
      throw new Error(`No button labelled "${label}"`);
    }
    button.click();
  }

  function imageFile(name = 'portrait.png', bytes = pngSignature()): File {
    return new File([bytes], name, { type: 'image/png' });
  }

  function pngSignature(): ArrayBuffer {
    return new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]).buffer;
  }

  function webpHeader(animated = false): ArrayBuffer {
    const bytes = new Uint8Array(30);
    bytes.set([82, 73, 70, 70, 22, 0, 0, 0, 87, 69, 66, 80, 86, 80, 56, 88, 10, 0, 0, 0]);
    bytes[20] = animated ? 2 : 0;
    return bytes.buffer;
  }

  function stubImageHandling(urls = ['blob:profile-picture-draft'], dimensions = { width: 32, height: 32 }) {
    const NativeURL = globalThis.URL;
    let urlIndex = 0;
    const createObjectURL = vi.fn(() => urls[Math.min(urlIndex++, urls.length - 1)]);
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', Object.assign(class extends NativeURL {}, { createObjectURL, revokeObjectURL }));
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ ...dimensions, close: vi.fn() })),
    );
    return { createObjectURL, revokeObjectURL };
  }

  function choosePicture(root: HTMLElement, file: File): void {
    const fileInput = root.querySelector<HTMLInputElement>('#profile-picture-file');
    if (!fileInput) {
      throw new Error('No Profile picture file input');
    }
    Object.defineProperty(fileInput, 'files', { configurable: true, value: [file] });
    fileInput.dispatchEvent(new Event('change'));
  }

  it('opens the native file chooser from the portrait control inside Identity', async () => {
    setup();
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/profile', AppProfile);
    const page = harness.routeNativeElement as HTMLElement;
    const identity = page.querySelector('profile-identity');
    const pictureEditor = page.querySelector('profile-picture-editor');
    const portrait = identity?.querySelector<HTMLButtonElement>('button[aria-label="Choose a Profile picture"]');
    const fileInput = page.querySelector<HTMLInputElement>('#profile-picture-file');

    expect(identity?.contains(pictureEditor)).toBe(true);
    if (!portrait || !fileInput) {
      throw new Error('Expected the Identity portrait control and Profile picture chooser');
    }
    const openFileChooser = vi.spyOn(fileInput, 'click');

    portrait.click();

    expect(openFileChooser).toHaveBeenCalledOnce();
  });

  it('protects changed Profile drafts during navigation and discards only after confirmation', async () => {
    setup();
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/profile', AppProfile);
    const page = harness.routeNativeElement as HTMLElement;

    click(page, 'Edit name');
    await harness.fixture.whenStable();
    const name = page.querySelector<HTMLInputElement>('#profile-name');
    if (!name) {
      throw new Error('No name editor');
    }
    name.value = 'Augusta Ada King';
    name.dispatchEvent(new Event('input'));
    harness.fixture.detectChanges();

    const router = TestBed.inject(Router);
    const firstNavigation = router.navigateByUrl('/elsewhere');
    await vi.waitFor(() => expect(overlay().querySelector('[role="alertdialog"]')).not.toBeNull());
    expect(overlay().textContent).toContain('Discard changes?');
    click(overlay(), 'Keep editing');
    expect(await firstNavigation).toBe(false);
    expect(router.url).toBe('/profile');
    expect(page.querySelector<HTMLInputElement>('#profile-name')?.value).toBe('Augusta Ada King');

    const secondNavigation = router.navigateByUrl('/elsewhere');
    await vi.waitFor(() => expect(overlay().querySelector('[role="alertdialog"]')).not.toBeNull());
    click(overlay(), 'Discard changes');
    expect(await secondNavigation).toBe(true);
    expect(router.url).toBe('/elsewhere');
  });

  it('allows the shared session-expiry teardown to clear the Profile and leave the route', async () => {
    const { revokeObjectURL } = stubImageHandling();
    const { profile } = setup();
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/profile', AppProfile);
    const page = harness.routeNativeElement as HTMLElement;

    expect(page.textContent).toContain('Ada Lovelace');
    choosePicture(page, imageFile());
    await harness.fixture.whenStable();
    expect(page.querySelector('profile-picture-editor profile-picture-avatar img')).not.toBeNull();
    profile.set(null);
    harness.fixture.detectChanges();

    expect(page.textContent).not.toContain('Ada Lovelace');
    expect(page.textContent).not.toContain('ada@example.com');
    expect(await TestBed.inject(Router).navigateByUrl('/elsewhere')).toBe(true);
    expect(TestBed.inject(Router).url).toBe('/elsewhere');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:profile-picture-draft');
  });

  it('shows the saved Profile picture and restores the person icon after an image decode failure', async () => {
    const { profilePictureUrl } = setup();
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/profile', AppProfile);
    const page = harness.routeNativeElement as HTMLElement;

    profilePictureUrl.set('blob:saved-profile-picture');
    harness.fixture.detectChanges();

    const picture = page.querySelector<HTMLImageElement>('img');
    expect(picture?.getAttribute('src')).toBe('blob:saved-profile-picture');
    expect(picture?.getAttribute('alt')).toBe('');
    expect(picture?.classList.contains('object-cover')).toBe(true);

    picture?.dispatchEvent(new Event('error'));
    harness.fixture.detectChanges();

    expect(page.querySelector('img')).toBeNull();
    expect(page.querySelector('mat-icon[svgIcon="user-round"]')).not.toBeNull();
  });

  it('previews a selected picture and releases the draft when Cancel is chosen', async () => {
    const { revokeObjectURL } = stubImageHandling([
      'blob:first-profile-picture-draft',
      'blob:replacement-profile-picture-draft',
    ]);
    setup();
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/profile', AppProfile);
    const page = harness.routeNativeElement as HTMLElement;
    choosePicture(page, imageFile());
    await harness.fixture.whenStable();
    harness.fixture.detectChanges();

    choosePicture(page, imageFile('replacement.png'));
    await harness.fixture.whenStable();
    harness.fixture.detectChanges();

    const preview = page.querySelector<HTMLImageElement>('profile-picture-editor profile-picture-avatar img');
    expect(preview?.getAttribute('src')).toBe('blob:replacement-profile-picture-draft');
    expect(page.textContent).toContain('JPEG, PNG, or WebP');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:first-profile-picture-draft');

    const firstNavigation = TestBed.inject(Router).navigateByUrl('/elsewhere');
    await vi.waitFor(() => expect(overlay().querySelector('[role="alertdialog"]')).not.toBeNull());
    click(overlay(), 'Keep editing');
    expect(await firstNavigation).toBe(false);

    click(page, 'Cancel');
    await harness.fixture.whenStable();
    expect(overlay().textContent).toContain('Discard changes?');
    click(overlay(), 'Discard changes');
    await harness.fixture.whenStable();
    harness.fixture.detectChanges();

    expect(page.querySelector('profile-picture-editor profile-picture-avatar img')).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:replacement-profile-picture-draft');
    expect(document.activeElement).toBe(
      page.querySelector('profile-picture-editor button[aria-label="Choose a Profile picture"]'),
    );
    expect(await TestBed.inject(Router).navigateByUrl('/elsewhere')).toBe(true);
  });

  it('accepts JPEG, PNG, and WebP from their bytes even when the filename and declared type disagree', async () => {
    stubImageHandling(['blob:jpeg-preview', 'blob:png-preview', 'blob:webp-preview']);
    setup();
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/profile', AppProfile);
    const page = harness.routeNativeElement as HTMLElement;
    const selections = [
      new File([new Uint8Array([255, 216, 255, 224]).buffer], 'portrait.bin', { type: 'text/plain' }),
      imageFile('portrait.jpeg'),
      new File([webpHeader()], 'portrait.jpeg', { type: 'image/jpeg' }),
    ];

    for (const [index, file] of selections.entries()) {
      choosePicture(page, file);
      await harness.fixture.whenStable();
      harness.fixture.detectChanges();
      expect(
        page.querySelector<HTMLImageElement>('profile-picture-editor profile-picture-avatar img')?.getAttribute('src'),
      ).toBe(['blob:jpeg-preview', 'blob:png-preview', 'blob:webp-preview'][index]);
    }
  });

  it('rejects spoofed, animated, oversized, and over-dimension selections', async () => {
    stubImageHandling([], { width: 4097, height: 32 });
    setup();
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/profile', AppProfile);
    const page = harness.routeNativeElement as HTMLElement;
    const animated = new Uint8Array(20);
    animated.set(new Uint8Array(pngSignature()));
    animated.set([0, 0, 0, 8, 97, 99, 84, 76], 8);
    const selections = [
      {
        file: new File(['not an image'], 'portrait.png', { type: 'image/png' }),
        message: 'Choose a valid JPEG, PNG, or WebP image.',
      },
      {
        file: imageFile('animated.png', animated.buffer),
        message: 'Animated images are not supported.',
      },
      {
        file: new File([webpHeader(true)], 'moving.webp', { type: 'image/webp' }),
        message: 'Animated images are not supported.',
      },
      {
        file: new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' }),
        message: 'no larger than 2 MB',
      },
      {
        file: imageFile(),
        message: 'no larger than 4096 × 4096 pixels',
      },
    ];

    for (const selection of selections) {
      choosePicture(page, selection.file);
      await harness.fixture.whenStable();
      harness.fixture.detectChanges();
      expect(page.querySelector('[role="alert"]')?.textContent).toContain(selection.message);
      expect(page.querySelector('profile-picture-editor profile-picture-avatar img')).toBeNull();
    }
  });

  it('keeps a rejected upload selected for retry and distinguishes upload success from refresh failure', async () => {
    const { revokeObjectURL } = stubImageHandling();
    const profilePictureUrl = signal<string | null>('blob:previous-saved-picture');
    const uploadProfilePicture = vi
      .fn()
      .mockReturnValueOnce(
        throwError(
          () =>
            new ApiError('The server rejected this image. Please choose another picture.', 400, {
              file: ['This field detail should remain inside the API adapter.'],
            }),
        ),
      )
      .mockReturnValueOnce(of(undefined));
    const refreshProfileAfterPictureUpload = vi.fn(async () => 'stale' as const);
    const refreshProfile = vi.fn(async () => {
      profilePictureUrl.set('blob:refreshed-saved-picture');
      return 'refreshed' as const;
    });
    setup(signal<Profile | null>(ADA), { uploadProfilePicture }, profilePictureUrl, {
      refreshProfileAfterPictureUpload,
      refreshProfile,
    });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/profile', AppProfile);
    const page = harness.routeNativeElement as HTMLElement;
    const file = imageFile();
    choosePicture(page, file);
    await harness.fixture.whenStable();

    click(page, 'Save picture');
    await harness.fixture.whenStable();
    harness.fixture.detectChanges();

    expect(page.querySelector('[role="alert"]')?.textContent).toContain(
      'The server rejected this image. Please choose another picture.',
    );
    expect(page.querySelector('profile-picture-editor profile-picture-avatar img')).not.toBeNull();
    expect(profilePictureUrl()).toBe('blob:previous-saved-picture');

    click(page, 'Save picture');
    await harness.fixture.whenStable();
    harness.fixture.detectChanges();

    expect(uploadProfilePicture).toHaveBeenCalledTimes(2);
    expect(uploadProfilePicture).toHaveBeenNthCalledWith(2, file);
    expect(page.querySelector('profile-picture-editor profile-picture-avatar img')?.getAttribute('src')).toBe(
      'blob:previous-saved-picture',
    );
    expect(page.querySelector('[role="alert"]')?.textContent).toContain('could not be refreshed');
    expect(page.querySelector('[role="alert"]')?.textContent).toContain('Retry refresh');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:profile-picture-draft');
    expect(refreshProfileAfterPictureUpload).toHaveBeenCalledOnce();

    click(page, 'Retry refresh');
    await harness.fixture.whenStable();
    harness.fixture.detectChanges();

    expect(refreshProfile).toHaveBeenCalledOnce();
    expect(profilePictureUrl()).toBe('blob:refreshed-saved-picture');
    expect(page.textContent).toContain('Profile picture saved.');
    expect(page.textContent).not.toContain('could not be refreshed');
  });

  it('explains a confirmed missing saved picture and lets the user choose another image', async () => {
    stubImageHandling();
    const uploadProfilePicture = vi.fn(() => of(undefined));
    const refreshProfileAfterPictureUpload = vi.fn(async () => 'absent' as const);
    setup(signal<Profile | null>(ADA), { uploadProfilePicture }, signal<string | null>('blob:old-picture'), {
      refreshProfileAfterPictureUpload,
    });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/profile', AppProfile);
    const page = harness.routeNativeElement as HTMLElement;
    choosePicture(page, imageFile());
    await harness.fixture.whenStable();
    click(page, 'Save picture');
    await harness.fixture.whenStable();
    harness.fixture.detectChanges();

    expect(page.querySelector('[role="alert"]')?.textContent).toContain('server reports no saved Profile picture');
    expect(page.querySelector('[role="alert"]')?.textContent).not.toContain('could not be refreshed');
    expect(page.textContent).not.toContain('Retry refresh');
    expect(page.querySelector<HTMLInputElement>('#profile-picture-file')?.disabled).toBe(false);
  });

  it('blocks navigation and duplicate uploads while the picture write is pending', async () => {
    const { revokeObjectURL } = stubImageHandling();
    const upload = new Subject<void>();
    const uploadProfilePicture = vi.fn(() => upload.asObservable());
    const profilePictureUrl = signal<string | null>(null);
    const refreshProfileAfterPictureUpload = vi.fn(async () => {
      profilePictureUrl.set('blob:saved-profile-picture');
      return 'refreshed' as const;
    });
    setup(signal<Profile | null>(ADA), { uploadProfilePicture }, profilePictureUrl, {
      refreshProfileAfterPictureUpload,
    });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/profile', AppProfile);
    const page = harness.routeNativeElement as HTMLElement;
    choosePicture(page, imageFile());
    await harness.fixture.whenStable();
    click(page, 'Save picture');
    harness.fixture.detectChanges();

    const saveButton = Array.from(page.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.trim() === 'Saving…',
    );
    expect(saveButton?.disabled).toBe(true);
    saveButton?.click();
    expect(uploadProfilePicture).toHaveBeenCalledOnce();
    expect(await TestBed.inject(Router).navigateByUrl('/elsewhere')).toBe(false);
    harness.fixture.detectChanges();
    expect(page.textContent).toContain('Saving in progress. Wait for it to finish before closing.');

    upload.next(undefined);
    upload.complete();
    await harness.fixture.whenStable();
    harness.fixture.detectChanges();

    expect(refreshProfileAfterPictureUpload).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:profile-picture-draft');
    expect(
      page
        .querySelector('profile-identity profile-picture-editor button[aria-label="Choose a Profile picture"] img')
        ?.getAttribute('src'),
    ).toBe('blob:saved-profile-picture');
    expect(await TestBed.inject(Router).navigateByUrl('/elsewhere')).toBe(true);
  });

  it('updates the Profile and user menu together after a successful picture upload', async () => {
    const objectUrls = stubImageHandling(['blob:picture-preview', 'blob:uploaded-profile-picture']);
    const stored = new Map<string, string>();
    TestBed.configureTestingModule({
      imports: [ProfilePictureIntegrationHost],
      providers: [
        provideRouter([{ path: 'profile', component: AppProfile, canDeactivate: [profileCanDeactivateGuard] }]),
        provideHttpClient(withInterceptors([authInterceptor, errorInterceptor])),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: BASE_URL },
        {
          provide: LocalStorage,
          useValue: {
            getItem: (key: string) => stored.get(key) ?? null,
            setItem: (key: string, value: string) => void stored.set(key, value),
            removeItem: (key: string) => void stored.delete(key),
          },
        },
        provideIcons(),
        provideDialogDefaults(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        {
          provide: Theming,
          useValue: { scheme: signal('light'), persistenceNotice: signal(null), setScheme: vi.fn() },
        },
      ],
    });
    const http = TestBed.inject(HttpTestingController);
    const session = TestBed.inject(Session);
    const signIn = session.signIn({ email: 'ada@example.com', password: 'secret12' });
    http.expectOne(`${BASE_URL}/api/auth/login`).flush({
      token: 'picture-upload-token',
      user: ADA,
    });
    await signIn;

    const fixture = TestBed.createComponent(ProfilePictureIntegrationHost);
    fixture.detectChanges();
    await TestBed.inject(Router).navigateByUrl('/profile');
    fixture.detectChanges();
    await fixture.whenStable();

    const page = fixture.nativeElement as HTMLElement;
    choosePicture(page, imageFile());
    await fixture.whenStable();
    click(page, 'Save picture');
    fixture.detectChanges();

    const upload = http.expectOne(`${BASE_URL}/api/profile/picture`);
    expect(upload.request.method).toBe('PUT');
    expect(upload.request.headers.get('Authorization')).toBe('Bearer picture-upload-token');
    expect((upload.request.body as FormData).get('File')).toBeInstanceOf(File);
    upload.flush(null, { status: 204, statusText: 'No Content' });
    await Promise.resolve();
    http.expectOne(`${BASE_URL}/api/profile`).flush({ ...ADA, hasPicture: true });
    await Promise.resolve();
    http.expectOne(`${BASE_URL}/api/profile/picture`).flush(new Blob(['saved image'], { type: 'image/png' }));
    await fixture.whenStable();
    fixture.detectChanges();

    const profileImage = page
      .querySelector(
        'profile-identity profile-picture-editor button[aria-label="Choose a Profile picture"] profile-picture-avatar',
      )
      ?.querySelector<HTMLImageElement>('img');
    const userMenuImage = page
      .querySelector('user profile-picture-avatar[appearance="user-menu"]')
      ?.querySelector<HTMLImageElement>('img');
    expect(session.profile()?.hasPicture).toBe(true);
    expect(profileImage?.getAttribute('src')).toBe('blob:uploaded-profile-picture');
    expect(userMenuImage?.getAttribute('src')).toBe('blob:uploaded-profile-picture');
    expect(objectUrls.createObjectURL).toHaveBeenCalledTimes(2);
    http.verify();
  });

  it('acknowledges a confirmed email change after the live Profile reflects the new address', async () => {
    const profile = signal<Profile | null>({ ...ADA, pendingEmail: 'new@example.com' });
    setup(profile);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/elsewhere', Destination);
    profile.set({ ...ADA, email: 'new@example.com', pendingEmail: null });

    await TestBed.inject(Router).navigateByUrl('/profile', { state: { emailChangeConfirmed: true } });
    harness.fixture.detectChanges();

    expect((harness.routeNativeElement as HTMLElement).textContent).toContain('Email address changed');
    expect((harness.routeNativeElement as HTMLElement).textContent).not.toContain('Pending email change');
    expect((harness.routeNativeElement as HTMLElement).textContent).toContain('new@example.com');
  });

  it('blocks navigation while a Profile save is pending and explains why', async () => {
    const save = new Subject<Profile>();
    const updateProfile = vi.fn(() => save.asObservable());
    setup(signal<Profile | null>(ADA), { updateProfile });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/profile', AppProfile);
    const page = harness.routeNativeElement as HTMLElement;

    click(page, 'Edit name');
    await harness.fixture.whenStable();
    const name = page.querySelector<HTMLInputElement>('#profile-name');
    if (!name) {
      throw new Error('No name editor');
    }
    name.value = 'Augusta Ada King';
    name.dispatchEvent(new Event('input'));
    page.querySelector('form')?.dispatchEvent(new Event('submit'));
    harness.fixture.detectChanges();

    expect(updateProfile).toHaveBeenCalledOnce();
    expect(await TestBed.inject(Router).navigateByUrl('/elsewhere')).toBe(false);
    harness.fixture.detectChanges();
    expect(page.textContent).toContain('Saving in progress. Wait for it to finish before closing.');
    expect(overlay().querySelector('[role="alertdialog"]')).toBeNull();

    save.next({ ...ADA, name: 'Augusta Ada King' });
    save.complete();
    await harness.fixture.whenStable();
    harness.fixture.detectChanges();
    expect(page.textContent).toContain('Name updated');
    expect(await TestBed.inject(Router).navigateByUrl('/elsewhere')).toBe(true);
  });
});
