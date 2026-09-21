import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { AuthService, EmailChangeAddressTakenError, EmailChangeLinkInvalidError } from '@/app/core/auth';
import { provideIcons } from '@/app/core/icons';
import { Session } from '@/app/core/session';
import AuthConfirmEmailChange from './confirm-email-change';

describe('AuthConfirmEmailChange', () => {
  function setup(
    params: Record<string, string>,
    confirmEmailChange: AuthService['confirmEmailChange'] = () => of(undefined),
    session: Partial<Session> = {},
  ) {
    const navigate = vi.fn(() => Promise.resolve(true));
    const navigateByUrl = vi.fn(() => Promise.resolve(true));
    TestBed.configureTestingModule({
      imports: [AuthConfirmEmailChange],
      providers: [
        provideIcons(),
        { provide: AuthService, useValue: { confirmEmailChange, me: () => of(undefined) } },
        { provide: Session, useValue: { isAuthenticated: () => false, profile: () => null, ...session } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(params) } } },
        { provide: Router, useValue: { navigate, navigateByUrl } },
      ],
    });
    const fixture = TestBed.createComponent(AuthConfirmEmailChange);
    fixture.detectChanges();
    return { fixture, navigate, navigateByUrl };
  }

  it('does not spend a valid link until Confirm change is chosen', () => {
    const confirmEmailChange = vi.fn(() => of(undefined));
    setup({ userId: '7', token: 'a-token' }, confirmEmailChange);

    expect(confirmEmailChange).not.toHaveBeenCalled();
  });

  it('redeems once and sends a signed-out person to sign-in with the changed-address acknowledgement', async () => {
    const confirmEmailChange = vi.fn(() => of(undefined));
    const { fixture, navigate } = setup({ userId: '7', token: 'a-token' }, confirmEmailChange);

    (fixture.nativeElement.querySelector('button:last-child') as HTMLButtonElement).click();
    await fixture.whenStable();

    expect(confirmEmailChange).toHaveBeenCalledWith(7, 'a-token');
    expect(navigate).toHaveBeenCalledWith(['/auth/sign-in'], { queryParams: { reason: 'email-changed' } });
  });

  it('shows the truthful invalid-link recovery', async () => {
    const { fixture } = setup({ userId: '7', token: 'a-token' }, () =>
      throwError(() => new EmailChangeLinkInvalidError()),
    );
    (fixture.nativeElement.querySelector('button:last-child') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('link is no longer valid');
  });

  it('shows the distinct address-taken recovery', async () => {
    const { fixture } = setup({ userId: '7', token: 'a-token' }, () =>
      throwError(() => new EmailChangeAddressTakenError()),
    );
    (fixture.nativeElement.querySelector('button:last-child') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('no longer available');
  });
});
