import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { provideRouter } from '@angular/router';
import { provideIcons } from '@/app/core/icons';
import { LocalStorage } from '@/app/core/local-storage';
import { Media } from '@/app/core/media';
import { Session } from '@/app/core/session';
import { THEME_CONFIG, Theming } from '@/app/core/theming';
import { AppLayout } from './layout';

describe('AppLayout', () => {
  it('shows the saved user-menu picture in both phone and desktop shells', () => {
    const isMobile = signal(true);
    const storage = { getItem: vi.fn(() => null), setItem: vi.fn() };
    TestBed.configureTestingModule({
      imports: [AppLayout],
      providers: [
        provideRouter([]),
        provideIcons(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        { provide: Media, useValue: { match: () => isMobile.asReadonly() } },
        { provide: LocalStorage, useValue: storage },
        { provide: THEME_CONFIG, useValue: { scheme: 'system', primary: '#304BC6', error: '#B91C1C' } },
        {
          provide: Session,
          useValue: {
            profile: signal({
              id: 7,
              name: 'Ada Lovelace',
              email: 'ada@example.com',
              pendingEmail: null,
              hasPicture: true,
            }),
            profilePictureUrl: signal('blob:saved-profile-picture'),
            profilePictureDecodeFailed: vi.fn(),
          },
        },
      ],
    });

    const fixture = TestBed.createComponent(AppLayout);
    const theming = TestBed.inject(Theming);
    fixture.detectChanges();
    const screen = fixture.nativeElement as HTMLElement;

    for (const { mobile, scheme, className } of [
      { mobile: true, scheme: 'light' as const, className: 'scheme-light' },
      { mobile: false, scheme: 'dark' as const, className: 'scheme-dark' },
    ]) {
      isMobile.set(mobile);
      theming.setScheme(scheme);
      TestBed.flushEffects();
      fixture.detectChanges();

      const avatars = screen.querySelectorAll('user profile-picture-avatar[appearance="user-menu"]');
      const image = avatars[0]?.querySelector<HTMLImageElement>('img');
      expect(avatars).toHaveLength(1);
      expect(image?.getAttribute('src')).toBe('blob:saved-profile-picture');
      expect(image?.getAttribute('alt')).toBe('');
      expect(image?.className).toContain('object-cover');
      expect(image?.className).toContain('bg-soft');
      expect(image?.className).toContain('rounded-lg');
      expect(document.documentElement.classList).toContain(className);
    }
  });

  afterEach(() => {
    document.documentElement.classList.remove('scheme-dark', 'scheme-light');
    document.head.querySelectorAll('.theme-colors').forEach((style) => style.remove());
  });
});
