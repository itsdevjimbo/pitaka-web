import { TestBed } from '@angular/core/testing';
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
  }) {
    const get = over.get ?? (() => of(ACCOUNT));
    const list = over.list ?? (() => of<Transaction[]>([]));
    const names = over.names ?? (() => of(NAMES));

    TestBed.configureTestingModule({
      imports: [AccountDetail],
      providers: [
        provideIcons(),
        provideRouter([]),
        { provide: AccountsService, useValue: { get } },
        { provide: TransactionsService, useValue: { list } },
        { provide: CategoriesService, useValue: { names } },
      ],
    });

    const fixture = TestBed.createComponent(AccountDetail);
    fixture.componentRef.setInput('id', '3');
    fixture.detectChanges();

    return {
      fixture,
      text: () => (fixture.nativeElement as HTMLElement).textContent ?? '',
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
});
