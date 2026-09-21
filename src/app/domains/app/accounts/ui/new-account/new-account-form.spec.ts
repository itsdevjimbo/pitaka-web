import { OverlayContainer } from '@angular/cdk/overlay';
import { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { provideIcons } from '@/app/core/icons';
import { Account, ACCOUNT_NAME_MAX } from '../../data/account';
import { AccountsService } from '../../data/accounts.service';
import { NewAccountForm } from './new-account-form';

const COULD_NOT_CREATE = 'Something went wrong creating your account. Please try again.';

const CREATED: Account = {
  id: 12,
  name: 'Petty cash',
  type: 'Cash',
  currentBalance: 250,
  isActive: true,
};

describe('NewAccountForm', () => {
  function setup(create: AccountsService['create']) {
    TestBed.configureTestingModule({
      imports: [NewAccountForm],
      providers: [provideIcons(), { provide: AccountsService, useValue: { create } }],
    });

    const fixture = TestBed.createComponent(NewAccountForm);
    fixture.detectChanges();
    return { fixture };
  }

  async function settle(fixture: ComponentFixture<NewAccountForm>) {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function input(fixture: ComponentFixture<NewAccountForm>, selector: string, value: string) {
    const element = fixture.nativeElement.querySelector(selector) as HTMLInputElement;
    element.value = value;
    element.dispatchEvent(new Event('input'));
  }

  async function chooseType(fixture: ComponentFixture<NewAccountForm>, label: string) {
    (fixture.nativeElement.querySelector('mat-select') as HTMLElement).click();
    await settle(fixture);
    const overlay = TestBed.inject(OverlayContainer).getContainerElement();
    const option = Array.from(overlay.querySelectorAll<HTMLElement>('mat-option')).find(
      (candidate) => candidate.textContent?.trim() === label,
    );
    if (!option) {
      throw new Error(`No Account type option labelled "${label}"`);
    }
    option.click();
    await settle(fixture);
  }

  async function submit(fixture: ComponentFixture<NewAccountForm>) {
    (fixture.nativeElement.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle(fixture);
  }

  function text(fixture: ComponentFixture<NewAccountForm>) {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  it('blocks a submission with no name and never calls the service', async () => {
    const create = vi.fn();
    const { fixture } = setup(create as unknown as AccountsService['create']);

    await chooseType(fixture, 'Cash');
    await submit(fixture);

    expect(text(fixture)).toContain('You must enter a name');
    expect(create).not.toHaveBeenCalled();
  });

  it('blocks a submission with no type chosen and never calls the service', async () => {
    const create = vi.fn();
    const { fixture } = setup(create as unknown as AccountsService['create']);

    input(fixture, '#account-name', 'Everyday cash');
    await submit(fixture);

    expect(text(fixture)).toContain('You must choose a type');
    expect(create).not.toHaveBeenCalled();
  });

  it('blocks a submission with a negative starting balance and never calls the service', async () => {
    const create = vi.fn();
    const { fixture } = setup(create as unknown as AccountsService['create']);

    input(fixture, '#account-name', 'Everyday cash');
    input(fixture, '#account-initial-balance', '-1');
    await chooseType(fixture, 'Cash');
    await submit(fixture);

    expect(text(fixture)).toContain('The starting balance cannot be negative');
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses a name over the maximum length with the length message', async () => {
    const create = vi.fn();
    const { fixture } = setup(create as unknown as AccountsService['create']);

    input(fixture, '#account-name', 'x'.repeat(ACCOUNT_NAME_MAX + 1));
    await chooseType(fixture, 'Cash');
    await submit(fixture);

    expect(text(fixture)).toContain(`The name must be ${ACCOUNT_NAME_MAX} characters or fewer`);
    expect(create).not.toHaveBeenCalled();
  });

  it('sends the trimmed name, the chosen type, and the starting balance, and emits the created Account', async () => {
    const create = vi.fn((_account) => of(CREATED));
    const { fixture } = setup(create as unknown as AccountsService['create']);
    const emitted: Account[] = [];
    fixture.componentInstance.created.subscribe((account) => emitted.push(account));

    input(fixture, '#account-name', '  Petty cash  ');
    input(fixture, '#account-initial-balance', '250');
    await chooseType(fixture, 'Cash');
    await submit(fixture);

    expect(create).toHaveBeenCalledWith({
      name: 'Petty cash',
      type: 'Cash',
      initialBalance: 250,
    });
    expect(emitted).toEqual([CREATED]);
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
  });

  it('accepts a starting balance of zero (ADR 0005)', async () => {
    const create = vi.fn((_account) => of({ ...CREATED, name: 'New wallet', type: 'Wallet', currentBalance: 0 }));
    const { fixture } = setup(create as unknown as AccountsService['create']);
    const emitted: Account[] = [];
    fixture.componentInstance.created.subscribe((account) => emitted.push(account));

    input(fixture, '#account-name', 'New wallet');
    await chooseType(fixture, 'Wallet');
    await submit(fixture);

    expect(create).toHaveBeenCalledWith({
      name: 'New wallet',
      type: 'Wallet',
      initialBalance: 0,
    });
    expect(emitted).toHaveLength(1);
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
  });

  it('binds a duplicate-name conflict onto the name control and leaves the banner empty', async () => {
    const { fixture } = setup(() =>
      throwError(
        () =>
          new ApiError('An account with this name already exists.', 409, {
            name: ['An account with this name already exists.'],
          }),
      ),
    );

    input(fixture, '#account-name', 'Savings');
    await chooseType(fixture, 'Bank');
    await submit(fixture);

    expect(text(fixture)).toContain('An account with this name already exists.');
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
  });

  it('shows the "could not create" banner for a failure it cannot pin to a field, and binds nothing', async () => {
    const { fixture } = setup(() => throwError(() => new Error('offline')));

    input(fixture, '#account-name', 'Brokerage');
    await chooseType(fixture, 'Investment');
    await submit(fixture);

    expect(text(fixture)).toContain(COULD_NOT_CREATE);
    expect(text(fixture)).not.toContain('You must enter a name');
    expect(text(fixture)).not.toContain('You must choose a type');
    expect((fixture.nativeElement.querySelector('#account-name') as HTMLInputElement).value).toBe('Brokerage');
  });

  it('clears the banner as soon as a field is edited after a failed submit', async () => {
    const { fixture } = setup(() => throwError(() => new Error('offline')));

    input(fixture, '#account-name', 'Brokerage');
    await chooseType(fixture, 'Investment');
    await submit(fixture);
    expect(text(fixture)).toContain(COULD_NOT_CREATE);

    input(fixture, '#account-name', 'Brokerage account');
    fixture.detectChanges();

    expect(text(fixture)).not.toContain(COULD_NOT_CREATE);
  });

  it('sends exactly one request when submitted twice in a row', async () => {
    const inFlight = new Subject<Account>();
    const create = vi.fn(() => inFlight.asObservable());
    const { fixture } = setup(create as unknown as AccountsService['create']);

    input(fixture, '#account-name', 'Petty cash');
    await chooseType(fixture, 'Cash');
    const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit'));
    form.dispatchEvent(new Event('submit'));
    await fixture.whenStable();

    expect(create).toHaveBeenCalledTimes(1);
  });

  it('emits cancelled without touching the service', () => {
    const create = vi.fn();
    const { fixture } = setup(create as unknown as AccountsService['create']);
    const emitted: unknown[] = [];
    fixture.componentInstance.cancelled.subscribe(() => emitted.push('cancelled'));

    const cancel = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Cancel',
    );
    if (!cancel) {
      throw new Error('No Cancel button');
    }
    cancel.click();

    expect(emitted).toEqual(['cancelled']);
    expect(create).not.toHaveBeenCalled();
  });
});
