import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { AuthService, IncorrectCurrentPasswordError } from '@/app/core/auth';
import { provideIcons } from '@/app/core/icons';
import { ProfilePassword } from './profile-password';

describe('ProfilePassword', () => {
  function setup(changePassword: AuthService['changePassword']) {
    TestBed.configureTestingModule({
      imports: [ProfilePassword],
      providers: [provideIcons(), { provide: AuthService, useValue: { changePassword } }],
    });
    const fixture = TestBed.createComponent(ProfilePassword);
    fixture.detectChanges();
    return { fixture };
  }

  async function submitAndSettle(fixture: ComponentFixture<ProfilePassword>) {
    (fixture.nativeElement.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function open(fixture: ComponentFixture<ProfilePassword>) {
    (fixture.nativeElement.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
  }

  function enter(fixture: ComponentFixture<ProfilePassword>, selector: string, value: string) {
    const input = fixture.nativeElement.querySelector(selector) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function fill(
    fixture: ComponentFixture<ProfilePassword>,
    currentPassword: string,
    newPassword: string,
    confirmationPassword: string,
  ) {
    open(fixture);
    enter(fixture, '#current-password', currentPassword);
    enter(fixture, '#new-password', newPassword);
    enter(fixture, '#confirm-new-password', confirmationPassword);
  }

  it('opens the inline editor focused on the current password', async () => {
    const { fixture } = setup(() => of(undefined));

    (fixture.nativeElement.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('Current password');
    expect(document.activeElement).toBe(fixture.nativeElement.querySelector('#current-password'));
  });

  it('does not submit a mismatched or too-short new password', async () => {
    const changePassword = vi.fn(() => of(undefined));
    const { fixture } = setup(changePassword);
    fill(fixture, 'current-password', 'short12', 'different-password');

    await submitAndSettle(fixture);

    expect(changePassword).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Your password must be at least 8 characters');
    expect(fixture.nativeElement.textContent).toContain('Passwords do not match');
  });

  it('changes the password, clears every secret, and leaves persistent success feedback', async () => {
    const changePassword = vi.fn(() => of(undefined));
    const { fixture } = setup(changePassword);
    fill(fixture, 'current-password', 'new-password', 'new-password');

    await submitAndSettle(fixture);

    expect(changePassword).toHaveBeenCalledWith('current-password', 'new-password');
    expect(fixture.nativeElement.querySelector('form')).toBeNull();
    expect(fixture.nativeElement.querySelector('[role="status"]')?.textContent).toContain('Password changed');
  });

  it('clears every secret when the editor is cancelled', () => {
    const { fixture } = setup(() => of(undefined));
    fill(fixture, 'current-password', 'new-password', 'new-password');

    const cancel = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Cancel',
    );
    if (!cancel) {
      throw new Error('No Cancel button');
    }
    cancel.click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('form')).toBeNull();
    open(fixture);
    expect((fixture.nativeElement.querySelector('#current-password') as HTMLInputElement).value).toBe('');
    expect((fixture.nativeElement.querySelector('#new-password') as HTMLInputElement).value).toBe('');
    expect((fixture.nativeElement.querySelector('#confirm-new-password') as HTMLInputElement).value).toBe('');
  });

  it('attaches a wrong current password to its field without replacing the session', async () => {
    const { fixture } = setup(() => throwError(() => new IncorrectCurrentPasswordError()));
    fill(fixture, 'wrong-password', 'new-password', 'new-password');

    await submitAndSettle(fixture);

    expect(fixture.nativeElement.textContent).toContain('Your current password is incorrect.');
  });

  it('keeps a bodyless 401 truthful as a session-ended banner', async () => {
    const { fixture } = setup(() =>
      throwError(() => new ApiError('Your session has ended. Please sign in again.', 401)),
    );
    fill(fixture, 'current-password', 'new-password', 'new-password');

    await submitAndSettle(fixture);

    expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain(
      'Your session has ended. Please sign in again.',
    );
    expect(fixture.nativeElement.textContent).not.toContain('Your current password is incorrect.');
  });
});
