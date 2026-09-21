import { TestBed } from '@angular/core/testing';
import { LocalStorage } from '@/app/core/local-storage';
import { Media } from '@/app/core/media';
import { FakeMedia } from '@/testing/media';
import { THEME_CONFIG } from './provider';
import { Theming } from './theming';

type FakeStorage = {
  getItem: ReturnType<typeof vi.fn>;
  setItem: ReturnType<typeof vi.fn>;
};

describe('Theming', () => {
  function setup({ stored = null, dark = false }: { stored?: string | null; dark?: boolean } = {}) {
    const storage: FakeStorage = {
      getItem: vi.fn(() => stored),
      setItem: vi.fn(),
    };
    const media = new FakeMedia(dark);

    TestBed.configureTestingModule({
      providers: [
        { provide: LocalStorage, useValue: storage },
        { provide: Media, useValue: media },
        { provide: THEME_CONFIG, useValue: { scheme: 'system', primary: '#304BC6', error: '#B91C1C' } },
      ],
    });

    return { media, storage, theming: TestBed.inject(Theming) };
  }

  afterEach(() => {
    document.documentElement.classList.remove('scheme-dark', 'scheme-light');
  });

  it('uses System for a missing or invalid saved preference and follows the OS live', () => {
    const { media, storage, theming } = setup({ stored: 'sepia', dark: true });

    TestBed.flushEffects();
    expect(theming.scheme()).toBe('system');
    expect(theming.isDark()).toBe(true);
    expect(document.documentElement.classList).toContain('scheme-dark');
    expect(storage.setItem).not.toHaveBeenCalled();

    media.matches.set(false);
    TestBed.flushEffects();
    expect(theming.scheme()).toBe('system');
    expect(theming.isLight()).toBe(true);
    expect(document.documentElement.classList).toContain('scheme-light');
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('keeps a fixed override when the OS changes', () => {
    const { media, theming } = setup({ stored: 'light', dark: false });

    theming.setScheme('dark');
    media.matches.set(false);
    TestBed.flushEffects();

    expect(theming.scheme()).toBe('dark');
    expect(theming.isDark()).toBe(true);
  });

  it('applies a manual choice in this tab and exposes the agreed notice when saving fails', () => {
    const { storage, theming } = setup();
    storage.setItem.mockImplementation(() => {
      throw new DOMException('blocked');
    });

    theming.setScheme('dark');
    TestBed.flushEffects();

    expect(theming.scheme()).toBe('dark');
    expect(theming.persistenceNotice()).toBe('Applies in this tab; couldn’t save');
  });

  it('adopts a valid preference from another tab without writing it back', () => {
    const { storage, theming } = setup({ stored: 'light' });

    window.dispatchEvent(new StorageEvent('storage', { key: 'scheme', newValue: 'dark' }));
    TestBed.flushEffects();

    expect(theming.scheme()).toBe('dark');
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('returns to System when another tab removes or corrupts the saved preference', () => {
    const { theming } = setup({ stored: 'dark' });

    window.dispatchEvent(new StorageEvent('storage', { key: 'scheme', newValue: null }));
    expect(theming.scheme()).toBe('system');

    window.dispatchEvent(new StorageEvent('storage', { key: 'scheme', newValue: 'sepia' }));
    expect(theming.scheme()).toBe('system');
  });
});
