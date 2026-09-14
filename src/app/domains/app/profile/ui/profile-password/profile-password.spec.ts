import { WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FieldTree } from '@angular/forms/signals';
import { of, throwError } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { AuthService, IncorrectCurrentPasswordError } from '@/app/core/auth';
import { provideIcons } from '@/app/core/icons';
import { ProfilePassword } from './profile-password';

type ProfilePasswordInternals = {
  model: WritableSignal<{
    currentPassword: string;
    newPassword: string;
    confirmationPassword: string;
  }>;
  passwordForm: {
    currentPassword: FieldTree<string>;
    newPassword: FieldTree<string>;
    confirmationPassword: FieldTree<string>;
  };
  begin(): void;
  send(event: Event): void;
  successMessage: () => string | null;
};

describe('ProfilePassword', () => {
  function setup(changePassword: AuthService['changePassword']) {
    TestBed.configureTestingModule({
      imports: [ProfilePassword],
      providers: [
        provideIcons(),
        { provide: AuthService, useValue: { changePassword } },
      ],
    });
    const fixture = TestBed.createComponent(ProfilePassword);
    const cmp = fixture.componentInstance as unknown as ProfilePasswordInternals;
    fixture.detectChanges();
    return { fixture, cmp };
  }

  async function submitAndSettle(
    fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void },
    cmp: ProfilePasswordInternals
  ) {
    cmp.send(new Event('submit'));
    await fixture.whenStable();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('opens the inline editor focused on the current password', async () => {
    const { fixture } = setup(() => of(undefined));

    (fixture.nativeElement.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('Current password');
    expect(document.activeElement).toBe(
      fixture.nativeElement.querySelector('#current-password')
    );
  });

  it('does not submit a mismatched or too-short new password', async () => {
    const changePassword = vi.fn(() => of(undefined));
    const { fixture, cmp } = setup(changePassword);
    cmp.begin();
    cmp.model.set({
      currentPassword: 'current-password',
      newPassword: 'short12',
      confirmationPassword: 'different-password',
    });
    fixture.detectChanges();

    await submitAndSettle(fixture, cmp);

    expect(changePassword).not.toHaveBeenCalled();
    expect(cmp.passwordForm.newPassword().errors().map((error) => error.message)).toContain(
      'Your password must be at least 8 characters'
    );
    expect(cmp.passwordForm.confirmationPassword().errors().map((error) => error.message)).toContain(
      'Passwords do not match'
    );
  });

  it('changes the password, clears every secret, and leaves persistent success feedback', async () => {
    const changePassword = vi.fn(() => of(undefined));
    const { fixture, cmp } = setup(changePassword);
    cmp.begin();
    cmp.model.set({
      currentPassword: 'current-password',
      newPassword: 'new-password',
      confirmationPassword: 'new-password',
    });
    fixture.detectChanges();

    await submitAndSettle(fixture, cmp);

    expect(changePassword).toHaveBeenCalledWith('current-password', 'new-password');
    expect(cmp.model()).toEqual({
      currentPassword: '',
      newPassword: '',
      confirmationPassword: '',
    });
    expect(cmp.successMessage()).toBe('Password changed');
    expect(fixture.nativeElement.querySelector('[role="status"]')?.textContent).toContain(
      'Password changed'
    );
  });

  it('clears every secret when the editor is cancelled', () => {
    const { cmp } = setup(() => of(undefined));
    cmp.begin();
    cmp.model.set({
      currentPassword: 'current-password',
      newPassword: 'new-password',
      confirmationPassword: 'new-password',
    });

    (cmp as unknown as { close(): void }).close();

    expect(cmp.model()).toEqual({
      currentPassword: '',
      newPassword: '',
      confirmationPassword: '',
    });
  });

  it('attaches a wrong current password to its field without replacing the session', async () => {
    const { fixture, cmp } = setup(() =>
      throwError(() => new IncorrectCurrentPasswordError())
    );
    cmp.begin();
    cmp.model.set({
      currentPassword: 'wrong-password',
      newPassword: 'new-password',
      confirmationPassword: 'new-password',
    });
    fixture.detectChanges();

    await submitAndSettle(fixture, cmp);

    expect(cmp.passwordForm.currentPassword().errors().map((error) => error.message)).toContain(
      'Your current password is incorrect.'
    );
  });

  it('keeps a bodyless 401 truthful as a session-ended banner', async () => {
    const { fixture, cmp } = setup(() =>
      throwError(() => new ApiError('Your session has ended. Please sign in again.', 401))
    );
    cmp.begin();
    cmp.model.set({
      currentPassword: 'current-password',
      newPassword: 'new-password',
      confirmationPassword: 'new-password',
    });
    fixture.detectChanges();

    await submitAndSettle(fixture, cmp);

    expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain(
      'Your session has ended. Please sign in again.'
    );
    expect(cmp.passwordForm.currentPassword().errors()).toEqual([]);
  });
});
