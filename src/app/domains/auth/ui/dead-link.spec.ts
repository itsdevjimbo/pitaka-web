import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { AuthService } from '@/app/core/auth';
import { DeadLink } from './dead-link';

/**
 * The shared dead-link state (ADR 0015): says the link is no longer valid,
 * offers no diagnosis, and asks for an email before revealing the resend
 * control — unlike its other hosts, nothing here already knows an address.
 */
describe('DeadLink', () => {
  function setup(
    {
      resendConfirmation = () => of(undefined),
      forgotPassword = () => of(undefined),
      kind,
    }: {
      resendConfirmation?: AuthService['resendConfirmation'];
      forgotPassword?: AuthService['forgotPassword'];
      kind?: 'confirm-email' | 'reset-password';
    } = {}
  ) {
    TestBed.configureTestingModule({
      imports: [DeadLink],
      providers: [
        { provide: AuthService, useValue: { resendConfirmation, forgotPassword } },
      ],
    });

    const fixture = TestBed.createComponent(DeadLink);
    if (kind) {
      fixture.componentRef.setInput('kind', kind);
    }
    fixture.detectChanges();
    return fixture;
  }

  function input(fixture: ReturnType<typeof setup>): HTMLInputElement {
    return fixture.nativeElement.querySelector('input#email');
  }

  function resendButton(
    fixture: ReturnType<typeof setup>
  ): HTMLButtonElement | null {
    return fixture.nativeElement.querySelector('button');
  }

  it('says the link is no longer valid', () => {
    const fixture = setup();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'This link is no longer valid'
    );
  });

  it('withholds the resend control until an email address is valid', () => {
    const fixture = setup();

    expect(resendButton(fixture)).toBeNull();

    input(fixture).value = 'not-an-email';
    input(fixture).dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(resendButton(fixture)).toBeNull();

    input(fixture).value = 'ada@example.com';
    input(fixture).dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(resendButton(fixture)).not.toBeNull();
  });

  it('asks the service to resend to the address entered', async () => {
    const resendConfirmation = vi.fn(() => of(undefined));
    const fixture = setup({ resendConfirmation });

    input(fixture).value = 'ada@example.com';
    input(fixture).dispatchEvent(new Event('input'));
    fixture.detectChanges();

    resendButton(fixture)?.click();
    await fixture.whenStable();

    expect(resendConfirmation).toHaveBeenCalledWith('ada@example.com');
  });

  /**
   * The reset screen's dead-link fix is a different endpoint entirely (issue
   * #71): `kind="reset-password"` swaps which control gets revealed, so the
   * two links are never confused about which one their "send a new one" spends.
   */
  it('offers a fresh reset link, not a confirmation resend, when kind is reset-password', async () => {
    const forgotPassword = vi.fn(() => of(undefined));
    const fixture = setup({ forgotPassword, kind: 'reset-password' });

    input(fixture).value = 'ada@example.com';
    input(fixture).dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Send new reset link'
    );

    resendButton(fixture)?.click();
    await fixture.whenStable();

    expect(forgotPassword).toHaveBeenCalledWith('ada@example.com');
  });
});
