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
    resendConfirmation: AuthService['resendConfirmation'] = () => of(undefined)
  ) {
    TestBed.configureTestingModule({
      imports: [DeadLink],
      providers: [{ provide: AuthService, useValue: { resendConfirmation } }],
    });

    const fixture = TestBed.createComponent(DeadLink);
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
    const resend = vi.fn(() => of(undefined));
    const fixture = setup(resend);

    input(fixture).value = 'ada@example.com';
    input(fixture).dispatchEvent(new Event('input'));
    fixture.detectChanges();

    resendButton(fixture)?.click();
    await fixture.whenStable();

    expect(resend).toHaveBeenCalledWith('ada@example.com');
  });
});
