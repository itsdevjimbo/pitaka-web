import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { provideRouter } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { AuthService, Profile } from '@/app/core/auth';
import { provideDialogDefaults } from '@/app/core/dialog';
import { provideIcons } from '@/app/core/icons';
import { Session } from '@/app/core/session';
import { withOverlayContainer } from '@/testing/overlay';
import { ProfileEmail } from './profile-email';

const ADA: Profile = {
  id: 7,
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  pendingEmail: null,
  hasPicture: false,
};

describe('ProfileEmail', () => {
  const overlay = withOverlayContainer();

  function click(fixture: { nativeElement: HTMLElement }, label: string) {
    const button = Array.from(fixture.nativeElement.querySelectorAll('button')).find(
      (candidate) => candidate.textContent?.trim() === label,
    );
    if (!button) {
      throw new Error(`No button labelled "${label}"`);
    }
    button.click();
  }

  function enter(fixture: { nativeElement: HTMLElement }, selector: string, value: string) {
    const input = fixture.nativeElement.querySelector(selector) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  async function submit(fixture: {
    nativeElement: HTMLElement;
    whenStable: () => Promise<unknown>;
    detectChanges: () => void;
  }) {
    fixture.nativeElement.querySelector('form')?.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('opens a password-gated editor focused on the new address', async () => {
    TestBed.configureTestingModule({
      imports: [ProfileEmail],
      providers: [
        provideIcons(),
        {
          provide: AuthService,
          useValue: { requestEmailChange: () => of(undefined), me: () => of(ADA) },
        },
        { provide: Session, useValue: { profile: signal(ADA), applyProfileUpdate: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(ProfileEmail);
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('New email address');
    expect(document.activeElement).toBe(fixture.nativeElement.querySelector('#new-email-address'));
  });

  it('keeps invalid Submit enabled and focuses the first email error', async () => {
    TestBed.configureTestingModule({
      imports: [ProfileEmail],
      providers: [
        provideIcons(),
        provideRouter([]),
        provideDialogDefaults(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        {
          provide: AuthService,
          useValue: { requestEmailChange: () => of(undefined), me: () => of(ADA) },
        },
        { provide: Session, useValue: { profile: signal(ADA), applyProfileUpdate: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(ProfileEmail);
    fixture.detectChanges();
    click(fixture, 'Change email');
    fixture.detectChanges();

    const submitButton = fixture.nativeElement.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(submitButton.disabled).toBe(false);
    await submit(fixture);

    expect(fixture.nativeElement.textContent).toContain('Enter an email address');
    expect(document.activeElement).toBe(fixture.nativeElement.querySelector('#new-email-address'));
  });

  it('reconciles the no-content request from the live Profile read', async () => {
    const requestEmailChange = vi.fn(() => of(undefined));
    const refreshed = { ...ADA, pendingEmail: 'new@example.com' };
    const applyProfileUpdate = vi.fn();
    TestBed.configureTestingModule({
      imports: [ProfileEmail],
      providers: [
        provideIcons(),
        { provide: AuthService, useValue: { requestEmailChange, me: () => of(refreshed) } },
        { provide: Session, useValue: { profile: signal(ADA), applyProfileUpdate } },
      ],
    });
    const fixture = TestBed.createComponent(ProfileEmail);
    fixture.detectChanges();

    click(fixture, 'Change email');
    fixture.detectChanges();
    enter(fixture, '#new-email-address', ' new@example.com ');
    enter(fixture, 'input[type="password"]', 'secret12');
    await submit(fixture);

    expect(requestEmailChange).toHaveBeenCalledWith('new@example.com', 'secret12');
    expect(applyProfileUpdate).toHaveBeenCalledWith(refreshed);
    expect(fixture.nativeElement.textContent).toContain('Confirmation email sent to new@example.com');
  });

  it('explains which email remains current while a change awaits confirmation', () => {
    const profile = { ...ADA, pendingEmail: 'new@example.com' };
    TestBed.configureTestingModule({
      imports: [ProfileEmail],
      providers: [
        provideIcons(),
        {
          provide: AuthService,
          useValue: { requestEmailChange: () => of(undefined), me: () => of(profile) },
        },
        { provide: Session, useValue: { profile: signal(profile), applyProfileUpdate: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(ProfileEmail);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Pending email change');
    expect(text).toContain('ada@example.com remains your current email address until you confirm new@example.com.');
    expect(text).toContain('Send another link');
    expect(text).toContain('Choose another address');
    expect(text).toContain('Cancel email change');
  });

  it('requires an explicit confirmation before cancelling a pending email change', async () => {
    const pending = { ...ADA, pendingEmail: 'new@example.com' };
    const profile = signal<Profile>(pending);
    const refreshed = { ...ADA, pendingEmail: null };
    const cancelEmailChange = vi.fn(() => of(undefined));
    const applyProfileUpdate = vi.fn((updated: Profile) => profile.set(updated));
    TestBed.configureTestingModule({
      imports: [ProfileEmail],
      providers: [
        provideIcons(),
        {
          provide: AuthService,
          useValue: { cancelEmailChange, me: () => of(refreshed) },
        },
        { provide: Session, useValue: { profile, applyProfileUpdate } },
      ],
    });
    const fixture = TestBed.createComponent(ProfileEmail);
    fixture.detectChanges();

    click(fixture, 'Cancel email change');
    fixture.detectChanges();
    await fixture.whenStable();

    const prompt = fixture.nativeElement.querySelector('[role="alertdialog"]');
    expect(prompt?.textContent).toContain('Cancel email change to new@example.com?');
    expect(prompt?.textContent).toContain('The confirmation link will stop working.');
    expect(document.activeElement?.textContent).toContain('Keep change');
    expect(cancelEmailChange).not.toHaveBeenCalled();

    click(fixture, 'Cancel email change');
    await fixture.whenStable();
    fixture.detectChanges();

    expect(cancelEmailChange).toHaveBeenCalledOnce();
    expect(applyProfileUpdate).toHaveBeenCalledWith(refreshed);
    expect(fixture.nativeElement.textContent).toContain('Email change cancelled');
    expect(fixture.nativeElement.textContent).not.toContain('Pending email change');
  });

  it('replaces the pending address only after requesting a link for the new address', async () => {
    const pending = { ...ADA, pendingEmail: 'old-pending@example.com' };
    const profile = signal<Profile>(pending);
    const replacement = { ...ADA, pendingEmail: 'replacement@example.com' };
    const requestEmailChange = vi.fn(() => of(undefined));
    const applyProfileUpdate = vi.fn((updated: Profile) => profile.set(updated));
    TestBed.configureTestingModule({
      imports: [ProfileEmail],
      providers: [
        provideIcons(),
        {
          provide: AuthService,
          useValue: { requestEmailChange, me: () => of(replacement) },
        },
        { provide: Session, useValue: { profile, applyProfileUpdate } },
      ],
    });
    const fixture = TestBed.createComponent(ProfileEmail);
    fixture.detectChanges();

    click(fixture, 'Choose another address');
    fixture.detectChanges();
    enter(fixture, '#new-email-address', 'replacement@example.com');
    enter(fixture, 'input[type="password"]', 'secret12');
    await submit(fixture);

    expect(requestEmailChange).toHaveBeenCalledWith('replacement@example.com', 'secret12');
    expect(applyProfileUpdate).toHaveBeenCalledWith(replacement);
    expect(fixture.nativeElement.textContent).toContain('Confirmation email sent to replacement@example.com');
    expect(fixture.nativeElement.textContent).toContain('Pending email change');
  });

  it('resends a confirmation link to the pending address after the current password is entered', async () => {
    const pending = { ...ADA, pendingEmail: 'new@example.com' };
    const requestEmailChange = vi.fn(() => of(undefined));
    TestBed.configureTestingModule({
      imports: [ProfileEmail],
      providers: [
        provideIcons(),
        {
          provide: AuthService,
          useValue: { requestEmailChange, me: () => of(pending) },
        },
        { provide: Session, useValue: { profile: signal(pending), applyProfileUpdate: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(ProfileEmail);
    fixture.detectChanges();

    click(fixture, 'Send another link');
    fixture.detectChanges();
    enter(fixture, 'input[type="password"]', 'secret12');
    await submit(fixture);

    expect(requestEmailChange).toHaveBeenCalledWith('new@example.com', 'secret12');
    expect(fixture.nativeElement.textContent).toContain('Another confirmation email sent to new@example.com');
    expect(fixture.nativeElement.textContent).toContain('Pending email change');
  });

  it('retries only the Profile read after a successful request and keeps retry singular while pending', async () => {
    const profile = signal<Profile>(ADA);
    const refreshed = { ...ADA, pendingEmail: 'new@example.com' };
    const pendingRead = new Subject<Profile>();
    let readCount = 0;
    const me = vi.fn(() => {
      readCount += 1;
      return readCount === 1 ? throwError(() => new Error('network')) : pendingRead.asObservable();
    });
    const requestEmailChange = vi.fn(() => of(undefined));
    const applyProfileUpdate = vi.fn((updated: Profile) => profile.set(updated));
    TestBed.configureTestingModule({
      imports: [ProfileEmail],
      providers: [
        provideIcons(),
        { provide: AuthService, useValue: { requestEmailChange, me } },
        { provide: Session, useValue: { profile, applyProfileUpdate } },
      ],
    });
    const fixture = TestBed.createComponent(ProfileEmail);
    fixture.detectChanges();

    click(fixture, 'Change email');
    fixture.detectChanges();
    enter(fixture, '#new-email-address', 'new@example.com');
    enter(fixture, 'input[type="password"]', 'secret12');
    await submit(fixture);
    expect(fixture.nativeElement.textContent).toContain("Profile couldn't be refreshed");

    const retryButton = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Retry refresh',
    ) as HTMLButtonElement;
    retryButton.click();
    fixture.detectChanges();

    expect(me).toHaveBeenCalledTimes(2);
    expect(retryButton.disabled).toBe(true);
    retryButton.click();
    expect(me).toHaveBeenCalledTimes(2);

    pendingRead.next(refreshed);
    pendingRead.complete();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(requestEmailChange).toHaveBeenCalledOnce();
    expect(applyProfileUpdate).toHaveBeenCalledWith(refreshed);
    expect(fixture.nativeElement.textContent).not.toContain("Profile couldn't be refreshed");
    expect(fixture.nativeElement.textContent).toContain('Pending email change');
  });

  it('keeps an address-in-use conflict distinct and attached to the new address', async () => {
    TestBed.configureTestingModule({
      imports: [ProfileEmail],
      providers: [
        provideIcons(),
        {
          provide: AuthService,
          useValue: {
            requestEmailChange: () => throwError(() => new ApiError('Conflict', 409)),
            me: () => of(ADA),
          },
        },
        { provide: Session, useValue: { profile: signal(ADA), applyProfileUpdate: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(ProfileEmail);
    fixture.detectChanges();

    click(fixture, 'Change email');
    fixture.detectChanges();
    enter(fixture, '#new-email-address', 'taken@example.com');
    enter(fixture, 'input[type="password"]', 'secret12');
    await submit(fixture);

    expect(fixture.nativeElement.textContent).toContain(
      'That email address is already in use. Choose a different address.',
    );
    expect((fixture.nativeElement.querySelector('#new-email-address') as HTMLInputElement).value).toBe(
      'taken@example.com',
    );
    expect((fixture.nativeElement.querySelector('input[type="password"]') as HTMLInputElement).value).toBe('secret12');
  });

  it('asks before discarding an email request and keeps the draft when requested', async () => {
    TestBed.configureTestingModule({
      imports: [ProfileEmail],
      providers: [
        provideIcons(),
        provideRouter([]),
        provideDialogDefaults(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        {
          provide: AuthService,
          useValue: { requestEmailChange: () => of(undefined), me: () => of(ADA) },
        },
        { provide: Session, useValue: { profile: signal(ADA), applyProfileUpdate: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(ProfileEmail);
    fixture.detectChanges();

    click(fixture, 'Change email');
    fixture.detectChanges();
    enter(fixture, '#new-email-address', 'new@example.com');
    click(fixture, 'Cancel');
    await fixture.whenStable();

    expect(overlay().querySelector('[role="alertdialog"]')?.textContent).toContain('Discard changes?');
    const keepEditing = Array.from(overlay().querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.trim() === 'Keep editing',
    );
    if (!keepEditing) {
      throw new Error('No Keep editing button');
    }
    keepEditing.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('#new-email-address')?.value).toBe('new@example.com');
  });
});
