import { TestBed } from '@angular/core/testing';
import { provideNativeDateAdapter } from '@angular/material/core';
import { provideRouter } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { provideIcons } from '@/app/core/icons';
import { formatPeso } from '@/app/core/money';
import { CategoriesService } from '@/app/domains/app/categories/categories.service';
import {
  Transaction,
  TransactionsService,
} from '@/app/domains/app/transactions';
import { Account } from '../../data/account';
import { AccountsService } from '../../data/accounts.service';
import AccountDetail from './account-detail';

/** The slice of the component a few tests reach into. */
type AccountDetailInternals = {
  recording: { set(value: boolean): void };
  onRecorded(): void;
};

const ACCOUNT: Account = {
  id: 3,
  name: 'Everyday cash',
  type: 'Cash',
  currentBalance: 4200,
  isActive: true,
};

const NAMES = new Map<number, string>([
  [1, 'Groceries'],
  [2, 'Salary'],
]);

function tx(over: Partial<Transaction> = {}): Transaction {
  return {
    id: 1,
    amount: 120.5,
    direction: 'expense',
    date: new Date('2026-08-29T00:00:00'),
    accountId: 3,
    transferToAccountId: null,
    categoryId: 1,
    generated: false,
    description: null,
    tags: [],
    ...over,
  };
}

describe('AccountDetail', () => {
  function setup(over: {
    get?: AccountsService['get'];
    list?: TransactionsService['list'];
    names?: CategoriesService['names'];
    record?: TransactionsService['record'];
    categoryList?: CategoriesService['list'];
  }) {
    const get = over.get ?? (() => of(ACCOUNT));
    const list = over.list ?? (() => of<Transaction[]>([]));
    const names = over.names ?? (() => of(NAMES));
    const record = over.record ?? (() => of({} as Transaction));
    const categoryList = over.categoryList ?? (() => of([]));

    TestBed.configureTestingModule({
      imports: [AccountDetail],
      providers: [
        provideIcons(),
        provideNativeDateAdapter(),
        provideRouter([]),
        { provide: AccountsService, useValue: { get } },
        { provide: TransactionsService, useValue: { list, record } },
        { provide: CategoriesService, useValue: { names, list: categoryList } },
      ],
    });

    const fixture = TestBed.createComponent(AccountDetail);
    fixture.componentRef.setInput('id', '3');
    fixture.detectChanges();

    return {
      fixture,
      cmp: fixture.componentInstance as unknown as AccountDetailInternals,
      text: () => (fixture.nativeElement as HTMLElement).textContent ?? '',
      button: (label: string) =>
        Array.from(
          (fixture.nativeElement as HTMLElement).querySelectorAll('button')
        ).find((b) => (b.textContent ?? '').includes(label)),
    };
  }

  it('shows progress while the load is in flight, then the list', () => {
    const pending = new Subject<Transaction[]>();
    const { fixture, text } = setup({ list: () => pending.asObservable() });

    expect(text()).toContain('Loading transactions…');

    pending.next([tx({ id: 9, description: 'Coffee' })]);
    pending.complete();
    fixture.detectChanges();

    expect(text()).not.toContain('Loading transactions…');
    expect(text()).toContain('Coffee');
  });

  it('heads the page with the Account, its type, and its current balance', () => {
    const { text } = setup({ list: () => of([tx()]) });

    expect(text()).toContain('Everyday cash');
    expect(text()).toContain('Cash');
    expect(text()).toContain(formatPeso(4200));
  });

  it('shows each row with a local date and time, an amount, a direction, and the Category name', () => {
    const { text } = setup({
      list: () =>
        of([
          tx({
            amount: 120.5,
            categoryId: 1,
            date: new Date('2026-08-29T14:05:00'),
          }),
        ]),
    });

    expect(text()).toContain('29 Aug 2026');
    expect(text()).toContain('2:05');
    expect(text()).toContain('PM');
    expect(text()).toContain(formatPeso(-120.5));
    expect(text()).toContain('Expense');
    expect(text()).toContain('Groceries');
  });

  it('resolves Category names through the shared cache, not once per row', () => {
    const names = vi.fn(() => of(NAMES));
    const { text } = setup({
      names: names as unknown as CategoriesService['names'],
      list: () =>
        of([
          tx({ id: 1, categoryId: 1 }),
          tx({ id: 2, categoryId: 1 }),
          tx({ id: 3, categoryId: 2, direction: 'income' }),
        ]),
    });

    expect(names).toHaveBeenCalledTimes(1);
    expect(text()).toContain('Groceries');
    expect(text()).toContain('Salary');
  });

  it('labels an uncategorised income or expense rather than leaving it blank', () => {
    const { text } = setup({
      list: () => of([tx({ direction: 'expense', categoryId: null })]),
    });

    expect(text()).toContain('Uncategorised');
  });

  it('marks a generated transaction as one, and shows only its wall-clock day', () => {
    const { text } = setup({
      list: () =>
        of([
          tx({
            generated: true,
            description: 'Rent',
            date: new Date('2026-08-29T00:00:00'),
          }),
        ]),
    });

    expect(text()).toContain('Generated');
    expect(text()).toContain('29 Aug 2026');
    expect(text()).not.toContain('12:00');
  });

  it('tells income and expense apart by sign, not only by a label', () => {
    const { text } = setup({
      list: () =>
        of([
          tx({ id: 1, direction: 'income', amount: 1000, categoryId: 2 }),
          tx({ id: 2, direction: 'expense', amount: 250, categoryId: 1 }),
        ]),
    });

    expect(text()).toContain(`+${formatPeso(1000)}`);
    expect(text()).toContain(formatPeso(-250));
  });

  it('signs a Transfer leaving the viewed Account as outgoing', () => {
    const { text } = setup({
      list: () =>
        of([
          tx({
            id: 1,
            direction: 'transfer',
            amount: 500,
            accountId: 3, // the Account on screen — the money leaves here
            transferToAccountId: 9,
            categoryId: null,
            description: 'Move to savings',
          }),
        ]),
    });

    expect(text()).toContain('Transfer');
    expect(text()).toContain(formatPeso(-500));
    expect(text()).not.toContain(`+${formatPeso(500)}`);
  });

  it('signs a Transfer arriving in the viewed Account as incoming', () => {
    const { text } = setup({
      list: () =>
        of([
          tx({
            id: 1,
            direction: 'transfer',
            amount: 500,
            accountId: 9,
            transferToAccountId: 3, // the Account on screen — the money lands here
            categoryId: null,
            description: 'Move from everyday',
          }),
        ]),
    });

    expect(text()).toContain('Transfer');
    expect(text()).toContain(`+${formatPeso(500)}`);
    expect(text()).not.toContain(formatPeso(-500));
  });

  it('never heads a Transfer with a Category label, even with no note', () => {
    const { text } = setup({
      list: () =>
        of([
          tx({
            id: 1,
            direction: 'transfer',
            categoryId: null,
            description: null,
          }),
        ]),
    });

    expect(text()).toContain('Transfer');
    expect(text()).not.toContain('Uncategorised');
  });

  it('shows the Tags on a Transaction', () => {
    const { text } = setup({
      list: () =>
        of([
          tx({
            description: 'Lunch',
            tags: [
              { id: 1, name: 'work' },
              { id: 2, name: 'reimbursable' },
            ],
          }),
        ]),
    });

    expect(text()).toContain('#work');
    expect(text()).toContain('#reimbursable');
  });

  it('shows an empty state that is not the failed-load state', () => {
    const { fixture, text } = setup({ list: () => of([]) });

    expect(text()).toContain('No transactions yet');
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[role="alert"]')
    ).toBeNull();
  });

  it('explains a failed load and retries from the top when asked', () => {
    let attempt = 0;
    const list = vi.fn(() => {
      attempt += 1;
      return attempt === 1
        ? throwError(
            () => new ApiError('Something went wrong on the server.', 500)
          )
        : of<Transaction[]>([tx({ description: 'Coffee' })]);
    });
    const { fixture, text } = setup({
      list: list as unknown as TransactionsService['list'],
    });

    expect(text()).toContain('Something went wrong on the server.');

    const retry = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button')
    ).find((b) => (b.textContent ?? '').includes('Try again'));
    retry?.click();
    fixture.detectChanges();

    expect(list).toHaveBeenCalledTimes(2);
    expect(text()).not.toContain('Something went wrong on the server.');
    expect(text()).toContain('Coffee');
  });

  it('drops "Try again" for a 404 and points back to the list instead', () => {
    const { fixture, text } = setup({
      list: () =>
        throwError(
          () =>
            new ApiError(
              "We couldn't find that. It may have been deleted, or it may not be yours.",
              404
            )
        ),
    });

    expect(text()).toContain("We couldn't find that");

    const host = fixture.nativeElement as HTMLElement;
    const retry = Array.from(host.querySelectorAll('button')).find((b) =>
      (b.textContent ?? '').includes('Try again')
    );
    expect(retry).toBeUndefined();

    const back = Array.from(host.querySelectorAll('a')).find((a) =>
      (a.textContent ?? '').includes('Back to accounts')
    );
    expect(back?.getAttribute('href')).toBe('/app/accounts');
  });

  it('falls back to a plain message when the failure is not an ApiError', () => {
    const { text } = setup({ list: () => throwError(() => new Error('boom')) });

    expect(text()).toContain(
      'Something went wrong loading this account. Please try again.'
    );
  });

  it('reveals the record form from a control on an active Account', () => {
    const { fixture, text, button } = setup({ list: () => of([tx()]) });

    expect(text()).not.toContain('Record a transaction');

    button('Record')?.click();
    fixture.detectChanges();

    expect(text()).toContain('Record a transaction');
  });

  it('offers no record control on a retired Account, and points at reactivating it', () => {
    const { fixture, text, button } = setup({
      get: () => of({ ...ACCOUNT, isActive: false }),
      list: () => of([tx()]),
    });

    expect(button('Record')).toBeUndefined();
    expect(text()).toContain('retired');

    const link = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('a')
    ).find((a) => (a.textContent ?? '').includes('accounts list'));
    expect(link?.getAttribute('href')).toBe('/app/accounts');
  });

  it('re-reads the balance and list in place after a record — no full-page spinner', () => {
    const get = vi
      .fn()
      .mockReturnValueOnce(of(ACCOUNT))
      .mockReturnValueOnce(of({ ...ACCOUNT, currentBalance: 4079.5 }));
    const list = vi
      .fn()
      .mockReturnValueOnce(of<Transaction[]>([]))
      .mockReturnValueOnce(of([tx({ id: 7, description: 'Coffee' })]));
    const names = vi.fn(() => of(NAMES));

    const { fixture, cmp, text } = setup({
      get: get as unknown as AccountsService['get'],
      list: list as unknown as TransactionsService['list'],
      names: names as unknown as CategoriesService['names'],
    });

    cmp.onRecorded();
    fixture.detectChanges();

    expect(get).toHaveBeenCalledTimes(2);
    expect(list).toHaveBeenCalledTimes(2);
    expect(names).toHaveBeenCalledTimes(2);
    expect(text()).not.toContain('Loading transactions…');
    expect(text()).toContain(formatPeso(4079.5));
    expect(text()).toContain('Coffee');
  });

  it('keeps the screen as it was when the post-record re-read fails', () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const get = vi
      .fn()
      .mockReturnValueOnce(of(ACCOUNT))
      .mockReturnValueOnce(throwError(() => new Error('offline')));
    const list = vi
      .fn()
      .mockReturnValueOnce(of([tx({ description: 'Lunch' })]))
      .mockReturnValueOnce(throwError(() => new Error('offline')));

    const { fixture, cmp, text } = setup({
      get: get as unknown as AccountsService['get'],
      list: list as unknown as TransactionsService['list'],
    });

    cmp.onRecorded();
    fixture.detectChanges();

    expect(text()).toContain('Lunch');
    expect(text()).not.toContain('Please try again');
    consoleError.mockRestore();
  });
});
