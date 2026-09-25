import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { provideRouter, Router, type Routes } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Subject } from 'rxjs';
import { AuthService, type Profile } from '@/app/core/auth';
import { provideDialogDefaults } from '@/app/core/dialog';
import { provideIcons } from '@/app/core/icons';
import { Session } from '@/app/core/session';
import { withOverlayContainer } from '@/testing/overlay';
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

describe('Profile', () => {
  const overlay = withOverlayContainer();

  function setup(
    profile = signal<Profile | null>(ADA),
    authService: Partial<AuthService> = {},
    profilePictureUrl = signal<string | null>(null),
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
            applyProfileUpdate: (updated: Profile) => profile.set(updated),
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
    const { profile } = setup();
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/profile', AppProfile);
    const page = harness.routeNativeElement as HTMLElement;

    expect(page.textContent).toContain('Ada Lovelace');
    profile.set(null);
    harness.fixture.detectChanges();

    expect(page.textContent).not.toContain('Ada Lovelace');
    expect(page.textContent).not.toContain('ada@example.com');
    expect(await TestBed.inject(Router).navigateByUrl('/elsewhere')).toBe(true);
    expect(TestBed.inject(Router).url).toBe('/elsewhere');
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
