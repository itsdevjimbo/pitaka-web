import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { AuthService, Profile } from '@/app/core/auth';
import { provideIcons } from '@/app/core/icons';
import { Session } from '@/app/core/session';
import { ProfileEmail } from './profile-email';

const ADA: Profile = {
  id: 7,
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  pendingEmail: null,
};

describe('ProfileEmail', () => {
  function click(fixture: { nativeElement: HTMLElement }, label: string) {
    const button = Array.from(fixture.nativeElement.querySelectorAll('button')).find(
      (candidate) => candidate.textContent?.trim() === label,
    );
    if (!button) throw new Error(`No button labelled "${label}"`);
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
  });
});
