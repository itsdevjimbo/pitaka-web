import { OutputEmitterRef, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FieldTree } from '@angular/forms/signals';
import { of, Subject, throwError } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { provideIcons } from '@/app/core/icons';
import { Account, ACCOUNT_NAME_MAX, AccountType } from '../data/account';
import { AccountsService } from '../data/accounts.service';
import { NewAccountForm } from './new-account-form';

/** The slice of the component the tests reach into. */
type NewAccountInternals = {
  model: WritableSignal<{
    name: string;
    type: AccountType | '';
    initialBalance: number;
  }>;
  accountForm: {
    name: FieldTree<string>;
    type: FieldTree<AccountType | ''>;
    initialBalance: FieldTree<number>;
  };
  errorMessage: () => string | null;
  created: OutputEmitterRef<Account>;
  cancelled: OutputEmitterRef<void>;
  save(event: Event): void;
  cancel(): void;
};

const COULD_NOT_CREATE =
  'Something went wrong creating your account. Please try again.';

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
      providers: [
        provideIcons(),
        { provide: AccountsService, useValue: { create } },
      ],
    });

    const fixture = TestBed.createComponent(NewAccountForm);
    const cmp = fixture.componentInstance as unknown as NewAccountInternals;
    fixture.detectChanges();
    return { fixture, cmp };
  }

  async function submitAndSettle(
    fixture: { whenStable: () => Promise<unknown> },
    cmp: NewAccountInternals
  ) {
    cmp.save(new Event('submit'));
    await fixture.whenStable();
    await fixture.whenStable();
  }

  function messagesOn(field: FieldTree<unknown>) {
    return field()
      .errors()
      .map((error) => error.message);
  }

  it('blocks a submission with no name and never calls the service', async () => {
    const create = vi.fn();
    const { fixture, cmp } = setup(
      create as unknown as AccountsService['create']
    );

    cmp.model.set({ name: '', type: 'Cash', initialBalance: 0 });
    await submitAndSettle(fixture, cmp);

    expect(messagesOn(cmp.accountForm.name)).toContain('You must enter a name');
    expect(create).not.toHaveBeenCalled();
  });

  it('blocks a submission with no type chosen and never calls the service', async () => {
    const create = vi.fn();
    const { fixture, cmp } = setup(
      create as unknown as AccountsService['create']
    );

    cmp.model.set({ name: 'Everyday cash', type: '', initialBalance: 0 });
    await submitAndSettle(fixture, cmp);

    expect(messagesOn(cmp.accountForm.type)).toContain('You must choose a type');
    expect(create).not.toHaveBeenCalled();
  });

  it('blocks a submission with a negative starting balance and never calls the service', async () => {
    const create = vi.fn();
    const { fixture, cmp } = setup(
      create as unknown as AccountsService['create']
    );

    cmp.model.set({ name: 'Everyday cash', type: 'Cash', initialBalance: -1 });
    await submitAndSettle(fixture, cmp);

    expect(messagesOn(cmp.accountForm.initialBalance)).toContain(
      'The starting balance cannot be negative'
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses a name over the maximum length with the length message', async () => {
    const create = vi.fn();
    const { fixture, cmp } = setup(
      create as unknown as AccountsService['create']
    );

    cmp.model.set({
      name: 'x'.repeat(ACCOUNT_NAME_MAX + 1),
      type: 'Cash',
      initialBalance: 0,
    });
    await submitAndSettle(fixture, cmp);

    expect(messagesOn(cmp.accountForm.name)).toContain(
      `The name must be ${ACCOUNT_NAME_MAX} characters or fewer`
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('sends the trimmed name, the chosen type, and the starting balance, and emits the created Account', async () => {
    const create = vi.fn((_account) => of(CREATED));
    const { fixture, cmp } = setup(
      create as unknown as AccountsService['create']
    );
    const emitted: Account[] = [];
    cmp.created.subscribe((account) => emitted.push(account));

    cmp.model.set({
      name: '  Petty cash  ',
      type: 'Cash',
      initialBalance: 250,
    });
    await submitAndSettle(fixture, cmp);

    expect(create).toHaveBeenCalledWith({
      name: 'Petty cash',
      type: 'Cash',
      initialBalance: 250,
    });
    expect(emitted).toEqual([CREATED]);
    expect(cmp.errorMessage()).toBeNull();
  });

  it('accepts a starting balance of zero (ADR 0005)', async () => {
    const create = vi.fn((_account) =>
      of({ ...CREATED, name: 'New wallet', type: 'Wallet', currentBalance: 0 })
    );
    const { fixture, cmp } = setup(
      create as unknown as AccountsService['create']
    );
    const emitted: Account[] = [];
    cmp.created.subscribe((account) => emitted.push(account));

    cmp.model.set({ name: 'New wallet', type: 'Wallet', initialBalance: 0 });
    await submitAndSettle(fixture, cmp);

    expect(create).toHaveBeenCalledWith({
      name: 'New wallet',
      type: 'Wallet',
      initialBalance: 0,
    });
    expect(emitted).toHaveLength(1);
    expect(cmp.errorMessage()).toBeNull();
  });

  it('binds a duplicate-name conflict onto the name control and leaves the banner empty', async () => {
    const { fixture, cmp } = setup(() =>
      throwError(
        () =>
          new ApiError('An account with this name already exists.', 409, {
            name: ['An account with this name already exists.'],
          })
      )
    );

    cmp.model.set({ name: 'Savings', type: 'Bank', initialBalance: 0 });
    await submitAndSettle(fixture, cmp);

    expect(messagesOn(cmp.accountForm.name)).toContain(
      'An account with this name already exists.'
    );
    expect(cmp.errorMessage()).toBeNull();
  });

  it('shows the "could not create" banner for a failure it cannot pin to a field, and binds nothing', async () => {
    const { fixture, cmp } = setup(() => throwError(() => new Error('offline')));

    cmp.model.set({ name: 'Brokerage', type: 'Investment', initialBalance: 0 });
    await submitAndSettle(fixture, cmp);

    expect(cmp.errorMessage()).toBe(COULD_NOT_CREATE);
    expect(cmp.accountForm.name().errors()).toEqual([]);
    expect(cmp.accountForm.type().errors()).toEqual([]);
    expect(cmp.accountForm.initialBalance().errors()).toEqual([]);
  });

  it('clears the banner as soon as a field is edited after a failed submit', async () => {
    const { fixture, cmp } = setup(() => throwError(() => new Error('offline')));

    cmp.model.set({ name: 'Brokerage', type: 'Investment', initialBalance: 0 });
    await submitAndSettle(fixture, cmp);
    expect(cmp.errorMessage()).toBe(COULD_NOT_CREATE);

    cmp.model.update((model) => ({ ...model, name: 'Brokerage account' }));

    expect(cmp.errorMessage()).toBeNull();
  });

  it('sends exactly one request when submitted twice in a row', async () => {
    const inFlight = new Subject<Account>();
    const create = vi.fn(() => inFlight.asObservable());
    const { fixture, cmp } = setup(
      create as unknown as AccountsService['create']
    );

    cmp.model.set({ name: 'Petty cash', type: 'Cash', initialBalance: 0 });
    cmp.save(new Event('submit'));
    cmp.save(new Event('submit'));
    await fixture.whenStable();

    expect(create).toHaveBeenCalledTimes(1);
  });

  it('emits cancelled without touching the service', () => {
    const create = vi.fn();
    const { cmp } = setup(create as unknown as AccountsService['create']);
    const emitted: unknown[] = [];
    cmp.cancelled.subscribe(() => emitted.push('cancelled'));

    cmp.cancel();

    expect(emitted).toEqual(['cancelled']);
    expect(create).not.toHaveBeenCalled();
  });
});
