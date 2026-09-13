import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { AuthService, Profile } from '@/app/core/auth';
import { provideIcons } from '@/app/core/icons';
import { Session } from '@/app/core/session';
import { ProfileEmail } from './profile-email';

type ProfileEmailInternals = {
  model: ReturnType<typeof signal<{ newEmail: string; currentPassword: string }>>;
  beginRequest(): void;
  send(event: Event): void;
  successMessage: () => string | null;
};

const ADA: Profile = {
  id: 7,
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  pendingEmail: null,
};

describe('ProfileEmail', () => {
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
    expect(document.activeElement).toBe(
      fixture.nativeElement.querySelector('#new-email-address')
    );
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
    const cmp = fixture.componentInstance as unknown as ProfileEmailInternals;
    fixture.detectChanges();

    cmp.beginRequest();
    cmp.model.set({ newEmail: ' new@example.com ', currentPassword: 'secret12' });
    cmp.send(new Event('submit'));
    await fixture.whenStable();
    await fixture.whenStable();

    expect(requestEmailChange).toHaveBeenCalledWith('new@example.com', 'secret12');
    expect(applyProfileUpdate).toHaveBeenCalledWith(refreshed);
    expect(cmp.successMessage()).toBe('Confirmation email sent to new@example.com');
  });

  it('keeps an address-in-use conflict distinct and attached to the new address', async () => {
    TestBed.configureTestingModule({
      imports: [ProfileEmail],
      providers: [
        provideIcons(),
        {
          provide: AuthService,
          useValue: {
            requestEmailChange: () =>
              throwError(() => new ApiError('Conflict', 409)),
            me: () => of(ADA),
          },
        },
        { provide: Session, useValue: { profile: signal(ADA), applyProfileUpdate: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(ProfileEmail);
    const cmp = fixture.componentInstance as unknown as ProfileEmailInternals;
    fixture.detectChanges();

    cmp.beginRequest();
    cmp.model.set({ newEmail: 'taken@example.com', currentPassword: 'secret12' });
    cmp.send(new Event('submit'));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'That email address is already in use. Choose a different address.'
    );
  });
});
