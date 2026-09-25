import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Profile } from '@/app/core/auth';
import { provideIcons } from '@/app/core/icons';
import { Session } from '@/app/core/session';
import { Theming } from '@/app/core/theming';
import { withOverlayContainer } from '@/testing/overlay';
import { User } from './user';

describe('User', () => {
  const ada: Profile = { id: 7, name: 'Ada Lovelace', email: 'ada@example.com', pendingEmail: null, hasPicture: false };
  const overlay = withOverlayContainer();

  function setup(profile: Profile | null = ada) {
    const signOut = vi.fn();
    const profilePictureUrl = signal<string | null>(null);
    const profilePictureDecodeFailed = vi.fn((url: string) => {
      if (profilePictureUrl() === url) {
        profilePictureUrl.set(null);
      }
    });

    TestBed.configureTestingModule({
      imports: [User],
      providers: [
        provideRouter([]),
        provideIcons(),
        {
          provide: Session,
          useValue: { profile: signal(profile), profilePictureUrl, profilePictureDecodeFailed, signOut },
        },
        {
          provide: Theming,
          useValue: { scheme: signal('system'), persistenceNotice: signal(null), setScheme: vi.fn() },
        },
      ],
    });

    const fixture = TestBed.createComponent(User);
    fixture.detectChanges();

    return {
      fixture,
      signOut,
      profilePictureUrl,
      text: () => (fixture.nativeElement as HTMLElement).textContent ?? '',
    };
  }

  it('shows the signed-in name and email from the session, not a placeholder', () => {
    const { text } = setup();

    expect(text()).toContain('Ada Lovelace');
    expect(text()).toContain('ada@example.com');
  });

  it('shows a saved Profile picture and falls back to the person icon after a decode failure', () => {
    const { fixture, profilePictureUrl } = setup();
    profilePictureUrl.set('blob:saved-profile-picture');
    fixture.detectChanges();

    const screen = fixture.nativeElement as HTMLElement;
    const picture = screen.querySelector<HTMLImageElement>('img');
    expect(picture?.getAttribute('src')).toBe('blob:saved-profile-picture');
    expect(picture?.getAttribute('alt')).toBe('');
    expect(picture?.classList.contains('object-cover')).toBe(true);

    picture?.dispatchEvent(new Event('error'));
    fixture.detectChanges();

    expect(screen.querySelector('img')).toBeNull();
    expect(screen.querySelector('mat-icon[svgIcon="user-round"]')).not.toBeNull();
  });

  it('offers Profile before Appearance in the signed-in menu', async () => {
    const { fixture } = setup();

    (fixture.nativeElement as HTMLElement).querySelector('button')?.click();
    await fixture.whenStable();

    const text = overlay().textContent ?? '';
    const profileIndex = text.indexOf('Profile');
    const appearanceIndex = text.indexOf('Appearance');

    expect(profileIndex).toBeGreaterThanOrEqual(0);
    expect(appearanceIndex).toBeGreaterThanOrEqual(0);
    expect(profileIndex).toBeLessThan(appearanceIndex);
  });

  it('signs out through the session rather than just linking to sign-in', async () => {
    const { fixture, signOut } = setup();

    (fixture.nativeElement as HTMLElement).querySelector('button')?.click();
    await fixture.whenStable();
    const button = Array.from(overlay().querySelectorAll('button')).find(
      (candidate) => candidate.textContent?.trim() === 'Sign out',
    );
    if (!button) {
      throw new Error('No Sign out button');
    }
    button.click();

    expect(signOut).toHaveBeenCalledTimes(1);
  });
});
