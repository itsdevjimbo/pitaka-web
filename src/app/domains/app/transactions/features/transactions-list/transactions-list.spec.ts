import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  MATERIAL_ANIMATIONS,
  provideNativeDateAdapter,
} from '@angular/material/core';
import {
  ActivatedRoute,
  convertToParamMap,
  ParamMap,
  provideRouter,
  Router,
} from '@angular/router';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { provideDialogDefaults } from '@/app/core/dialog';
import { provideIcons } from '@/app/core/icons';
import { formatPeso } from '@/app/core/money';
import { Account, AccountsService } from '@/app/domains/app/accounts';
import { CategoriesService, Category } from '@/app/domains/app/categories';
import { provideFakeMedia } from '@/testing/media';
import { pressEscape, withOverlayContainer } from '@/testing/overlay';
import { Transaction, TransactionSearchResult } from '../../data/transaction';
import { TransactionsService } from '../../data/transactions.service';
import TransactionsList from './transactions-list';

/** The slice of the component a couple of tests reach into. */
type TransactionsListInternals = {
  onRemoved(): void;
  openRefileDialog(transaction: Transaction): void;
  applyCriteria(criteria: Record<string, unknown>): void;
};

/**
 * A stand-in for the query string: `navigate` on the spied Router pushes the
 * new parameters straight into the `ActivatedRoute` stub, so the round-trip a
 * filter change makes — write the URL, react to the route — runs synchronously
 * in a unit test the way it does in the app (#41).
 */
function fakeUrl(initial: Record<string, string> = {}) {
  const params$ = new BehaviorSubject<ParamMap>(convertToParamMap(initial));
  return {
    params$,
    activatedRoute: {
      snapshot: { queryParamMap: convertToParamMap(initial) },
      queryParamMap: params$.asObservable(),
    },
    navigate: (queryParams: Record<string, string>) =>
      params$.next(convertToParamMap(queryParams)),
  };
}

const CATEGORY_LIST: Category[] = [
  { id: 1, name: 'Groceries', kind: 'expense', isActive: true, isDefault: false },
  { id: 2, name: 'Salary', kind: 'income', isActive: true, isDefault: false },
];

const ACCOUNTS = [
  {
    id: 3,
    name: 'Everyday cash',
    type: 'Cash',
    currentBalance: 0,
    isActive: true,
  },
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
      categoryRead?: CategoriesService['all'];
      accounts?: AccountsService['list'];
      refile?: TransactionsService['refile'];
      remove?: TransactionsService['remove'];
      queryParams?: Record<string, string>;
    } = {}
  ) {
    const search =
      over.search ?? (() => of(page({ transactions: [tx()], totalCount: 1 })));
    const categoryRead = over.categoryRead ?? (() => of(CATEGORY_LIST));
    const accounts = over.accounts ?? (() => of(ACCOUNTS as unknown as never));
    const refile = over.refile ?? (() => of({} as Transaction));
    const remove = over.remove ?? (() => of(undefined));
    const url = fakeUrl(over.queryParams ?? {});

    TestBed.configureTestingModule({
      imports: [TransactionsList],
      providers: [
        provideIcons(),
        provideRouter([]),
        provideNativeDateAdapter(),
        provideDialogDefaults(),
        provideFakeMedia(),
        {
          provide: MATERIAL_ANIMATIONS,
          useValue: { animationsDisabled: true },
        },
        {
          provide: TransactionsService,
          useValue: { search, refile, remove },
        },
        {
          provide: CategoriesService,
          // `all()` feeds the list's own filter bar; `list()` feeds the refile
          // dialog opened from a row. The stub answers both from one fixture.
          useValue: { all: categoryRead, list: categoryRead },
        },
        { provide: AccountsService, useValue: { list: accounts } },
        { provide: ActivatedRoute, useValue: url.activatedRoute },
      ],
    });

    // The bar navigates through the Router; route it back into the fake URL so
    // the component reacts synchronously, the way the app does.
    const navigate = vi
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockImplementation((_commands, extras) => {
        url.navigate((extras?.queryParams ?? {}) as Record<string, string>);
        return Promise.resolve(true);
      });

    const fixture = TestBed.createComponent(TransactionsList);
    fixture.detectChanges();

    return {
      fixture,
      navigate,
      setUrl: (params: Record<string, string>) => url.navigate(params),
      cmp: fixture.componentInstance as unknown as TransactionsListInternals,
      text: () => (fixture.nativeElement as HTMLElement).textContent ?? '',
      links: () =>
        Array.from(
          (fixture.nativeElement as HTMLElement).querySelectorAll('a')
        ),
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
    const search = vi.fn(() =>
      of(page({ transactions: [tx()], totalCount: 1 }))
    );
    setup({ search: search as unknown as TransactionsService['search'] });

    expect(search).toHaveBeenCalledWith({}, 1);
  });

  it('reads transactions, Categories, and Accounts behind one loading state', () => {
    const categoryRead = vi.fn(() => of(CATEGORY_LIST));
    const accounts = vi.fn(() => of(ACCOUNTS as unknown as never));
    const pending = new Subject<TransactionSearchResult>();
    const { fixture, text } = setup({
      search: () => pending.asObservable(),
      categoryRead: categoryRead as unknown as CategoriesService['all'],
      accounts: accounts as unknown as AccountsService['list'],
    });

    // All three are asked for, and nothing renders until every one is in.
    expect(categoryRead).toHaveBeenCalledTimes(1);
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
    const savings = links().find((a) =>
      (a.textContent ?? '').includes('Savings')
    );
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
              tx({
                date: new Date('2026-08-29T14:05:00'),
                description: 'Coffee',
              }),
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
        of(
          page({ transactions: [tx({ id: 1 }), tx({ id: 2 })], totalCount: 37 })
        ),
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
            page({
              transactions: [tx({ description: 'First' })],
              totalCount: 2,
            })
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

    it('drops an in-flight page when the list is reset under it', async () => {
      const pendingSecond = new Subject<TransactionSearchResult>();
      const search = vi.fn((_criteria: unknown, p: number) =>
        p === 2
          ? pendingSecond.asObservable()
          : of(
              page({
                transactions: [tx({ id: 1, description: 'First' })],
                totalCount: 2,
              })
            )
      );
      const { fixture, cmp, button, text } = setup({
        search: search as unknown as TransactionsService['search'],
      });

      // Load more is in flight — its page 2 has not answered yet.
      button('Load more')!.click();
      fixture.detectChanges();

      // A removal resets the list to a fresh page 1 while page 2 is still pending.
      cmp.onRemoved();
      await settle(fixture);
      expect(text()).toContain('First');

      // The stale page 2 finally answers — it must not be stitched on.
      pendingSecond.next(
        page({
          transactions: [tx({ id: 2, description: 'Stale' })],
          totalCount: 2,
        })
      );
      pendingSecond.complete();
      await settle(fixture);

      expect(text()).not.toContain('Stale');
      expect(text()).toContain('Showing 1 of 2');
    });

    it('drops the control when a later page comes back empty', () => {
      const search = vi.fn((_criteria: unknown, p: number) =>
        p === 1
          ? of(
              page({
                transactions: [tx({ id: 1, description: 'First' })],
                totalCount: 5,
              })
            )
          : of(page({ transactions: [], totalCount: 5 }))
      );
      const { fixture, button, text } = setup({
        search: search as unknown as TransactionsService['search'],
      });

      // `totalCount` still claims more, but the next page has no rows.
      button('Load more')!.click();
      fixture.detectChanges();

      expect(text()).toContain('Showing 1 of 5');
      expect(button('Load more')).toBeUndefined();
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
            page({
              transactions: [tx({ description: 'Coffee' })],
              totalCount: 1,
            })
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
    const { text } = setup({
      search: () => throwError(() => new Error('boom')),
    });

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

  it('keeps the stale list and offers an inline retry when the post-removal re-read fails', async () => {
    let attempt = 0;
    const search = vi.fn(() => {
      attempt += 1;
      if (attempt === 1) {
        return of(
          page({
            transactions: [
              tx({ id: 1, description: 'First' }),
              tx({ id: 2, description: 'Second' }),
            ],
            totalCount: 2,
          })
        );
      }
      return attempt === 2
        ? throwError(() => new ApiError('Server fell over.', 500))
        : of(
            page({
              transactions: [tx({ id: 2, description: 'Second' })],
              totalCount: 1,
            })
          );
    });
    const { fixture, cmp, text, button } = setup({
      search: search as unknown as TransactionsService['search'],
    });

    // The removal re-read fails: the rows stay on screen — not the full-page
    // error state — with the failure explained inline.
    cmp.onRemoved();
    await settle(fixture);

    expect(text()).toContain('First');
    expect(text()).toContain('Second');
    expect(text()).toContain('Server fell over.');
    expect(text()).not.toContain('Loading transactions…');

    // The inline retry re-runs the whole read from the top and recovers.
    button('Try again')!.click();
    await settle(fixture);

    expect(search).toHaveBeenCalledTimes(3);
    expect(search).toHaveBeenLastCalledWith({}, 1);
    expect(text()).not.toContain('Server fell over.');
    expect(text()).not.toContain('First');
    expect(text()).toContain('Second');
    expect(text()).toContain('Showing 1 of 1');
  });

  it('falls back to a plain refresh message when a non-ApiError re-read fails', async () => {
    let attempt = 0;
    const search = vi.fn(() => {
      attempt += 1;
      return attempt === 1
        ? of(
            page({
              transactions: [tx({ description: 'First' })],
              totalCount: 1,
            })
          )
        : throwError(() => new Error('boom'));
    });
    const { fixture, cmp, text } = setup({
      search: search as unknown as TransactionsService['search'],
    });

    cmp.onRemoved();
    await settle(fixture);

    expect(text()).toContain('First');
    expect(text()).toContain(
      'Something went wrong refreshing your transactions. Please try again.'
    );
  });

  describe('refile, from the row menu', () => {
    const CATEGORIES: Category[] = [
      { id: 1, name: 'Groceries', kind: 'expense', isActive: true, isDefault: false },
      { id: 2, name: 'Salary', kind: 'income', isActive: true, isDefault: false },
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
        categoryRead: () => of(CATEGORIES),
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
        categoryRead: () => of(CATEGORIES),
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
        categoryRead: () => of(CATEGORIES),
      });

      await openRefileFromRowMenu(fixture);
      pressEscape();
      await settle(fixture);

      expect(dialog()).toBeNull();
      expect(refile).not.toHaveBeenCalled();
      expect(search).toHaveBeenCalledTimes(1);
    });
  });

  describe('the filter bar (#40)', () => {
    const RETIRED_ACCOUNTS: Account[] = [
      {
        id: 3,
        name: 'Everyday cash',
        type: 'Cash',
        currentBalance: 0,
        isActive: true,
      },
      {
        id: 9,
        name: 'Old wallet',
        type: 'Wallet',
        currentBalance: 0,
        isActive: false,
      },
    ];

    function filterBar(fixture: ComponentFixture<unknown>) {
      return (fixture.nativeElement as HTMLElement).querySelector(
        'transactions-filter-bar'
      );
    }

    it('renders the filter bar once a Profile has recorded something', () => {
      const { fixture } = setup({
        search: () => of(page({ transactions: [tx()], totalCount: 1 })),
      });

      expect(filterBar(fixture)).not.toBeNull();
    });

    it('does not render the filter bar for a Profile that has recorded nothing', () => {
      const { fixture, text } = setup({
        search: () => of(page({ transactions: [], totalCount: 0 })),
      });

      expect(filterBar(fixture)).toBeNull();
      expect(text()).toContain('No transactions yet');
    });

    it('offers retired Accounts in the Account filter, marked as retired', async () => {
      const { fixture } = setup({
        accounts: () => of(RETIRED_ACCOUNTS) as unknown as never,
      });

      const trigger = (
        fixture.nativeElement as HTMLElement
      ).querySelector<HTMLElement>(
        'mat-select[aria-label="Filter by account"]'
      );
      trigger!.click();
      await settle(fixture);

      const options = Array.from(overlay().querySelectorAll('mat-option')).map(
        (o) => (o.textContent ?? '').replace(/\s+/g, ' ').trim()
      );
      expect(options).toContain('Old wallet · Retired');
    });

    it('offers every Category in the Category filter, retired ones marked and sorted last', async () => {
      const { fixture } = setup({
        categoryRead: () =>
          of([
            { id: 1, name: 'Zoo trips', kind: 'expense', isActive: true, isDefault: false },
            { id: 4, name: 'Old gym', kind: 'expense', isActive: false, isDefault: false },
            { id: 2, name: 'Allowance', kind: 'income', isActive: true, isDefault: false },
          ] as Category[]),
      });

      const trigger = (
        fixture.nativeElement as HTMLElement
      ).querySelector<HTMLElement>(
        'mat-select[aria-label="Filter by category"]'
      );
      trigger!.click();
      await settle(fixture);

      const options = Array.from(overlay().querySelectorAll('mat-option')).map(
        (o) => (o.textContent ?? '').replace(/\s+/g, ' ').trim()
      );
      expect(options).toEqual([
        'Any category',
        'Allowance',
        'Zoo trips',
        'Old gym · Retired',
      ]);
    });

    it('is wired end to end: choosing an option in the rendered bar issues the narrowed read', async () => {
      const search = vi.fn((criteria: Record<string, unknown>, p: number) =>
        of(
          page({
            transactions: [
              tx({
                id: p,
                description: Object.keys(criteria).length
                  ? 'Narrowed'
                  : 'Whole history',
              }),
            ],
            totalCount: Object.keys(criteria).length ? 1 : 4,
          })
        )
      );
      const { fixture, text } = setup({
        search: search as unknown as TransactionsService['search'],
      });

      expect(text()).toContain('Whole history');

      // Open the real Direction select inside the rendered child and pick Expense.
      const trigger = (
        fixture.nativeElement as HTMLElement
      ).querySelector<HTMLElement>(
        'transactions-filter-bar mat-select[aria-label="Filter by direction"]'
      );
      trigger!.click();
      await settle(fixture);
      Array.from(overlay().querySelectorAll<HTMLElement>('mat-option'))
        .find((o) => (o.textContent ?? '').trim() === 'Expense')!
        .click();
      await settle(fixture);

      expect(search).toHaveBeenLastCalledWith({ direction: 'expense' }, 1);
      expect(text()).toContain('Narrowed');
      expect(text()).not.toContain('Whole history');
    });

    it('is wired end to end: typing in the note field issues the debounced narrowed read (#64)', async () => {
      // `debounceTime` runs on `setInterval` and measures with `Date.now()`;
      // fake both so the note debounce is under the test's control and zoneless
      // stability (on `setTimeout`) is untouched.
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
      try {
        const search = vi.fn((criteria: Record<string, unknown>, p: number) =>
          of(
            page({
              transactions: [
                tx({
                  id: p,
                  description: criteria['description']
                    ? 'Narrowed'
                    : 'Whole history',
                }),
              ],
              totalCount: criteria['description'] ? 1 : 4,
            })
          )
        );
        const { fixture, text } = setup({
          search: search as unknown as TransactionsService['search'],
        });

        expect(text()).toContain('Whole history');

        const noteInput = (
          fixture.nativeElement as HTMLElement
        ).querySelector<HTMLInputElement>(
          'transactions-filter-bar input[aria-label="Filter by note"]'
        );
        noteInput!.value = 'coffee';
        noteInput!.dispatchEvent(new Event('input'));

        // Nothing goes out until the debounce settles.
        expect(search).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(500);
        await settle(fixture);

        expect(search).toHaveBeenLastCalledWith({ description: 'coffee' }, 1);
        expect(text()).toContain('Narrowed');
        expect(text()).not.toContain('Whole history');
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not flash the "nothing recorded" screen while Clear filters is in flight', async () => {
      const pendingClear = new Subject<TransactionSearchResult>();
      let emptyCriteriaReads = 0;
      const search = vi.fn((criteria: Record<string, unknown>) => {
        if (Object.keys(criteria).length === 0) {
          emptyCriteriaReads += 1;
          // The first unfiltered read (entry) lands; the second (Clear filters) hangs.
          return emptyCriteriaReads === 1
            ? of(
                page({
                  transactions: [tx({ description: 'Everything' })],
                  totalCount: 3,
                })
              )
            : pendingClear.asObservable();
        }
        return of(page({ transactions: [], totalCount: 0 }));
      });
      const { fixture, cmp, text, button } = setup({
        search: search as unknown as TransactionsService['search'],
      });

      cmp.applyCriteria({ direction: 'income' });
      await settle(fixture);
      expect(text()).toContain('No transactions match these filters');

      button('Clear filters')!.click();
      fixture.detectChanges();

      // Criteria are back to {} but the read has not answered — the empty-history
      // wording must not appear and the filter bar must stay mounted.
      expect(text()).not.toContain('No transactions yet');
      expect(
        (fixture.nativeElement as HTMLElement).querySelector(
          'transactions-filter-bar'
        )
      ).not.toBeNull();
      expect(text()).toContain('Updating…');

      pendingClear.next(
        page({ transactions: [tx({ description: 'Back' })], totalCount: 1 })
      );
      pendingClear.complete();
      await settle(fixture);
      expect(text()).toContain('Back');
    });

    it('re-reads page 1 with the chosen criteria and keeps the old rows on screen until it lands', async () => {
      const pending = new Subject<TransactionSearchResult>();
      const search = vi.fn((criteria: unknown, p: number) =>
        p === 1 && JSON.stringify(criteria) === '{}'
          ? of(
              page({
                transactions: [tx({ id: 1, description: 'Whole list' })],
                totalCount: 5,
              })
            )
          : pending.asObservable()
      );
      const { fixture, cmp, text } = setup({
        search: search as unknown as TransactionsService['search'],
      });

      expect(text()).toContain('Whole list');

      cmp.applyCriteria({ direction: 'expense', accountId: 3 });
      fixture.detectChanges();

      // The request went out with exactly the criteria and page 1…
      expect(search).toHaveBeenLastCalledWith(
        { direction: 'expense', accountId: 3 },
        1
      );
      // …and while it is in flight the previous rows stay put under a busy note.
      expect(text()).toContain('Whole list');
      expect(text()).toContain('Updating…');

      pending.next(
        page({
          transactions: [tx({ id: 2, description: 'Just the expenses' })],
          totalCount: 2,
        })
      );
      pending.complete();
      await settle(fixture);

      expect(text()).not.toContain('Whole list');
      expect(text()).toContain('Just the expenses');
      expect(text()).toContain('Showing 1 of 2');
    });

    it('resets Load more back to page 1 when a filter changes', async () => {
      const search = vi.fn((criteria: Record<string, unknown>, p: number) =>
        of(
          page({
            transactions: [
              tx({
                id: p * 10,
                description: `page ${p} ${JSON.stringify(criteria)}`,
              }),
            ],
            totalCount: 9,
          })
        )
      );
      const { fixture, cmp, button } = setup({
        search: search as unknown as TransactionsService['search'],
      });

      button('Load more')!.click();
      fixture.detectChanges();
      expect(search).toHaveBeenLastCalledWith({}, 2);

      cmp.applyCriteria({ categoryId: 1 });
      await settle(fixture);
      expect(search).toHaveBeenLastCalledWith({ categoryId: 1 }, 1);

      button('Load more')!.click();
      fixture.detectChanges();
      // The next page carries on from 1 under the new criteria, not from 2.
      expect(search).toHaveBeenLastCalledWith({ categoryId: 1 }, 2);
    });

    it('tells "matched nothing" apart from "recorded nothing", and Clear filters restores the list', async () => {
      const search = vi.fn((criteria: Record<string, unknown>) =>
        Object.keys(criteria).length === 0
          ? of(
              page({
                transactions: [tx({ id: 1, description: 'Something' })],
                totalCount: 1,
              })
            )
          : of(page({ transactions: [], totalCount: 0 }))
      );
      const { fixture, cmp, text, button } = setup({
        search: search as unknown as TransactionsService['search'],
      });

      cmp.applyCriteria({ direction: 'income' });
      await settle(fixture);

      // Not the empty-history wording, and the filter bar is still there.
      expect(text()).toContain('No transactions match these filters');
      expect(text()).not.toContain('No transactions yet');
      expect(
        (fixture.nativeElement as HTMLElement).querySelector(
          'transactions-filter-bar'
        )
      ).not.toBeNull();

      button('Clear filters')!.click();
      await settle(fixture);

      expect(search).toHaveBeenLastCalledWith({}, 1);
      expect(text()).toContain('Something');
      expect(text()).toContain('Showing 1 of 1');
    });

    it('does not re-fetch Categories and Accounts on a filter change', async () => {
      const categoryRead = vi.fn(() => of(CATEGORY_LIST));
      const accounts = vi.fn(() => of(ACCOUNTS as unknown as never));
      const { fixture, cmp } = setup({
        categoryRead: categoryRead as unknown as CategoriesService['all'],
        accounts: accounts as unknown as AccountsService['list'],
      });

      expect(categoryRead).toHaveBeenCalledTimes(1);
      expect(accounts).toHaveBeenCalledTimes(1);

      cmp.applyCriteria({ direction: 'expense' });
      await settle(fixture);

      expect(categoryRead).toHaveBeenCalledTimes(1);
      expect(accounts).toHaveBeenCalledTimes(1);
    });

    it('keeps the rows and offers a retry when a filter change fails', async () => {
      let attempt = 0;
      const search = vi.fn((criteria: Record<string, unknown>) => {
        if (Object.keys(criteria).length === 0) {
          return of(
            page({
              transactions: [tx({ id: 1, description: 'Kept' })],
              totalCount: 1,
            })
          );
        }
        attempt += 1;
        return attempt === 1
          ? throwError(() => new ApiError('Filter server fell over.', 500))
          : of(
              page({
                transactions: [tx({ id: 2, description: 'Filtered' })],
                totalCount: 1,
              })
            );
      });
      const { fixture, cmp, text, button } = setup({
        search: search as unknown as TransactionsService['search'],
      });

      cmp.applyCriteria({ direction: 'expense' });
      await settle(fixture);

      expect(text()).toContain('Kept');
      expect(text()).toContain('Filter server fell over.');

      button('Try again')!.click();
      await settle(fixture);

      expect(text()).not.toContain('Filter server fell over.');
      expect(text()).toContain('Filtered');
    });
  });

  describe('the URL is the source of truth (#41)', () => {
    it('hydrates the criteria from the query string and reads the list already narrowed on entry', () => {
      const search = vi.fn(() =>
        of(page({ transactions: [tx({ description: 'Narrowed' })], totalCount: 1 }))
      );
      setup({
        search: search as unknown as TransactionsService['search'],
        queryParams: { account: '3', direction: 'expense', note: 'coffee' },
      });

      expect(search).toHaveBeenCalledTimes(1);
      expect(search).toHaveBeenCalledWith(
        { direction: 'expense', accountId: 3, description: 'coffee' },
        1
      );
    });

    it('reads a hand-edited junk parameter as unfiltered — it widens rather than breaks', () => {
      const search = vi.fn(() =>
        of(page({ transactions: [tx({ description: 'Everything' })], totalCount: 1 }))
      );
      const { fixture, text } = setup({
        search: search as unknown as TransactionsService['search'],
        queryParams: {
          direction: 'banana',
          account: 'abc',
          category: '-1',
          from: 'not-a-date',
          to: '2026-02-30',
          note: '   ',
        },
      });

      expect(search).toHaveBeenCalledWith({}, 1);
      expect(text()).toContain('Everything');
      expect(
        (fixture.nativeElement as HTMLElement).querySelector('[role="alert"]')
      ).toBeNull();
    });

    it('drops both ends of an inverted date range carried in the URL', () => {
      const search = vi.fn(() =>
        of(page({ transactions: [tx()], totalCount: 1 }))
      );
      setup({
        search: search as unknown as TransactionsService['search'],
        queryParams: { from: '2026-07-31', to: '2026-07-01' },
      });

      expect(search).toHaveBeenCalledWith({}, 1);
    });

    it('writes a changed filter to the query string without pushing a history entry, and never carries page', () => {
      const { cmp, navigate } = setup();

      cmp.applyCriteria({ direction: 'income', accountId: 9 });

      expect(navigate).toHaveBeenLastCalledWith(
        [],
        expect.objectContaining({
          queryParams: { direction: 'income', account: '9' },
          replaceUrl: true,
        })
      );
      const [, extras] = navigate.mock.calls.at(-1)!;
      expect(extras?.queryParams).not.toHaveProperty('page');
    });

    it('serialises the person’s criteria, not the wire’s: a bare inclusive calendar day', () => {
      const { cmp, navigate } = setup();

      cmp.applyCriteria({
        from: new Date(2026, 6, 1),
        to: new Date(2026, 6, 31),
      } as unknown as Record<string, unknown>);

      const [, extras] = navigate.mock.calls.at(-1)!;
      expect(extras?.queryParams).toEqual({ from: '2026-07-01', to: '2026-07-31' });
    });

    it('re-narrows the list when the query string changes underneath it (back button, pasted link)', async () => {
      const search = vi.fn((criteria: Record<string, unknown>) =>
        of(
          page({
            transactions: [
              tx({
                description: Object.keys(criteria).length ? 'Narrowed' : 'Whole',
              }),
            ],
            totalCount: 1,
          })
        )
      );
      const { fixture, setUrl, text } = setup({
        search: search as unknown as TransactionsService['search'],
      });

      expect(text()).toContain('Whole');

      setUrl({ category: '1' });
      await settle(fixture);

      expect(search).toHaveBeenLastCalledWith({ categoryId: 1 }, 1);
      expect(text()).toContain('Narrowed');
    });

    it('does not re-read when a navigation only drops a parameter the parser already ignored', () => {
      const search = vi.fn(() =>
        of(page({ transactions: [tx()], totalCount: 1 }))
      );
      const { setUrl } = setup({
        search: search as unknown as TransactionsService['search'],
        queryParams: { account: '3' },
      });

      expect(search).toHaveBeenCalledTimes(1);

      // Same readable criteria, plus a junk value the parser drops.
      setUrl({ account: '3', direction: 'banana' });

      expect(search).toHaveBeenCalledTimes(1);
    });

    it('empties the query parameters when filters are cleared', async () => {
      const search = vi.fn((criteria: Record<string, unknown>) =>
        Object.keys(criteria).length === 0
          ? of(
              page({
                transactions: [tx({ description: 'Everything' })],
                totalCount: 1,
              })
            )
          : of(page({ transactions: [], totalCount: 0 }))
      );
      const { fixture, cmp, button, navigate } = setup({
        search: search as unknown as TransactionsService['search'],
      });

      cmp.applyCriteria({ direction: 'income' });
      await settle(fixture);

      button('Clear filters')!.click();
      await settle(fixture);

      expect(navigate).toHaveBeenLastCalledWith(
        [],
        expect.objectContaining({ queryParams: {}, replaceUrl: true })
      );
      expect(search).toHaveBeenLastCalledWith({}, 1);
    });
  });
});
