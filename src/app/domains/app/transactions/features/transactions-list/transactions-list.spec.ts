import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  MATERIAL_ANIMATIONS,
  provideNativeDateAdapter,
} from '@angular/material/core';
import { provideRouter } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { provideDialogDefaults } from '@/app/core/dialog';
import { provideIcons } from '@/app/core/icons';
import { formatPeso } from '@/app/core/money';
import { AccountsService } from '@/app/domains/app/accounts';
import { CategoriesService } from '@/app/domains/app/categories/categories.service';
import { Category } from '@/app/domains/app/categories/category';
import { pressEscape, withOverlayContainer } from '@/testing/overlay';
import { Transaction, TransactionSearchResult } from '../../data/transaction';
import { TransactionsService } from '../../data/transactions.service';
import TransactionsList from './transactions-list';

/** The slice of the component a couple of tests reach into. */
type TransactionsListInternals = {
  onRemoved(): void;
  openRefileDialog(transaction: Transaction): void;
};

const NAMES = new Map<number, string>([
  [1, 'Groceries'],
  [2, 'Salary'],
]);

const ACCOUNTS = [
  { id: 3, name: 'Everyday cash', type: 'Cash', currentBalance: 0, isActive: true },
  { id: 9, name: 'Savings', type: 'Bank', currentBalance: 0, isActive: true },
];

function tx(over: Partial<Transaction> = {}): Transaction {
  return {
    id: 1,
    amount: 120.5,
    direction: 'expense',
    date: new Date('2026-08-29T14:05:00'),
    accountId: 3,
    transferToAccountId: null,
    categoryId: 1,
    generated: false,
    description: null,
    tags: [],
    ...over,
  };
}

function page(
  over: Partial<TransactionSearchResult> = {}
): TransactionSearchResult {
  return { transactions: [], totalCount: 0, ...over };
}

describe('TransactionsList', () => {
  const overlay = withOverlayContainer();

  function setup(
    over: {
      search?: TransactionsService['search'];
      names?: CategoriesService['names'];
      categoryList?: CategoriesService['list'];
      accounts?: AccountsService['list'];
      refile?: TransactionsService['refile'];
      remove?: TransactionsService['remove'];
    } = {}
  ) {
    const search =
      over.search ?? (() => of(page({ transactions: [tx()], totalCount: 1 })));
    const names = over.names ?? (() => of(NAMES));
    const categoryList = over.categoryList ?? (() => of<Category[]>([]));
    const accounts = over.accounts ?? (() => of(ACCOUNTS as unknown as never));
    const refile = over.refile ?? (() => of({} as Transaction));
    const remove = over.remove ?? (() => of(undefined));

    TestBed.configureTestingModule({
      imports: [TransactionsList],
      providers: [
        provideIcons(),
        provideRouter([]),
        provideNativeDateAdapter(),
        provideDialogDefaults(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        {
          provide: TransactionsService,
          useValue: { search, refile, remove },
        },
        {
          provide: CategoriesService,
          useValue: { names, list: categoryList },
        },
        { provide: AccountsService, useValue: { list: accounts } },
      ],
    });

    const fixture = TestBed.createComponent(TransactionsList);
    fixture.detectChanges();

    return {
      fixture,
      cmp: fixture.componentInstance as unknown as TransactionsListInternals,
      text: () => (fixture.nativeElement as HTMLElement).textContent ?? '',
      links: () =>
        Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('a')),
      button: (label: string) =>
        Array.from(
          (fixture.nativeElement as HTMLElement).querySelectorAll('button')
        ).find((b) => (b.textContent ?? '').includes(label)),
      dialog: () => overlay().querySelector<HTMLElement>('[role="dialog"]'),
      dialogText: () => overlay().textContent ?? '',
    };
  }

  /** Push change detection through the component and the overlay, and drain microtasks. */
  async function settle(fixture: ComponentFixture<unknown>) {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('shows progress while the first read is in flight, then the list', () => {
    const pending = new Subject<TransactionSearchResult>();
    const { fixture, text } = setup({ search: () => pending.asObservable() });

    expect(text()).toContain('Loading transactions…');

    pending.next(
      page({ transactions: [tx({ description: 'Coffee' })], totalCount: 1 })
    );
    pending.complete();
    fixture.detectChanges();

    expect(text()).not.toContain('Loading transactions…');
    expect(text()).toContain('Coffee');
  });

  it('reads the first page with empty criteria and page 1', () => {
    const search = vi.fn(() => of(page({ transactions: [tx()], totalCount: 1 })));
    setup({ search: search as unknown as TransactionsService['search'] });

    expect(search).toHaveBeenCalledWith({}, 1);
  });

  it('reads transactions, Category names, and Accounts behind one loading state', () => {
    const names = vi.fn(() => of(NAMES));
    const accounts = vi.fn(() => of(ACCOUNTS as unknown as never));
    const pending = new Subject<TransactionSearchResult>();
    const { fixture, text } = setup({
      search: () => pending.asObservable(),
      names: names as unknown as CategoriesService['names'],
      accounts: accounts as unknown as AccountsService['list'],
    });

    // All three are asked for, and nothing renders until every one is in.
    expect(names).toHaveBeenCalledTimes(1);
    expect(accounts).toHaveBeenCalledTimes(1);
    expect(text()).toContain('Loading transactions…');

    pending.next(
      page({ transactions: [tx({ description: 'Coffee' })], totalCount: 1 })
    );
    pending.complete();
    fixture.detectChanges();

    expect(text()).toContain('Coffee');
  });

  it('renders a spanning row: a Transfer once, unsigned, naming both ends', () => {
    const { text, links } = setup({
      search: () =>
        of(
          page({
            transactions: [
              tx({
                id: 1,
                direction: 'transfer',
                amount: 500,
                accountId: 3,
                transferToAccountId: 9,
                categoryId: null,
                description: 'Move to savings',
              }),
            ],
            totalCount: 1,
          })
        ),
    });

    expect(text()).toContain('Transfer');
    // Unsigned: the bare amount, never a +/- form.
    expect(text()).toContain(formatPeso(500));
    expect(text()).not.toContain(`+${formatPeso(500)}`);
    expect(text()).not.toContain(formatPeso(-500));
    // Both ends named and linked; the row itself is not a link.
    const everyday = links().find((a) =>
      (a.textContent ?? '').includes('Everyday cash')
    );
    const savings = links().find((a) => (a.textContent ?? '').includes('Savings'));
    expect(everyday?.getAttribute('href')).toBe('/app/accounts/3');
    expect(savings?.getAttribute('href')).toBe('/app/accounts/9');
  });

  it('keeps the signs on income and expense', () => {
    const { text } = setup({
      search: () =>
        of(
          page({
            transactions: [
              tx({ id: 1, direction: 'income', amount: 1000, categoryId: 2 }),
              tx({ id: 2, direction: 'expense', amount: 250, categoryId: 1 }),
            ],
            totalCount: 2,
          })
        ),
    });

    expect(text()).toContain(`+${formatPeso(1000)}`);
    expect(text()).toContain(formatPeso(-250));
  });

  it('renders the row date in local time', () => {
    const { text } = setup({
      search: () =>
        of(
          page({
            transactions: [
              tx({ date: new Date('2026-08-29T14:05:00'), description: 'Coffee' }),
            ],
            totalCount: 1,
          })
        ),
    });

    expect(text()).toContain('29 Aug 2026');
    expect(text()).toContain('2:05');
    expect(text()).toContain('PM');
  });

  it('shows how much of the whole is on screen', () => {
    const { text } = setup({
      search: () =>
        of(page({ transactions: [tx({ id: 1 }), tx({ id: 2 })], totalCount: 37 })),
    });

    expect(text()).toContain('Showing 2 of 37');
  });

  describe('Load more', () => {
    function pagedSearch() {
      return vi.fn((_criteria: unknown, p: number) =>
        p === 1
          ? of(
              page({
                transactions: [tx({ id: 1, description: 'First' })],
                totalCount: 2,
              })
            )
          : of(
              page({
                transactions: [tx({ id: 2, description: 'Second' })],
                totalCount: 2,
              })
            )
      );
    }

    it('appends the next page rather than replacing the list', () => {
      const search = pagedSearch();
      const { fixture, text, button } = setup({
        search: search as unknown as TransactionsService['search'],
      });

      expect(text()).toContain('First');
      expect(text()).not.toContain('Second');

      button('Load more')!.click();
      fixture.detectChanges();

      expect(search).toHaveBeenLastCalledWith({}, 2);
      expect(text()).toContain('First');
      expect(text()).toContain('Second');
      expect(text()).toContain('Showing 2 of 2');
    });

    it('drops the control once every row is shown', () => {
      const search = pagedSearch();
      const { fixture, button } = setup({
        search: search as unknown as TransactionsService['search'],
      });

      button('Load more')!.click();
      fixture.detectChanges();

      expect(button('Load more')).toBeUndefined();
    });

    it('is absent when the first page is already the whole answer', () => {
      const { button } = setup({
        search: () => of(page({ transactions: [tx()], totalCount: 1 })),
      });

      expect(button('Load more')).toBeUndefined();
    });

    it('keeps the list and offers its own retry when a page fails', () => {
      let attempt = 0;
      const search = vi.fn((_criteria: unknown, p: number) => {
        if (p === 1) {
          return of(
            page({ transactions: [tx({ description: 'First' })], totalCount: 2 })
          );
        }
        attempt += 1;
        return attempt === 1
          ? throwError(() => new ApiError('Server fell over.', 500))
          : of(
              page({
                transactions: [tx({ id: 2, description: 'Second' })],
                totalCount: 2,
              })
            );
      });
      const { fixture, text, button } = setup({
        search: search as unknown as TransactionsService['search'],
      });

      button('Load more')!.click();
      fixture.detectChanges();

      expect(text()).toContain('First');
      expect(text()).toContain('Server fell over.');

      button('Try again')!.click();
      fixture.detectChanges();

      expect(text()).toContain('Second');
      expect(text()).not.toContain('Server fell over.');
    });
  });

  it('explains a failed load and retries the whole read from the top when asked', () => {
    let attempt = 0;
    const search = vi.fn(() => {
      attempt += 1;
      return attempt === 1
        ? throwError(
            () => new ApiError('Something went wrong on the server.', 500)
          )
        : of(
            page({ transactions: [tx({ description: 'Coffee' })], totalCount: 1 })
          );
    });
    const { fixture, text, button } = setup({
      search: search as unknown as TransactionsService['search'],
    });

    expect(text()).toContain('Something went wrong on the server.');

    button('Try again')!.click();
    fixture.detectChanges();

    expect(search).toHaveBeenCalledTimes(2);
    expect(search).toHaveBeenLastCalledWith({}, 1);
    expect(text()).not.toContain('Something went wrong on the server.');
    expect(text()).toContain('Coffee');
  });

  it('falls back to a plain message when the failure is not an ApiError', () => {
    const { text } = setup({ search: () => throwError(() => new Error('boom')) });

    expect(text()).toContain(
      'Something went wrong loading your transactions. Please try again.'
    );
  });

  it('shows an empty state driven by a zero totalCount, not the failed-load state, with no extra probe', () => {
    const search = vi.fn(() => of(page({ transactions: [], totalCount: 0 })));
    const { fixture, text } = setup({
      search: search as unknown as TransactionsService['search'],
    });

    expect(text()).toContain('No transactions yet');
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[role="alert"]')
    ).toBeNull();
    // A totalCount of zero with empty criteria is the answer — nothing more asked.
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('re-runs the whole read from the top after a removal, resetting to the first page', async () => {
    const search = vi.fn((_criteria: unknown, p: number) =>
      p === 1
        ? of(
            page({
              transactions: [
                tx({ id: 1, description: 'First' }),
                tx({ id: 2, description: 'Second' }),
              ],
              totalCount: 3,
            })
          )
        : of(
            page({
              transactions: [tx({ id: 3, description: 'Third' })],
              totalCount: 3,
            })
          )
    );
    const { fixture, cmp, button, text } = setup({
      search: search as unknown as TransactionsService['search'],
    });

    button('Load more')!.click();
    fixture.detectChanges();
    expect(text()).toContain('Third');

    // After the removal the first page is a row shorter and the total has dropped.
    search.mockImplementation(() =>
      of(
        page({
          transactions: [tx({ id: 2, description: 'Second' })],
          totalCount: 1,
        })
      )
    );

    cmp.onRemoved();
    await settle(fixture);

    // Just the first page is re-read — the appended pages are dropped.
    expect(search).toHaveBeenLastCalledWith({}, 1);
    expect(text()).not.toContain('Loading transactions…');
    expect(text()).not.toContain('First');
    expect(text()).not.toContain('Third');
    expect(text()).toContain('Second');
    expect(text()).toContain('Showing 1 of 1');
  });

  describe('refile, from the row menu', () => {
    const CATEGORIES: Category[] = [
      { id: 1, name: 'Groceries', kind: 'expense' },
      { id: 2, name: 'Salary', kind: 'income' },
    ];

    function filed(over: Partial<Transaction> = {}): Transaction {
      return tx({
        id: 7,
        description: 'Coffee',
        categoryId: 1,
        date: new Date('2026-08-29T09:30:00'),
        ...over,
      });
    }

    async function openRefileFromRowMenu(fixture: ComponentFixture<unknown>) {
      const host = fixture.nativeElement as HTMLElement;
      const trigger = Array.from(host.querySelectorAll('button')).find(
        (b) => b.getAttribute('aria-label') === 'Transaction actions'
      );
      trigger!.click();
      await settle(fixture);
      Array.from(overlay().querySelectorAll('button'))
        .find((b) => (b.textContent ?? '').trim() === 'Refile')
        ?.click();
      await settle(fixture);
    }

    it('opens the shared dialog seeded with the row, leaving the list legible behind it', async () => {
      const { fixture, text, dialog, dialogText } = setup({
        search: () => of(page({ transactions: [filed()], totalCount: 1 })),
        categoryList: () => of(CATEGORIES),
      });
      const before = text();

      expect(dialog()).toBeNull();
      await openRefileFromRowMenu(fixture);

      expect(dialog()).not.toBeNull();
      expect(dialogText()).toContain('Refile transaction');
      expect(
        overlay().querySelector<HTMLInputElement>('#refile-transaction-note')!
          .value
      ).toBe('Coffee');
      expect(text()).toContain(before);
    });

    it('re-runs the whole read on a successful refile', async () => {
      const search = vi.fn(() =>
        of(page({ transactions: [filed()], totalCount: 1 }))
      );
      const refile = vi.fn(() => of(filed()));
      const { fixture } = setup({
        search: search as unknown as TransactionsService['search'],
        refile: refile as unknown as TransactionsService['refile'],
        categoryList: () => of(CATEGORIES),
      });

      await openRefileFromRowMenu(fixture);
      Array.from(overlay().querySelectorAll('button'))
        .find((b) => (b.textContent ?? '').trim() === 'Save')
        ?.click();
      await settle(fixture);

      expect(refile).toHaveBeenCalledTimes(1);
      expect(search).toHaveBeenCalledTimes(2);
      expect(search).toHaveBeenLastCalledWith({}, 1);
    });

    it('does nothing on Cancel', async () => {
      const search = vi.fn(() =>
        of(page({ transactions: [filed()], totalCount: 1 }))
      );
      const refile = vi.fn();
      const { fixture, dialog } = setup({
        search: search as unknown as TransactionsService['search'],
        refile: refile as unknown as TransactionsService['refile'],
        categoryList: () => of(CATEGORIES),
      });

      await openRefileFromRowMenu(fixture);
      pressEscape();
      await settle(fixture);

      expect(dialog()).toBeNull();
      expect(refile).not.toHaveBeenCalled();
      expect(search).toHaveBeenCalledTimes(1);
    });
  });
});
