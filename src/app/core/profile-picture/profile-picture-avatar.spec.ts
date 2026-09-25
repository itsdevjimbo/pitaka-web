import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideIcons } from '@/app/core/icons';
import { Session } from '@/app/core/session';
import { ProfilePictureAvatar } from './profile-picture-avatar';

@Component({
  selector: 'profile-picture-avatar-test-host',
  imports: [ProfilePictureAvatar],
  template: `
    <button
      type="button"
      (click)="showProfile.set(!showProfile())"
    >
      Toggle Profile picture consumer
    </button>
    @if (showProfile()) {
      <profile-picture-avatar appearance="profile" />
    }
    <profile-picture-avatar appearance="user-menu" />
  `,
})
class AvatarHost {
  protected readonly showProfile = signal(true);
}

describe('ProfilePictureAvatar', () => {
  function setup(url: string | null = null) {
    const profilePictureUrl = signal<string | null>(url);
    const profilePictureDecodeFailed = vi.fn((failedUrl: string) => {
      if (profilePictureUrl() === failedUrl) {
        profilePictureUrl.set(null);
      }
    });

    TestBed.configureTestingModule({
      imports: [AvatarHost],
      providers: [provideIcons(), { provide: Session, useValue: { profilePictureUrl, profilePictureDecodeFailed } }],
    });

    const fixture = TestBed.createComponent(AvatarHost);
    fixture.detectChanges();

    return { fixture, profilePictureUrl, profilePictureDecodeFailed };
  }

  it('keeps the existing Profile and user-menu shapes with accessible, undistorted images', () => {
    const { fixture } = setup('blob:saved-profile-picture');
    const screen = fixture.nativeElement as HTMLElement;
    const profileAvatar = screen.querySelector('profile-picture-avatar[appearance="profile"]');
    const menuAvatar = screen.querySelector('profile-picture-avatar[appearance="user-menu"]');
    const profileImage = profileAvatar?.querySelector<HTMLImageElement>('img');
    const menuImage = menuAvatar?.querySelector<HTMLImageElement>('img');

    expect(profileImage?.getAttribute('src')).toBe('blob:saved-profile-picture');
    expect(profileImage?.getAttribute('alt')).toBe('');
    expect(profileImage?.getAttribute('aria-hidden')).toBe('true');
    expect(profileImage?.className).toContain('size-14');
    expect(profileImage?.className).toContain('rounded-full');
    expect(profileImage?.className).toContain('object-cover');
    expect(profileImage?.className).toContain('bg-soft');

    expect(menuImage?.getAttribute('src')).toBe('blob:saved-profile-picture');
    expect(menuImage?.getAttribute('alt')).toBe('');
    expect(menuImage?.getAttribute('aria-hidden')).toBe('true');
    expect(menuImage?.className).toContain('size-9');
    expect(menuImage?.className).toContain('rounded-lg');
    expect(menuImage?.className).toContain('object-cover');
    expect(menuImage?.className).toContain('bg-soft');
  });

  it('shows the themed person-icon fallback when no saved picture is available', () => {
    const { fixture } = setup();
    const screen = fixture.nativeElement as HTMLElement;
    const profileAvatar = screen.querySelector('profile-picture-avatar[appearance="profile"]');
    const menuAvatar = screen.querySelector('profile-picture-avatar[appearance="user-menu"]');

    expect(profileAvatar?.querySelector('img')).toBeNull();
    expect(menuAvatar?.querySelector('img')).toBeNull();
    expect(profileAvatar?.querySelector('mat-icon[svgIcon="user-round"]')).not.toBeNull();
    expect(menuAvatar?.querySelector('mat-icon[svgIcon="user-round"]')).not.toBeNull();
    expect(profileAvatar?.querySelector('span')?.className).toContain('dark:text-primary-200');
    expect(profileAvatar?.querySelector('span')?.className).toContain('bg-soft');
    expect(menuAvatar?.querySelector('span')?.className).toContain('bg-soft');
  });

  it('clears an image after decoding fails and restores the person icon', () => {
    const { fixture, profilePictureUrl, profilePictureDecodeFailed } = setup('blob:unreadable-picture');
    const screen = fixture.nativeElement as HTMLElement;
    const profileAvatar = screen.querySelector('profile-picture-avatar[appearance="profile"]');
    const menuAvatar = screen.querySelector('profile-picture-avatar[appearance="user-menu"]');
    const profileImage = profileAvatar?.querySelector<HTMLImageElement>('img');

    profileImage?.dispatchEvent(new Event('error'));
    fixture.detectChanges();

    expect(profilePictureDecodeFailed).toHaveBeenCalledWith('blob:unreadable-picture');
    expect(profilePictureUrl()).toBeNull();
    expect(profileAvatar?.querySelector('img')).toBeNull();
    expect(menuAvatar?.querySelector('img')).toBeNull();
    const profileIcon = profileAvatar?.querySelector('mat-icon[svgIcon="user-round"]');
    const menuIcon = menuAvatar?.querySelector('mat-icon[svgIcon="user-round"]');
    expect(profileIcon).not.toBeNull();
    expect(profileIcon?.getAttribute('aria-hidden')).toBe('true');
    expect(menuIcon).not.toBeNull();
    expect(menuIcon?.getAttribute('aria-hidden')).toBe('true');
    expect(profileAvatar?.querySelector('span')?.className).toContain('dark:text-primary-200');
    expect(profileAvatar?.querySelector('span')?.className).toContain('bg-soft');
    expect(menuAvatar?.querySelector('span')?.className).toContain('bg-soft');
  });

  it('keeps the user-menu picture visible when the Profile avatar consumer is destroyed', () => {
    const { fixture } = setup('blob:shared-profile-picture');
    const screen = fixture.nativeElement as HTMLElement;
    const toggle = screen.querySelector<HTMLButtonElement>('button');
    const menuAvatar = screen.querySelector('profile-picture-avatar[appearance="user-menu"]');

    toggle?.click();
    fixture.detectChanges();

    expect(screen.querySelector('profile-picture-avatar[appearance="profile"]')).toBeNull();
    expect(menuAvatar?.querySelector<HTMLImageElement>('img')?.getAttribute('src')).toBe('blob:shared-profile-picture');
  });
});
