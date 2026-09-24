import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { AuthService, EmailChangeAddressTakenError, EmailChangeLinkInvalidError, Profile } from '@/app/core/auth';
import { provideIcons } from '@/app/core/icons';
import { Session } from '@/app/core/session';
import AuthConfirmEmailChange from './confirm-email-change';

describe('AuthConfirmEmailChange', () => {
  function setup(
    params: Record<string, string>,
    confirmEmailChange: AuthService['confirmEmailChange'] = () => of(undefined),
    session: Partial<Session> = {},
    me?: AuthService['me'],
  ) {
    const navigate = vi.fn(() => Promise.resolve(true));
    const navigateByUrl = vi.fn(() => Promise.resolve(true));
    const signOut = vi.fn();
    const expire = vi.fn();
    TestBed.configureTestingModule({
      imports: [AuthConfirmEmailChange],
      providers: [
        provideIcons(),
        { provide: AuthService, useValue: { confirmEmailChange, me: me ?? (() => of(undefined)) } },
        {
          provide: Session,
          useValue: { isAuthenticated: () => false, profile: () => null, signOut, expire, ...session },
        },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(params) } } },
        { provide: Router, useValue: { navigate, navigateByUrl } },
      ],
    });
    const fixture = TestBed.createComponent(AuthConfirmEmailChange);
    fixture.detectChanges();
    return { fixture, navigate, navigateByUrl, signOut, expire };
  }

  it('does not spend a valid link until Confirm change is chosen', () => {
    const confirmEmailChange = vi.fn(() => of(undefined));
    setup({ userId: '7', token: 'a-token' }, confirmEmailChange);

    expect(confirmEmailChange).not.toHaveBeenCalled();
  });

  it('announces a pending confirmation and prevents duplicate submissions', async () => {
    const response = new Subject<void>();
    const confirmEmailChange = vi.fn(() => response.asObservable());
    const { fixture } = setup({ userId: '7', token: 'a-token' }, confirmEmailChange);
    const screen = fixture.nativeElement as HTMLElement;

    button(screen, 'Confirm change').click();
    fixture.detectChanges();

    expect(confirmEmailChange).toHaveBeenCalledOnce();
    expect(button(screen, 'Confirming…').disabled).toBe(true);
    expect(button(screen, 'Not now').disabled).toBe(true);
    expect(screen.querySelector('[role="status"]')?.textContent).toContain('Confirming email change');

    button(screen, 'Confirming…').click();
    expect(confirmEmailChange).toHaveBeenCalledOnce();

    response.next();
    response.complete();
    await fixture.whenStable();
  });

  it('shows recovery without sending malformed user identifiers to the API', async () => {
    const confirmEmailChange = vi.fn(() => of(undefined));
    const { fixture } = setup({ userId: '0', token: 'a-token' }, confirmEmailChange);
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('This email change link is no longer valid');
    expect(button(fixture.nativeElement as HTMLElement, 'Sign in')).toBeTruthy();
    expect(confirmEmailChange).not.toHaveBeenCalled();
  });

  it('focuses the page heading on entry and the recovery heading after an invalid link', async () => {
    const { fixture } = setup({ userId: '7', token: 'a-token' }, () =>
      throwError(() => new EmailChangeLinkInvalidError()),
    );
    const screen = fixture.nativeElement as HTMLElement;

    await fixture.whenStable();
    expect(document.activeElement).toBe(screen.querySelector('h1'));

    button(screen, 'Confirm change').click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(document.activeElement).toBe(screen.querySelector('h1'));
  });

  it('keeps the pending email change in place when a signed-out person chooses Not now', async () => {
    const confirmEmailChange = vi.fn(() => of(undefined));
    const { fixture, navigate } = setup({ userId: '7', token: 'a-token' }, confirmEmailChange);
    const screen = fixture.nativeElement as HTMLElement;

    expect(screen.textContent).toContain('Your current email stays in place until you confirm.');
    expect(screen.textContent).toContain('Choosing Not now leaves the pending email change in place.');

    button(screen, 'Not now').click();
    await fixture.whenStable();

    expect(confirmEmailChange).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(['/auth/sign-in']);
  });

  it('returns a signed-in person to their Profile without spending the email-change link', async () => {
    const confirmEmailChange = vi.fn(() => of(undefined));
    const profile: Profile = {
      id: 7,
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      pendingEmail: 'new@example.com',
    };
    const { fixture, navigateByUrl } = setup({ userId: '7', token: 'a-token' }, confirmEmailChange, {
      isAuthenticated: signal(true),
      profile: signal<Profile | null>(profile),
    });

    button(fixture.nativeElement as HTMLElement, 'Not now').click();
    await fixture.whenStable();

    expect(confirmEmailChange).not.toHaveBeenCalled();
    expect(navigateByUrl).toHaveBeenCalledWith('/app/profile');
  });

  it('redeems once and sends a signed-out person to sign-in with the changed-address acknowledgement', async () => {
    const confirmEmailChange = vi.fn(() => of(undefined));
    const { fixture, navigate } = setup({ userId: '7', token: 'a-token' }, confirmEmailChange);

    button(fixture.nativeElement as HTMLElement, 'Confirm change').click();
    await fixture.whenStable();

    expect(confirmEmailChange).toHaveBeenCalledWith(7, 'a-token');
    expect(navigate).toHaveBeenCalledWith(['/auth/sign-in'], { queryParams: { reason: 'email-changed' } });
  });

  it('keeps another signed-in Profile intact after confirming the linked Profile email change', async () => {
    const otherProfile: Profile = {
      id: 9,
      name: 'Other Profile',
      email: 'other@example.com',
      pendingEmail: null,
    };
    const signedInProfile = signal<Profile | null>(otherProfile);
    const applyProfileUpdate = vi.fn((profile: Profile) => signedInProfile.set(profile));
    const me = vi.fn(() => of(otherProfile));
    const { fixture, navigateByUrl, signOut } = setup(
      { userId: '7', token: 'a-token' },
      undefined,
      { isAuthenticated: signal(true), profile: signedInProfile, applyProfileUpdate },
      me,
    );
    const screen = fixture.nativeElement as HTMLElement;

    button(screen, 'Confirm change').click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(screen.textContent).toContain('Email change confirmed for the linked Profile.');
    expect(screen.textContent).toContain('This session remains signed in to a different Profile;');
    expect(me).not.toHaveBeenCalled();
    expect(applyProfileUpdate).not.toHaveBeenCalled();
    expect(signedInProfile()).toEqual(otherProfile);
    expect(signOut).not.toHaveBeenCalled();
    expect(button(screen, 'Go to Profile')).toBeTruthy();

    button(screen, 'Go to Profile').click();
    await fixture.whenStable();
    expect(navigateByUrl).toHaveBeenCalledWith('/app/profile');
  });

  it('refreshes the matching Profile after confirmation so the pending email is replaced', async () => {
    const pendingProfile: Profile = {
      id: 7,
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      pendingEmail: 'new@example.com',
    };
    const changedProfile: Profile = {
      ...pendingProfile,
      email: 'new@example.com',
      pendingEmail: null,
    };
    const signedInProfile = signal<Profile | null>(pendingProfile);
    const applyProfileUpdate = vi.fn((profile: Profile) => signedInProfile.set(profile));
    const me = vi.fn(() => of(changedProfile));
    const { fixture, navigateByUrl } = setup(
      { userId: '7', token: 'a-token' },
      undefined,
      { isAuthenticated: signal(true), profile: signedInProfile, applyProfileUpdate },
      me,
    );

    button(fixture.nativeElement as HTMLElement, 'Confirm change').click();
    await fixture.whenStable();

    expect(me).toHaveBeenCalledOnce();
    expect(applyProfileUpdate).toHaveBeenCalledWith(changedProfile);
    expect(signedInProfile()).toEqual(changedProfile);
    expect(navigateByUrl).toHaveBeenCalledWith('/app/profile', { state: { emailChangeConfirmed: true } });
  });

  it('announces the successful confirmation while the current Profile is being refreshed', async () => {
    const pendingProfile: Profile = {
      id: 7,
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      pendingEmail: 'new@example.com',
    };
    const changedProfile: Profile = {
      ...pendingProfile,
      email: 'new@example.com',
      pendingEmail: null,
    };
    const signedInProfile = signal<Profile | null>(pendingProfile);
    const applyProfileUpdate = vi.fn((profile: Profile) => signedInProfile.set(profile));
    const refresh = new Subject<Profile>();
    const { fixture, navigateByUrl } = setup(
      { userId: '7', token: 'a-token' },
      () => of(undefined),
      { isAuthenticated: signal(true), profile: signedInProfile, applyProfileUpdate },
      () => refresh.asObservable(),
    );
    const screen = fixture.nativeElement as HTMLElement;

    button(screen, 'Confirm change').click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(screen.querySelector('[role="status"]')?.textContent).toContain('Refreshing Profile');
    expect(screen.textContent).toContain('Email change confirmed');

    refresh.next(changedProfile);
    refresh.complete();
    await fixture.whenStable();

    expect(signedInProfile()).toEqual(changedProfile);
    expect(navigateByUrl).toHaveBeenCalledWith('/app/profile', { state: { emailChangeConfirmed: true } });
  });

  it('expires the current session when the refreshed Profile request is unauthorized', async () => {
    const pendingProfile: Profile = {
      id: 7,
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      pendingEmail: 'new@example.com',
    };
    const applyProfileUpdate = vi.fn();
    const { fixture, expire } = setup(
      { userId: '7', token: 'a-token' },
      undefined,
      {
        isAuthenticated: signal(true),
        profile: signal<Profile | null>(pendingProfile),
        applyProfileUpdate,
      },
      () => throwError(() => new ApiError('Session ended', 401)),
    );

    button(fixture.nativeElement as HTMLElement, 'Confirm change').click();
    await fixture.whenStable();

    expect(expire).toHaveBeenCalledOnce();
    expect(applyProfileUpdate).not.toHaveBeenCalled();
  });

  it('retries the Profile read without confirming the link again or starting parallel refreshes', async () => {
    const pendingProfile: Profile = {
      id: 7,
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      pendingEmail: 'new@example.com',
    };
    const changedProfile: Profile = {
      ...pendingProfile,
      email: 'new@example.com',
      pendingEmail: null,
    };
    const signedInProfile = signal<Profile | null>(pendingProfile);
    const applyProfileUpdate = vi.fn((profile: Profile) => signedInProfile.set(profile));
    const refresh = new Subject<Profile>();
    let reads = 0;
    const me = vi.fn(() => {
      reads += 1;
      return reads === 1 ? throwError(() => new Error('offline')) : refresh.asObservable();
    });
    const confirmEmailChange = vi.fn(() => of(undefined));
    const { fixture, navigateByUrl } = setup(
      { userId: '7', token: 'a-token' },
      confirmEmailChange,
      { isAuthenticated: signal(true), profile: signedInProfile, applyProfileUpdate },
      me,
    );
    const screen = fixture.nativeElement as HTMLElement;

    button(screen, 'Confirm change').click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(screen.textContent).toContain("Your email address changed, but your Profile couldn't be refreshed.");

    button(screen, 'Retry Profile refresh').click();
    fixture.detectChanges();
    const refreshingButton = button(screen, 'Refreshing Profile…');
    expect(refreshingButton.disabled).toBe(true);
    refreshingButton.click();
    fixture.detectChanges();

    refresh.next(changedProfile);
    refresh.complete();
    await fixture.whenStable();

    expect(confirmEmailChange).toHaveBeenCalledOnce();
    expect(me).toHaveBeenCalledTimes(2);
    expect(navigateByUrl).toHaveBeenCalledWith('/app/profile', { state: { emailChangeConfirmed: true } });
  });

  it('shows the truthful invalid-link recovery', async () => {
    const { fixture } = setup({ userId: '7', token: 'a-token' }, () =>
      throwError(() => new EmailChangeLinkInvalidError()),
    );
    button(fixture.nativeElement as HTMLElement, 'Confirm change').click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('link is no longer valid');
  });

  it('shows the distinct address-taken recovery', async () => {
    const { fixture } = setup({ userId: '7', token: 'a-token' }, () =>
      throwError(() => new EmailChangeAddressTakenError()),
    );
    button(fixture.nativeElement as HTMLElement, 'Confirm change').click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('no longer available');
    expect(button(fixture.nativeElement as HTMLElement, 'Sign in')).toBeTruthy();
  });

  it('offers another address from Profile when the signed-in Profile owns the pending change', async () => {
    const profile: Profile = {
      id: 7,
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      pendingEmail: 'new@example.com',
    };
    const signedInProfile = signal<Profile | null>(profile);
    const { fixture, navigateByUrl } = setup(
      { userId: '7', token: 'a-token' },
      () => throwError(() => new EmailChangeAddressTakenError()),
      { isAuthenticated: signal(true), profile: signedInProfile },
    );

    button(fixture.nativeElement as HTMLElement, 'Confirm change').click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('This email address is no longer available');
    expect(button(fixture.nativeElement as HTMLElement, 'Choose another address')).toBeTruthy();
    expect(signedInProfile()?.pendingEmail).toBe('new@example.com');

    button(fixture.nativeElement as HTMLElement, 'Choose another address').click();
    await fixture.whenStable();
    expect(navigateByUrl).toHaveBeenCalledWith('/app/profile');
  });

  it('offers an explicit sign-out when an unavailable address belongs to another Profile', async () => {
    const profile: Profile = {
      id: 9,
      name: 'Other Profile',
      email: 'other@example.com',
      pendingEmail: null,
    };
    const { fixture, signOut } = setup(
      { userId: '7', token: 'a-token' },
      () => throwError(() => new EmailChangeAddressTakenError()),
      { isAuthenticated: signal(true), profile: signal<Profile | null>(profile) },
    );

    button(fixture.nativeElement as HTMLElement, 'Confirm change').click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('This pending change belongs to a different Profile.');
    button(fixture.nativeElement as HTMLElement, 'Sign out and sign in').click();
    expect(signOut).toHaveBeenCalledOnce();
  });
});

function button(element: HTMLElement, label: string): HTMLButtonElement {
  const found = Array.from(element.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!found) {
    throw new Error(`No button labelled ${label}`);
  }
  return found;
}
