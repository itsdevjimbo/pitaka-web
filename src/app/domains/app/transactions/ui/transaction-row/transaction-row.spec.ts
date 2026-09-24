import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatDialog } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { NEVER, of, Subject, throwError } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { provideIcons } from '@/app/core/icons';
import { formatPeso } from '@/app/core/money';
import { AccountsService } from '@/app/domains/app/accounts';
import {
  ContributionDeletionCoordinator,
  GoalContributionUnavailableError,
  GoalContributionsService,
  GoalsService,
} from '@/app/domains/app/goals';
import { withOverlayContainer } from '@/testing/overlay';
import { TransactionLinkedContributions } from '../../data/linked-contributions/linked-contribution';
import { TransactionSplitResult } from '../../data/linked-contributions/transaction-split';
import { Transaction } from '../../data/transaction';
import {
  TransactionHasLinkedContributionsError,
  TransactionRemovalConcurrentStateError,
} from '../../data/transaction-removal';
import { TransactionsService } from '../../data/transactions.service';
import { TransactionRow, TransactionRowModel, toAccountRow, toSpanningRow } from './transaction-row';

const NAMES = new Map<number, string>([
  [1, 'Groceries'],
  [2, 'Salary'],
]);

const ACCOUNT_NAMES = new Map<number, string>([
  [3, 'Everyday cash'],
  [9, 'Savings'],
]);

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

function linkedSnapshot(): TransactionLinkedContributions {
  return {
    transactionId: 42,
    transactionAmount: 500,
    linkedTotal: 300,
    remainingCapacity: 200,
    account: {
      id: 3,
      name: 'Everyday cash',
      currentBalance: 1000,
      earmarkedTotal: 300,
      availableHeadroom: 700,
      active: true,
    },
    linkedContributions: [
      {
        id: 91,
        goalId: 2,
        goalName: 'Emergency fund',
        accountId: 3,
        transactionId: 42,
        amount: 150,
        contributionDate: new Date(2026, 8, 15),
        note: 'First slice',
      },
      {
        id: 92,
        goalId: 2,
        goalName: 'Emergency fund',
        accountId: 3,
        transactionId: 42,
        amount: 150,
        contributionDate: new Date(2026, 8, 16),
        note: null,
      },
    ],
  };
}

/**
 * The two pure builders that turn a domain {@link Transaction} into the finished
 * row. Both resolve the Category name through the caller's shared cache and
 * choose the headline; they differ only in the reading they attach — one for a
 * screen with an Account in view, one for a list spanning every Account.
 */
describe('toAccountRow', () => {
  it('resolves the Category name from the shared cache', () => {
    expect(toAccountRow(tx({ categoryId: 2 }), NAMES, 3).categoryName).toBe('Salary');
  });

  it('labels an uncategorised income or expense rather than leaving it blank', () => {
    expect(toAccountRow(tx({ categoryId: null }), NAMES, 3).categoryName).toBe('Uncategorised');
    expect(toAccountRow(tx({ categoryId: 999 }), NAMES, 3).categoryName).toBe('Uncategorised');
  });

  it('heads a row with its note when it has one', () => {
    expect(toAccountRow(tx({ description: 'Coffee' }), NAMES, 3).headline).toBe('Coffee');
  });

  it('falls back to the Category for an un-noted income or expense', () => {
    expect(toAccountRow(tx({ description: null, categoryId: 1 }), NAMES, 3).headline).toBe('Groceries');
  });

  it('never heads a Transfer with a Category label, even with no note', () => {
    const row = toAccountRow(tx({ direction: 'transfer', description: null, categoryId: null }), NAMES, 3);

    expect(row.headline).toBe('Transfer');
  });

  it('carries an account reading', () => {
    expect(toAccountRow(tx(), NAMES, 3).reading.kind).toBe('account');
  });

  it('signs income as incoming and expense as outgoing', () => {
    expect(toAccountRow(tx({ direction: 'income' }), NAMES, 3).reading).toEqual({
      kind: 'account',
      incoming: true,
      recordedAgainst: null,
    });
    expect(toAccountRow(tx({ direction: 'expense' }), NAMES, 3).reading).toEqual({
      kind: 'account',
      incoming: false,
      recordedAgainst: null,
    });
  });

  it('signs a Transfer against the Account in view — outgoing where it leaves, incoming where it lands', () => {
    const leaving = toAccountRow(
      tx({ direction: 'transfer', accountId: 3, transferToAccountId: 9 }),
      NAMES,
      3,
      ACCOUNT_NAMES,
    );
    const landing = toAccountRow(
      tx({ direction: 'transfer', accountId: 9, transferToAccountId: 3 }),
      NAMES,
      3,
      ACCOUNT_NAMES,
    );

    expect(leaving.reading).toEqual({
      kind: 'account',
      incoming: false,
      recordedAgainst: null,
    });
    expect(landing.reading).toEqual({
      kind: 'account',
      incoming: true,
      recordedAgainst: { id: 9, name: 'Savings' },
    });
  });

  it('leaves recordedAgainst null on the side a Transfer left, and on a plain income or expense', () => {
    const leaving = toAccountRow(
      tx({ direction: 'transfer', accountId: 3, transferToAccountId: 9 }),
      NAMES,
      3,
      ACCOUNT_NAMES,
    );
    const expense = toAccountRow(tx({ direction: 'expense' }), NAMES, 3, ACCOUNT_NAMES);

    expect(leaving.reading).toMatchObject({ recordedAgainst: null });
    expect(expense.reading).toMatchObject({ recordedAgainst: null });
  });

  it('falls back to a stand-in name when the home Account is not in the map', () => {
    const landing = toAccountRow(
      tx({ direction: 'transfer', accountId: 42, transferToAccountId: 3 }),
      NAMES,
      3,
      ACCOUNT_NAMES,
    );

    expect(landing.reading).toMatchObject({
      recordedAgainst: { id: 42, name: 'another account' },
    });
  });
});

describe('toSpanningRow', () => {
  it('resolves the Category name and headline the same way the account reading does', () => {
    const row = toSpanningRow(tx({ categoryId: 2 }), NAMES, ACCOUNT_NAMES);

    expect(row.categoryName).toBe('Salary');
    expect(row.headline).toBe('Salary');
  });

  it('never heads a Transfer with a Category label', () => {
    const row = toSpanningRow(tx({ direction: 'transfer', description: null, categoryId: null }), NAMES, ACCOUNT_NAMES);

    expect(row.headline).toBe('Transfer');
  });

  it('carries a spanning reading with no sign to set', () => {
    const row = toSpanningRow(tx({ direction: 'income' }), NAMES, ACCOUNT_NAMES);

    expect(row.reading.kind).toBe('spanning');
    expect(row.reading).not.toHaveProperty('incoming');
  });

  it('names the row’s own Account on every row', () => {
    const income = toSpanningRow(tx({ direction: 'income', accountId: 9 }), NAMES, ACCOUNT_NAMES);

    expect(income.reading).toEqual({
      kind: 'spanning',
      account: { id: 9, name: 'Savings' },
      transferTo: null,
    });
  });

  it('names both ends of a Transfer as the movement between them', () => {
    const transfer = toSpanningRow(
      tx({
        direction: 'transfer',
        accountId: 3,
        transferToAccountId: 9,
        categoryId: null,
      }),
      NAMES,
      ACCOUNT_NAMES,
    );

    expect(transfer.reading).toEqual({
      kind: 'spanning',
      account: { id: 3, name: 'Everyday cash' },
      transferTo: { id: 9, name: 'Savings' },
    });
  });

  it('falls back to a stand-in name for an Account absent from the map', () => {
    const transfer = toSpanningRow(
      tx({
        direction: 'transfer',
        accountId: 42,
        transferToAccountId: 77,
        categoryId: null,
      }),
      NAMES,
      ACCOUNT_NAMES,
    );

    expect(transfer.reading).toEqual({
      kind: 'spanning',
      account: { id: 42, name: 'another account' },
      transferTo: { id: 77, name: 'another account' },
    });
  });

  it('leaves transferTo null on an income or an expense', () => {
    expect(toSpanningRow(tx({ direction: 'expense' }), NAMES, ACCOUNT_NAMES).reading).toMatchObject({
      transferTo: null,
    });
  });
});

describe('TransactionRow', () => {
  const overlay = withOverlayContainer();

  type LinkedOverrides = {
    deleteContribution?: GoalContributionsService['delete'];
    goalHistory?: GoalContributionsService['list'];
    goal?: GoalsService['get'];
    accounts?: AccountsService['all'];
    split?: TransactionsService['splitLinkedContributions'];
  };

  function renderFixture(
    row: TransactionRowModel,
    remove: TransactionsService['remove'] = () => of(undefined),
    linkedContributions: TransactionsService['linkedContributions'] = () => of(linkedSnapshot()),
    linked: LinkedOverrides = {},
  ) {
    TestBed.configureTestingModule({
      imports: [TransactionRow],
      providers: [
        provideIcons(),
        provideRouter([]),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        {
          provide: TransactionsService,
          useValue: {
            remove,
            linkedContributions,
            splitLinkedContributions: linked.split ?? (() => of({})),
          },
        },
        ContributionDeletionCoordinator,
        {
          provide: GoalContributionsService,
          useValue: {
            delete: linked.deleteContribution ?? (() => of(undefined)),
            list: linked.goalHistory ?? (() => of([])),
          },
        },
        {
          provide: GoalsService,
          useValue: {
            get: linked.goal ?? (() => of({})),
            list: () =>
              of([
                {
                  id: 2,
                  name: 'Emergency fund',
                  targetAmount: 1000,
                  targetDate: null,
                  status: 'Active',
                  currentAmount: 300,
                },
              ]),
          },
        },
        { provide: AccountsService, useValue: { all: linked.accounts ?? (() => of([])) } },
      ],
    });
    const fixture = TestBed.createComponent(TransactionRow);
    fixture.componentRef.setInput('row', row);
    fixture.detectChanges();
    return fixture;
  }

  function renderElement(row: TransactionRowModel) {
    return renderFixture(row).nativeElement as HTMLElement;
  }

  function render(row: TransactionRowModel) {
    return renderElement(row).textContent ?? '';
  }

  /** The ellipsis trigger a row shows when it can be acted on here. */
  function actionsTrigger(host: HTMLElement) {
    return Array.from(host.querySelectorAll('button')).find(
      (b) => b.getAttribute('aria-label') === 'Transaction actions',
    );
  }

  /** Open the row's actions menu and return the menu items now in the overlay. */
  function openMenu(fixture: { nativeElement: unknown; detectChanges(): void }) {
    actionsTrigger(fixture.nativeElement as HTMLElement)?.click();
    fixture.detectChanges();
    return Array.from(overlay().querySelectorAll<HTMLButtonElement>('button'));
  }

  function menuItem(items: HTMLButtonElement[], label: string) {
    return items.find((b) => (b.textContent ?? '').includes(label));
  }

  async function openMenuWithAvailability(fixture: ReturnType<typeof renderFixture>) {
    openMenu(fixture);
    await fixture.whenStable();
    fixture.detectChanges();
    return Array.from(overlay().querySelectorAll<HTMLButtonElement>('button'));
  }

  /** A button anywhere in the row host, matched by exact trimmed text. */
  function rowButton(host: HTMLElement, label: string) {
    return Array.from(host.querySelectorAll('button')).find((b) => (b.textContent ?? '').trim() === label);
  }

  /** Confirm one explicit Transaction removal through the public row controls. */
  async function attemptRemoval(fixture: ReturnType<typeof renderFixture>) {
    menuItem(openMenu(fixture), 'Remove')?.click();
    fixture.detectChanges();
    rowButton(fixture.nativeElement as HTMLElement, 'Remove')?.click();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('progressively reveals every Linked Contribution, including repeated Goals', async () => {
    const fixture = renderFixture(
      toSpanningRow(tx({ id: 42, direction: 'income', amount: 500, categoryId: 2 }), NAMES, ACCOUNT_NAMES),
      () => of(undefined),
      () => of(linkedSnapshot()),
    );
    const host = fixture.nativeElement as HTMLElement;

    rowButton(host, 'Show contributions')?.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(host.textContent).toContain(`${formatPeso(300)} earmarked`);
    expect(host.textContent).toContain(`${formatPeso(200)} remaining`);
    expect(host.querySelectorAll('[data-linked-contribution]').length).toBe(2);
    expect(host.textContent?.match(/Emergency fund/g)?.length).toBe(2);
    expect(host.textContent).toContain('15 Sep 2026');
    expect(host.textContent).toContain('First slice');
    const goalLinks = Array.from(host.querySelectorAll('a')).filter((link) =>
      (link.textContent ?? '').includes('Emergency fund'),
    );
    expect(goalLinks.map((link) => link.getAttribute('href'))).toEqual(['/app/goals/2', '/app/goals/2']);
  });

  it('does not show contribution history when the Transaction has no Linked Contributions', async () => {
    const linkedRead = vi.fn<TransactionsService['linkedContributions']>(() =>
      of({
        ...linkedSnapshot(),
        linkedTotal: 0,
        remainingCapacity: 500,
        linkedContributions: [],
      }),
    );
    const fixture = renderFixture(
      toSpanningRow(tx({ id: 42, direction: 'income', amount: 500, categoryId: 2 }), NAMES, ACCOUNT_NAMES),
      () => of(undefined),
      linkedRead,
    );
    const host = fixture.nativeElement as HTMLElement;

    await fixture.whenStable();
    fixture.detectChanges();

    expect(rowButton(host, 'Show contributions')).toBeUndefined();
    expect(linkedRead).toHaveBeenCalledWith(42);
  });

  it('waits for the initial Linked Contribution snapshot before showing its history control', async () => {
    const pending = new Subject<TransactionLinkedContributions>();
    const fixture = renderFixture(
      toSpanningRow(tx({ id: 42, direction: 'income', amount: 500, categoryId: 2 }), NAMES, ACCOUNT_NAMES),
      () => of(undefined),
      () => pending.asObservable(),
    );
    const host = fixture.nativeElement as HTMLElement;

    expect(rowButton(host, 'Show contributions')).toBeUndefined();

    pending.next(linkedSnapshot());
    pending.complete();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(rowButton(host, 'Show contributions')).toBeDefined();
  });

  it('retries the initial Linked Contribution read after it fails', async () => {
    const linkedRead = vi
      .fn<TransactionsService['linkedContributions']>()
      .mockReturnValueOnce(throwError(() => new ApiError('Contribution history is unavailable.', 503)))
      .mockReturnValueOnce(throwError(() => new ApiError('Contribution history is unavailable.', 503)))
      .mockReturnValueOnce(of(linkedSnapshot()));
    const fixture = renderFixture(
      toSpanningRow(tx({ id: 42, direction: 'income', amount: 500, categoryId: 2 }), NAMES, ACCOUNT_NAMES),
      () => of(undefined),
      linkedRead,
    );
    const host = fixture.nativeElement as HTMLElement;

    rowButton(host, 'Show contributions')?.click();
    fixture.detectChanges();

    expect(host.textContent).toContain('Contribution history is unavailable.');
    rowButton(host, 'Try again')?.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(linkedRead).toHaveBeenCalledTimes(3);
    expect(host.querySelectorAll('[data-linked-contribution]').length).toBe(2);
  });

  it('confirms an individual deletion, disables it while pending, and refreshes every affected fact', async () => {
    const pending = new Subject<void>();
    const removeContribution = vi.fn(() => pending.asObservable());
    const linkedRead = vi
      .fn()
      .mockReturnValueOnce(of(linkedSnapshot()))
      .mockReturnValueOnce(
        of({
          ...linkedSnapshot(),
          linkedTotal: 150,
          remainingCapacity: 350,
          linkedContributions: [linkedSnapshot().linkedContributions[1]],
        }),
      );
    const goal = vi.fn(() =>
      of({
        id: 2,
        name: 'Emergency fund',
        targetAmount: 1000,
        targetDate: null,
        status: 'Active' as const,
        currentAmount: 150,
      }),
    );
    const goalHistory = vi.fn(() => of([]));
    const fixture = renderFixture(
      toSpanningRow(tx({ id: 42, direction: 'income', categoryId: 2 }), NAMES, ACCOUNT_NAMES),
      () => of(undefined),
      linkedRead,
      { deleteContribution: removeContribution, goal, goalHistory },
    );
    const host = fixture.nativeElement as HTMLElement;
    rowButton(host, 'Show contributions')?.click();
    await fixture.whenStable();
    fixture.detectChanges();

    rowButton(host, 'Delete contribution')?.click();
    fixture.detectChanges();
    expect(host.querySelector('[aria-label="Confirm contribution deletion"]')).not.toBeNull();
    expect(removeContribution).not.toHaveBeenCalled();

    rowButton(host, 'Delete')?.click();
    fixture.detectChanges();
    expect(removeContribution).toHaveBeenCalledWith(91);
    expect(rowButton(host, 'Deleting…')?.disabled).toBe(true);
    expect(host.querySelectorAll('[data-linked-contribution]').length).toBe(2);

    pending.next();
    pending.complete();
    await Promise.resolve();
    await Promise.resolve();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(linkedRead).toHaveBeenCalledTimes(2);
    expect(goal).toHaveBeenCalledWith(2);
    expect(goalHistory).toHaveBeenCalledWith(2);
    expect(host.querySelectorAll('[data-linked-contribution]').length).toBe(1);
    expect(host.textContent).toContain(`${formatPeso(350)} remaining`);
    expect(host.textContent).toContain(`${formatPeso(150)} across 0 Contributions`);
  });

  it('keeps an ambiguously deleted row visible until an explicit retry establishes absence', async () => {
    let attempts = 0;
    const removeContribution = vi.fn(() => {
      attempts += 1;
      return throwError(() =>
        attempts === 1
          ? new ApiError('The request timed out.', 504)
          : new GoalContributionUnavailableError(new ApiError('Missing', 404)),
      );
    });
    const linkedRead = vi
      .fn()
      .mockReturnValueOnce(of(linkedSnapshot()))
      .mockReturnValueOnce(
        of({
          ...linkedSnapshot(),
          linkedTotal: 150,
          remainingCapacity: 350,
          linkedContributions: [linkedSnapshot().linkedContributions[1]],
        }),
      );
    const fixture = renderFixture(
      toSpanningRow(tx({ id: 42, direction: 'income', categoryId: 2 }), NAMES, ACCOUNT_NAMES),
      () => of(undefined),
      linkedRead,
      { deleteContribution: removeContribution },
    );
    const host = fixture.nativeElement as HTMLElement;
    rowButton(host, 'Show contributions')?.click();
    await fixture.whenStable();
    fixture.detectChanges();
    rowButton(host, 'Delete contribution')?.click();
    fixture.detectChanges();
    rowButton(host, 'Delete')?.click();
    await Promise.resolve();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(host.textContent).toContain('The request timed out.');
    expect(host.querySelectorAll('[data-linked-contribution]').length).toBe(2);

    rowButton(host, 'Retry deletion')?.click();
    await Promise.resolve();
    await Promise.resolve();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(removeContribution).toHaveBeenCalledTimes(2);
    expect(linkedRead).toHaveBeenCalledTimes(2);
    expect(host.querySelectorAll('[data-linked-contribution]').length).toBe(1);
  });

  it('never retries deletion after a failed facts refresh and keeps stale history until refresh succeeds', async () => {
    const removeContribution = vi.fn(() => of(undefined));
    const refreshed = {
      ...linkedSnapshot(),
      linkedTotal: 150,
      remainingCapacity: 350,
      linkedContributions: [linkedSnapshot().linkedContributions[1]],
    };
    const linkedRead = vi
      .fn()
      .mockReturnValueOnce(of(linkedSnapshot()))
      .mockReturnValueOnce(throwError(() => new ApiError('Refresh failed', 503)))
      .mockReturnValueOnce(of(refreshed));
    const fixture = renderFixture(
      toSpanningRow(tx({ id: 42, direction: 'income', categoryId: 2 }), NAMES, ACCOUNT_NAMES),
      () => of(undefined),
      linkedRead,
      { deleteContribution: removeContribution },
    );
    const host = fixture.nativeElement as HTMLElement;
    rowButton(host, 'Show contributions')?.click();
    await fixture.whenStable();
    fixture.detectChanges();
    rowButton(host, 'Delete contribution')?.click();
    fixture.detectChanges();
    rowButton(host, 'Delete')?.click();
    await Promise.resolve();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(host.textContent).toContain('latest Transaction, Account, and Goal details could not be loaded');
    expect(host.querySelectorAll('[data-linked-contribution]').length).toBe(2);
    expect(removeContribution).toHaveBeenCalledTimes(1);

    rowButton(host, 'Try refresh again')?.click();
    await Promise.resolve();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(removeContribution).toHaveBeenCalledTimes(1);
    expect(linkedRead).toHaveBeenCalledTimes(3);
    expect(host.querySelectorAll('[data-linked-contribution]').length).toBe(1);
  });

  it('shows the date and time, the direction, the Category, and a signed amount', () => {
    const text = render(
      toAccountRow(
        tx({
          amount: 120.5,
          categoryId: 1,
          date: new Date('2026-08-29T14:05:00'),
        }),
        NAMES,
        3,
      ),
    );

    expect(text).toContain('29 Aug 2026');
    expect(text).toContain('2:05');
    expect(text).toContain('PM');
    expect(text).toContain('Expense');
    expect(text).toContain('Groceries');
    expect(text).toContain(formatPeso(-120.5));
  });

  it('marks a generated transaction and shows only its wall-clock day', () => {
    const text = render(
      toAccountRow(
        tx({
          generated: true,
          description: 'Rent',
          date: new Date('2026-08-29T00:00:00'),
        }),
        NAMES,
        3,
      ),
    );

    expect(text).toContain('Generated');
    expect(text).toContain('29 Aug 2026');
    expect(text).not.toContain('12:00');
  });

  it('drops the Category segment for a Transfer', () => {
    const text = render(
      toAccountRow(
        tx({
          direction: 'transfer',
          categoryId: null,
          description: 'Move to savings',
          transferToAccountId: 9,
        }),
        NAMES,
        3,
      ),
    );

    expect(text).toContain('Transfer');
    expect(text).not.toContain('Uncategorised');
  });

  it('names the source Account on a landed Transfer and links to it', () => {
    const host = renderElement(
      toAccountRow(
        tx({
          direction: 'transfer',
          accountId: 9,
          transferToAccountId: 3,
          categoryId: null,
          description: 'Move from savings',
        }),
        NAMES,
        3,
        ACCOUNT_NAMES,
      ),
    );

    expect(host.textContent).toContain('Recorded against');
    const link = Array.from(host.querySelectorAll('a')).find((a) => (a.textContent ?? '').includes('Savings'));
    expect(link?.getAttribute('href')).toBe('/app/accounts/9');
  });

  describe('the spanning reading', () => {
    it('renders an income with a plus', () => {
      const text = render(
        toSpanningRow(tx({ direction: 'income', amount: 1000, categoryId: 2 }), NAMES, ACCOUNT_NAMES),
      );

      expect(text).toContain(`+${formatPeso(1000)}`);
    });

    it('renders an expense with a minus', () => {
      const text = render(toSpanningRow(tx({ direction: 'expense', amount: 250 }), NAMES, ACCOUNT_NAMES));

      expect(text).toContain(formatPeso(-250));
    });

    it('renders a Transfer with neither a plus nor a minus', () => {
      const text = render(
        toSpanningRow(
          tx({
            direction: 'transfer',
            amount: 500,
            accountId: 3,
            transferToAccountId: 9,
            categoryId: null,
          }),
          NAMES,
          ACCOUNT_NAMES,
        ),
      );

      expect(text).toContain(formatPeso(500));
      expect(text).not.toContain(`+${formatPeso(500)}`);
      expect(text).not.toContain(formatPeso(-500));
    });

    it('names the row’s own Account and links to it, without making the row a link', () => {
      const host = renderElement(
        toSpanningRow(tx({ direction: 'expense', accountId: 9, description: 'Coffee' }), NAMES, ACCOUNT_NAMES),
      );

      const link = Array.from(host.querySelectorAll('a')).find((a) => (a.textContent ?? '').includes('Savings'));
      expect(link?.getAttribute('href')).toBe('/app/accounts/9');
      // The row's own element is a list item, not an anchor.
      expect(host.closest('a')).toBeNull();
    });

    it('names both ends of a Transfer, each linking to its Account', () => {
      const host = renderElement(
        toSpanningRow(
          tx({
            direction: 'transfer',
            accountId: 3,
            transferToAccountId: 9,
            categoryId: null,
          }),
          NAMES,
          ACCOUNT_NAMES,
        ),
      );

      const hrefs = Array.from(host.querySelectorAll('a')).map((a) => a.getAttribute('href'));
      expect(hrefs).toContain('/app/accounts/3');
      expect(hrefs).toContain('/app/accounts/9');
      expect(host.textContent).toContain('Everyday cash');
      expect(host.textContent).toContain('Savings');
    });

    it('renders the date, Category, Tags and Generated badge the same as the account reading', () => {
      const text = render(
        toSpanningRow(
          tx({
            direction: 'expense',
            categoryId: 1,
            generated: true,
            description: 'Rent',
            date: new Date('2026-08-29T00:00:00'),
            tags: [{ id: 1, name: 'home' }],
          }),
          NAMES,
          ACCOUNT_NAMES,
        ),
      );

      expect(text).toContain('29 Aug 2026');
      expect(text).toContain('Groceries');
      expect(text).toContain('#home');
      expect(text).toContain('Generated');
    });

    it('still offers no whole-row link and keeps the actions menu in place', () => {
      const fixture = renderFixture(toSpanningRow(tx({ direction: 'expense' }), NAMES, ACCOUNT_NAMES));

      expect(actionsTrigger(fixture.nativeElement as HTMLElement)).toBeDefined();
    });
  });

  describe('the actions menu', () => {
    it('offers Refile and Remove behind an ellipsis on an expense', () => {
      const fixture = renderFixture(toAccountRow(tx(), NAMES, 3));

      const items = openMenu(fixture);
      expect(menuItem(items, 'Contribute to a Goal')).toBeUndefined();
      expect(menuItem(items, 'Refile')).toBeDefined();
      expect(menuItem(items, 'Remove')).toBeDefined();
    });

    it('offers the menu on an income', () => {
      const fixture = renderFixture(toAccountRow(tx({ direction: 'income', categoryId: 2 }), NAMES, 3));

      expect(actionsTrigger(fixture.nativeElement as HTMLElement)).toBeDefined();
      const items = openMenu(fixture);
      expect(menuItem(items, 'Contribute to a Goal')).toBeDefined();
      expect(menuItem(items, 'Refile')).toBeDefined();
      expect(menuItem(items, 'Remove')).toBeDefined();
    });

    it('offers the menu on a Transfer seen from the side it left', () => {
      const fixture = renderFixture(
        toAccountRow(
          tx({
            direction: 'transfer',
            accountId: 3,
            transferToAccountId: 9,
            categoryId: null,
          }),
          NAMES,
          3,
          ACCOUNT_NAMES,
        ),
      );

      expect(actionsTrigger(fixture.nativeElement as HTMLElement)).toBeDefined();
      expect(menuItem(openMenu(fixture), 'Contribute to a Goal')).toBeUndefined();
    });

    it('offers contribution creation on generated income', () => {
      const fixture = renderFixture(
        toAccountRow(tx({ direction: 'income', categoryId: 2, generated: true, description: 'Salary' }), NAMES, 3),
      );

      const items = openMenu(fixture);
      expect(menuItem(items, 'Contribute to a Goal')).toBeDefined();
      expect(menuItem(items, 'Refile')).toBeDefined();
      expect(menuItem(items, 'Remove')).toBeDefined();
    });

    it.each([
      {
        snapshot: { ...linkedSnapshot(), remainingCapacity: 0 },
        explanation: 'This Transaction has no remaining capacity',
      },
      {
        snapshot: {
          ...linkedSnapshot(),
          account: { ...linkedSnapshot().account, availableHeadroom: 0 },
        },
        explanation: 'This Account has no available headroom',
      },
      {
        snapshot: {
          ...linkedSnapshot(),
          account: { ...linkedSnapshot().account, active: false },
        },
        explanation: "The Transaction's Account is retired",
      },
    ])(
      'keeps unavailable contribution creation visible and disabled with its reason',
      async ({ snapshot, explanation }) => {
        const fixture = renderFixture(
          toAccountRow(tx({ direction: 'income', categoryId: 2 }), NAMES, 3),
          () => of(undefined),
          () => of(snapshot),
        );

        const action = menuItem(await openMenuWithAvailability(fixture), 'Contribute to a Goal');

        expect(action).toBeDefined();
        expect(action?.disabled).toBe(true);
        expect(action?.textContent).toContain(explanation);
      },
    );

    it('keeps the newest capacity when overlapping menu reads finish out of order', async () => {
      const older = new Subject<TransactionLinkedContributions>();
      const newer = new Subject<TransactionLinkedContributions>();
      const linkedRead = vi
        .fn()
        .mockReturnValueOnce(of(linkedSnapshot()))
        .mockReturnValueOnce(older)
        .mockReturnValueOnce(newer);
      const fixture = renderFixture(
        toAccountRow(tx({ direction: 'income', categoryId: 2 }), NAMES, 3),
        () => of(undefined),
        linkedRead,
      );

      openMenu(fixture);
      actionsTrigger(fixture.nativeElement as HTMLElement)?.click();
      fixture.detectChanges();
      openMenu(fixture);
      newer.next({ ...linkedSnapshot(), remainingCapacity: 0 });
      newer.complete();
      await fixture.whenStable();
      fixture.detectChanges();
      older.next(linkedSnapshot());
      older.complete();
      await fixture.whenStable();
      fixture.detectChanges();

      const action = menuItem(
        Array.from(overlay().querySelectorAll<HTMLButtonElement>('button')),
        'Contribute to a Goal',
      );
      expect(linkedRead).toHaveBeenCalledTimes(3);
      expect(action?.disabled).toBe(true);
      expect(action?.textContent).toContain('This Transaction has no remaining capacity');
    });

    it('refreshes authoritative Linked Contribution facts after the split dialog confirms', async () => {
      const linkedRead = vi.fn(() => of(linkedSnapshot()));
      const fixture = renderFixture(
        toAccountRow(tx({ direction: 'income', categoryId: 2 }), NAMES, 3),
        () => of(undefined),
        linkedRead,
      );
      const closed = new Subject<boolean>();
      const open = vi.spyOn(TestBed.inject(MatDialog), 'open').mockReturnValue({
        afterClosed: () => closed.asObservable(),
      } as never);

      menuItem(await openMenuWithAvailability(fixture), 'Contribute to a Goal')?.click();
      fixture.detectChanges();
      expect(open).toHaveBeenCalledOnce();
      expect(linkedRead).toHaveBeenCalledTimes(2);

      closed.next(true);
      closed.complete();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(linkedRead).toHaveBeenCalledTimes(3);
      expect(linkedRead).toHaveBeenLastCalledWith(1);
    });

    it('keeps an in-flight split owned by the row after the dialog is dismissed', async () => {
      const pending = new Subject<TransactionSplitResult>();
      const linkedRead = vi.fn(() => of(linkedSnapshot()));
      const fixture = renderFixture(
        toAccountRow(tx({ direction: 'income', categoryId: 2 }), NAMES, 3),
        () => of(undefined),
        linkedRead,
        { split: () => pending.asObservable() },
      );
      menuItem(await openMenuWithAvailability(fixture), 'Contribute to a Goal')?.click();
      await fixture.whenStable();
      fixture.detectChanges();
      const dialog = overlay();
      const goal = dialog.querySelector<HTMLSelectElement>('select[aria-label="Contribution 1 Goal"]')!;
      goal.value = '2';
      goal.dispatchEvent(new Event('input'));
      goal.dispatchEvent(new Event('change'));
      const amount = dialog.querySelector<HTMLInputElement>('input[aria-label="Contribution 1 amount"]')!;
      amount.value = '10';
      amount.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      Array.from(dialog.querySelectorAll('button'))
        .find((button) => button.textContent?.trim() === 'Create contributions')!
        .click();
      fixture.detectChanges();
      expect(linkedRead).toHaveBeenCalledTimes(3);

      dialog.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(overlay().querySelector('[role="dialog"]')).toBeNull();

      pending.next({
        transactionId: 1,
        transactionAmount: 120.5,
        linkedTotal: 10,
        remainingCapacity: 110.5,
        account: linkedSnapshot().account,
        contributions: [],
      });
      pending.complete();

      await vi.waitFor(() => expect(linkedRead).toHaveBeenCalledTimes(5));
      expect(linkedRead).toHaveBeenLastCalledWith(1);
    });

    it('offers no menu at all on a Transfer seen from where it landed', () => {
      const host = renderElement(
        toAccountRow(
          tx({
            direction: 'transfer',
            accountId: 9,
            transferToAccountId: 3,
            categoryId: null,
          }),
          NAMES,
          3,
          ACCOUNT_NAMES,
        ),
      );

      expect(actionsTrigger(host)).toBeUndefined();
      // …and that row still points back to its home Account (ADR 0010).
      expect(host.textContent).toContain('Recorded against');
    });

    it('emits refile when the Refile entry is chosen', () => {
      const fixture = renderFixture(toAccountRow(tx(), NAMES, 3));
      const emitted: unknown[] = [];
      fixture.componentInstance.refile.subscribe(() => emitted.push('refile'));

      menuItem(openMenu(fixture), 'Refile')?.click();

      expect(emitted).toEqual(['refile']);
    });
  });

  describe('removing from the row', () => {
    it('explains a Linked Contribution refusal while every existing row stays visible and unchanged', async () => {
      const snapshot = linkedSnapshot();
      const visibleLinkedContributions: TransactionLinkedContributions = {
        ...snapshot,
        linkedTotal: 450,
        remainingCapacity: 50,
        linkedContributions: [
          ...snapshot.linkedContributions,
          {
            id: 93,
            goalId: 8,
            goalName: 'New laptop',
            accountId: 3,
            transactionId: 42,
            amount: 150,
            contributionDate: new Date(2026, 8, 17),
            note: 'Third slice',
          },
        ],
      };
      const remove = vi.fn(() =>
        throwError(
          () =>
            new TransactionHasLinkedContributionsError(7, [
              { contributionId: 91, goalId: 2, goalName: 'Emergency fund' },
              { contributionId: 92, goalId: 2, goalName: 'Emergency fund' },
              { contributionId: 93, goalId: 8, goalName: 'New laptop' },
            ]),
        ),
      );
      const fixture = renderFixture(
        toAccountRow(tx({ id: 7, direction: 'income', description: 'Payday' }), NAMES, 3),
        remove as unknown as TransactionsService['remove'],
        () => of(visibleLinkedContributions),
      );
      const removed: unknown[] = [];
      fixture.componentInstance.removed.subscribe(() => removed.push('removed'));
      const host = fixture.nativeElement as HTMLElement;

      rowButton(host, 'Show contributions')?.click();
      await fixture.whenStable();
      fixture.detectChanges();
      const contributionsBefore = Array.from(host.querySelectorAll('[data-linked-contribution]')).map(
        (row) => row.textContent,
      );

      await attemptRemoval(fixture);

      const alert = host.querySelector('[role="alert"]');
      expect(host.textContent).toContain(
        'This Transaction contributes to: Emergency fund, New laptop. Delete those Linked Contributions before removing it.',
      );
      expect(host.textContent).toContain('Contribution #91');
      expect(host.textContent).toContain('Contribution #92');
      expect(host.textContent).toContain('Contribution #93');
      expect(
        Array.from(alert?.querySelectorAll('a') ?? []).map((link) => [
          (link.textContent ?? '').trim(),
          link.getAttribute('href'),
        ]),
      ).toEqual([
        ['Emergency fund', '/app/goals/2'],
        ['New laptop', '/app/goals/8'],
      ]);
      expect(host.textContent).toContain('Payday');
      expect(Array.from(host.querySelectorAll('[data-linked-contribution]')).map((row) => row.textContent)).toEqual(
        contributionsBefore,
      );
      expect(removed).toEqual([]);
      expect(rowButton(host, 'Try again')).toBeDefined();
    });

    it('keeps a concurrent-state refusal actionable and never reports successful removal', async () => {
      const remove = vi.fn(() => throwError(() => new TransactionRemovalConcurrentStateError()));
      const fixture = renderFixture(
        toAccountRow(tx({ id: 7, description: 'Payday' }), NAMES, 3),
        remove as unknown as TransactionsService['remove'],
      );
      const removed: unknown[] = [];
      fixture.componentInstance.removed.subscribe(() => removed.push('removed'));

      await attemptRemoval(fixture);

      const host = fixture.nativeElement as HTMLElement;
      expect(host.querySelector('[role="alert"]')?.textContent).toContain(
        'The Transaction changed while removal was being checked. Review it and try again.',
      );
      expect(rowButton(host, 'Try again')).toBeDefined();
      expect(host.textContent).toContain('Payday');
      expect(removed).toEqual([]);
    });

    it('removes successfully after the last Linked Contribution has been deleted', async () => {
      let linkedContributionDeleted = false;
      const remove = vi.fn(() =>
        linkedContributionDeleted
          ? of(undefined)
          : throwError(
              () =>
                new TransactionHasLinkedContributionsError(7, [
                  { contributionId: 91, goalId: 2, goalName: 'Emergency fund' },
                ]),
            ),
      );
      const oneLinkedContribution = {
        ...linkedSnapshot(),
        linkedTotal: 150,
        remainingCapacity: 350,
        linkedContributions: [linkedSnapshot().linkedContributions[0]],
      };
      const noLinkedContributions = {
        ...oneLinkedContribution,
        linkedTotal: 0,
        remainingCapacity: 500,
        linkedContributions: [],
      };
      const linkedRead = vi
        .fn()
        .mockReturnValueOnce(of(oneLinkedContribution))
        .mockReturnValueOnce(of(oneLinkedContribution))
        .mockReturnValueOnce(of(noLinkedContributions));
      const deleteContribution = vi.fn(() => {
        linkedContributionDeleted = true;
        return of(undefined);
      });
      const fixture = renderFixture(
        toAccountRow(tx({ id: 7, direction: 'income', description: 'Payday' }), NAMES, 3),
        remove as unknown as TransactionsService['remove'],
        linkedRead,
        { deleteContribution },
      );
      const removed: unknown[] = [];
      fixture.componentInstance.removed.subscribe(() => removed.push('removed'));
      const host = fixture.nativeElement as HTMLElement;

      rowButton(host, 'Show contributions')?.click();
      await fixture.whenStable();
      fixture.detectChanges();

      await attemptRemoval(fixture);
      expect(removed).toEqual([]);

      rowButton(host, 'Delete contribution')?.click();
      fixture.detectChanges();
      rowButton(host, 'Delete')?.click();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(deleteContribution).toHaveBeenCalledWith(91);
      expect(host.querySelectorAll('[data-linked-contribution]').length).toBe(0);

      rowButton(host, 'Try again')?.click();
      await fixture.whenStable();

      expect(remove).toHaveBeenCalledTimes(2);
      expect(removed).toEqual(['removed']);
    });

    it('asks for confirmation on the row, the Transaction still visible, and sends nothing yet', () => {
      const remove = vi.fn(() => of(undefined));
      const fixture = renderFixture(
        toAccountRow(tx({ amount: 120.5, description: 'Coffee' }), NAMES, 3),
        remove as unknown as TransactionsService['remove'],
      );

      menuItem(openMenu(fixture), 'Remove')?.click();
      fixture.detectChanges();

      const host = fixture.nativeElement as HTMLElement;
      const confirm = host.querySelector('[role="alertdialog"]');
      const labelledBy = confirm?.getAttribute('aria-labelledby');
      expect(labelledBy).toBe('remove-transaction-1');
      expect(host.querySelector(`#${labelledBy}`)?.textContent).toContain('Remove Coffee?');
      expect(host.textContent?.toLowerCase()).toContain('moves the balance back');
      expect(host.textContent).toContain(formatPeso(120.5));
      expect(host.textContent?.toLowerCase()).toContain('can’t be undone');
      // The row it belongs to is still on screen behind the prompt.
      expect(host.textContent).toContain('Coffee');
      expect(remove).not.toHaveBeenCalled();
    });

    it('moves focus to the safe action when removal confirmation opens', async () => {
      const fixture = renderFixture(toAccountRow(tx({ description: 'Coffee' }), NAMES, 3));

      menuItem(openMenu(fixture), 'Remove')?.click();
      fixture.detectChanges();
      await fixture.whenStable();

      expect(document.activeElement).toBe(rowButton(fixture.nativeElement as HTMLElement, 'Keep'));
    });

    it('declining with Keep sends nothing, emits nothing, and restores the row', () => {
      const remove = vi.fn(() => of(undefined));
      const fixture = renderFixture(
        toAccountRow(tx({ description: 'Coffee' }), NAMES, 3),
        remove as unknown as TransactionsService['remove'],
      );
      const removed: unknown[] = [];
      fixture.componentInstance.removed.subscribe(() => removed.push('removed'));

      menuItem(openMenu(fixture), 'Remove')?.click();
      fixture.detectChanges();
      rowButton(fixture.nativeElement as HTMLElement, 'Keep')?.click();
      fixture.detectChanges();

      const host = fixture.nativeElement as HTMLElement;
      expect(host.querySelector('[role="alertdialog"]')).toBeNull();
      expect(host.textContent).toContain('Coffee');
      expect(remove).not.toHaveBeenCalled();
      expect(removed).toEqual([]);
    });

    it('on confirm, removes by id and emits removed', async () => {
      const remove = vi.fn(() => of(undefined));
      const fixture = renderFixture(
        toAccountRow(tx({ id: 7 }), NAMES, 3),
        remove as unknown as TransactionsService['remove'],
      );
      const removed: unknown[] = [];
      fixture.componentInstance.removed.subscribe(() => removed.push('removed'));

      menuItem(openMenu(fixture), 'Remove')?.click();
      fixture.detectChanges();
      rowButton(fixture.nativeElement as HTMLElement, 'Remove')?.click();
      await fixture.whenStable();

      expect(remove).toHaveBeenCalledWith(7);
      expect(removed).toEqual(['removed']);
    });

    it('sends exactly one request when the confirm is pressed twice', async () => {
      const inFlight = new Subject<void>();
      const remove = vi.fn(() => inFlight.asObservable());
      const fixture = renderFixture(
        toAccountRow(tx({ id: 7 }), NAMES, 3),
        remove as unknown as TransactionsService['remove'],
      );

      menuItem(openMenu(fixture), 'Remove')?.click();
      fixture.detectChanges();
      const host = fixture.nativeElement as HTMLElement;
      rowButton(host, 'Remove')?.click();
      rowButton(host, 'Remove')?.click();
      await fixture.whenStable();

      expect(remove).toHaveBeenCalledTimes(1);
      inFlight.next();
      inFlight.complete();
    });

    it('releases removal after an uncertain timeout and offers a read-only refresh', async () => {
      vi.useFakeTimers();
      try {
        let attempts = 0;
        const remove: TransactionsService['remove'] = () => {
          attempts += 1;
          return NEVER;
        };
        const fixture = renderFixture(toAccountRow(tx({ id: 7, description: 'Coffee' }), NAMES, 3), remove);
        const refreshes: unknown[] = [];
        fixture.componentInstance.refreshRequested.subscribe(() => refreshes.push('refresh'));

        void attemptRemoval(fixture);
        await vi.advanceTimersByTimeAsync(15_000);
        await Promise.resolve();
        fixture.detectChanges();

        expect(attempts).toBe(1);
        expect((fixture.nativeElement as HTMLElement).textContent).toContain(
          'couldn’t confirm whether this Transaction was removed',
        );
        rowButton(fixture.nativeElement as HTMLElement, 'Refresh history')?.click();
        expect(refreshes).toEqual(['refresh']);
        expect((fixture.nativeElement as HTMLElement).textContent).toContain(
          'couldn’t confirm whether this Transaction was removed',
        );

        fixture.componentRef.setInput('row', toAccountRow(tx({ id: 7, description: 'Coffee' }), NAMES, 3));
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
        expect((fixture.nativeElement as HTMLElement).textContent).not.toContain(
          'couldn’t confirm whether this Transaction was removed',
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it('pins a notice with Try again on a failed removal, leaves the row, and emits nothing', async () => {
      const remove = vi.fn(() => throwError(() => new ApiError('That could not be removed just now.', 500)));
      const fixture = renderFixture(
        toAccountRow(tx({ id: 7, description: 'Coffee' }), NAMES, 3),
        remove as unknown as TransactionsService['remove'],
      );
      const removed: unknown[] = [];
      fixture.componentInstance.removed.subscribe(() => removed.push('removed'));

      menuItem(openMenu(fixture), 'Remove')?.click();
      fixture.detectChanges();
      rowButton(fixture.nativeElement as HTMLElement, 'Remove')?.click();
      await fixture.whenStable();
      fixture.detectChanges();

      const host = fixture.nativeElement as HTMLElement;
      const alert = host.querySelector('[role="alert"]');
      expect(alert?.textContent).toContain('That could not be removed just now.');
      expect(rowButton(host, 'Try again')).toBeDefined();
      expect(host.textContent).toContain('Coffee');
      expect(removed).toEqual([]);
    });

    it('keeps a Transaction visible and reports no success after its 404 removal response', async () => {
      const remove = vi.fn(() =>
        throwError(() => new ApiError("We couldn't find that. It may have been deleted, or it may not be yours.", 404)),
      );
      const fixture = renderFixture(
        toAccountRow(tx({ id: 7, description: 'Coffee' }), NAMES, 3),
        remove as unknown as TransactionsService['remove'],
      );
      const removed: unknown[] = [];
      fixture.componentInstance.removed.subscribe(() => removed.push('removed'));

      menuItem(openMenu(fixture), 'Remove')?.click();
      fixture.detectChanges();
      rowButton(fixture.nativeElement as HTMLElement, 'Remove')?.click();
      await fixture.whenStable();
      fixture.detectChanges();

      const host = fixture.nativeElement as HTMLElement;
      expect(host.querySelector('[role="alert"]')?.textContent).toContain("We couldn't find that.");
      expect(rowButton(host, 'Try again')).toBeDefined();
      expect(host.textContent).toContain('Coffee');
      expect(removed).toEqual([]);
    });

    it('falls back to a generic notice when a failed removal is not an ApiError', async () => {
      const remove = vi.fn(() => throwError(() => new Error('offline')));
      const fixture = renderFixture(
        toAccountRow(tx({ id: 7 }), NAMES, 3),
        remove as unknown as TransactionsService['remove'],
      );

      menuItem(openMenu(fixture), 'Remove')?.click();
      fixture.detectChanges();
      rowButton(fixture.nativeElement as HTMLElement, 'Remove')?.click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect((fixture.nativeElement as HTMLElement).querySelector('[role="alert"]')?.textContent).toContain(
        'Something went wrong removing this transaction',
      );
    });

    it('retries the removal from Try again and, on success, emits removed', async () => {
      let attempt = 0;
      const remove = vi.fn(() => {
        attempt += 1;
        return attempt === 1 ? throwError(() => new ApiError('Try later.', 500)) : of(undefined);
      });
      const fixture = renderFixture(
        toAccountRow(tx({ id: 7 }), NAMES, 3),
        remove as unknown as TransactionsService['remove'],
      );
      const removed: unknown[] = [];
      fixture.componentInstance.removed.subscribe(() => removed.push('removed'));

      menuItem(openMenu(fixture), 'Remove')?.click();
      fixture.detectChanges();
      rowButton(fixture.nativeElement as HTMLElement, 'Remove')?.click();
      await fixture.whenStable();
      fixture.detectChanges();

      rowButton(fixture.nativeElement as HTMLElement, 'Try again')?.click();
      await fixture.whenStable();

      expect(remove).toHaveBeenCalledTimes(2);
      expect(removed).toEqual(['removed']);
    });
  });

  it('renders the Tags on a Transaction', () => {
    const text = render(
      toAccountRow(
        tx({
          description: 'Lunch',
          tags: [
            { id: 1, name: 'work' },
            { id: 2, name: 'reimbursable' },
          ],
        }),
        NAMES,
        3,
      ),
    );

    expect(text).toContain('#work');
    expect(text).toContain('#reimbursable');
  });
});
