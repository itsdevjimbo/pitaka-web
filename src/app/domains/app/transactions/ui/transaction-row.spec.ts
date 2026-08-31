import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { provideRouter } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { provideIcons } from '@/app/core/icons';
import { formatPeso } from '@/app/core/money';
import { withOverlayContainer } from '@/testing/overlay';
import { Transaction } from '../data/transaction';
import { TransactionsService } from '../data/transactions.service';
import {
  TransactionRow,
  TransactionRowModel,
  toTransactionRow,
} from './transaction-row';

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

/**
 * The pure builder that turns a domain {@link Transaction} into the finished
 * row: it resolves the Category name through the caller's shared cache, chooses
 * the headline, and signs the amount against the Account in view.
 */
describe('toTransactionRow', () => {
  it('resolves the Category name from the shared cache', () => {
    expect(toTransactionRow(tx({ categoryId: 2 }), NAMES, 3).categoryName).toBe(
      'Salary'
    );
  });

  it('labels an uncategorised income or expense rather than leaving it blank', () => {
    expect(
      toTransactionRow(tx({ categoryId: null }), NAMES, 3).categoryName
    ).toBe('Uncategorised');
    expect(
      toTransactionRow(tx({ categoryId: 999 }), NAMES, 3).categoryName
    ).toBe('Uncategorised');
  });

  it('heads a row with its note when it has one', () => {
    expect(
      toTransactionRow(tx({ description: 'Coffee' }), NAMES, 3).headline
    ).toBe('Coffee');
  });

  it('falls back to the Category for an un-noted income or expense', () => {
    expect(
      toTransactionRow(tx({ description: null, categoryId: 1 }), NAMES, 3)
        .headline
    ).toBe('Groceries');
  });

  it('never heads a Transfer with a Category label, even with no note', () => {
    const row = toTransactionRow(
      tx({ direction: 'transfer', description: null, categoryId: null }),
      NAMES,
      3
    );

    expect(row.headline).toBe('Transfer');
  });

  it('signs income as incoming and expense as outgoing', () => {
    expect(
      toTransactionRow(tx({ direction: 'income' }), NAMES, 3).incoming
    ).toBe(true);
    expect(
      toTransactionRow(tx({ direction: 'expense' }), NAMES, 3).incoming
    ).toBe(false);
  });

  it('signs a Transfer against the Account in view — outgoing where it leaves, incoming where it lands', () => {
    const leaving = toTransactionRow(
      tx({ direction: 'transfer', accountId: 3, transferToAccountId: 9 }),
      NAMES,
      3
    );
    const landing = toTransactionRow(
      tx({ direction: 'transfer', accountId: 9, transferToAccountId: 3 }),
      NAMES,
      3
    );

    expect(leaving.incoming).toBe(false);
    expect(landing.incoming).toBe(true);
  });

  it('names the Account a landed Transfer was recorded against, for a link back (ADR 0010)', () => {
    const landing = toTransactionRow(
      tx({ direction: 'transfer', accountId: 9, transferToAccountId: 3 }),
      NAMES,
      3,
      ACCOUNT_NAMES
    );

    expect(landing.recordedAgainst).toEqual({ id: 9, name: 'Savings' });
  });

  it('leaves recordedAgainst null on the side a Transfer left, and on a plain income or expense', () => {
    const leaving = toTransactionRow(
      tx({ direction: 'transfer', accountId: 3, transferToAccountId: 9 }),
      NAMES,
      3,
      ACCOUNT_NAMES
    );
    const expense = toTransactionRow(tx({ direction: 'expense' }), NAMES, 3, ACCOUNT_NAMES);

    expect(leaving.recordedAgainst).toBeNull();
    expect(expense.recordedAgainst).toBeNull();
  });

  it('falls back to a stand-in name when the home Account is not in the map', () => {
    const landing = toTransactionRow(
      tx({ direction: 'transfer', accountId: 42, transferToAccountId: 3 }),
      NAMES,
      3,
      ACCOUNT_NAMES
    );

    expect(landing.recordedAgainst).toEqual({ id: 42, name: 'another account' });
  });
});

describe('TransactionRow', () => {
  const overlay = withOverlayContainer();

  function renderFixture(
    row: TransactionRowModel,
    remove: TransactionsService['remove'] = () => of(undefined)
  ) {
    TestBed.configureTestingModule({
      imports: [TransactionRow],
      providers: [
        provideIcons(),
        provideRouter([]),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        { provide: TransactionsService, useValue: { remove } },
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
      (b) => b.getAttribute('aria-label') === 'Transaction actions'
    );
  }

  /** Open the row's actions menu and return the menu items now in the overlay. */
  function openMenu(fixture: {
    nativeElement: unknown;
    detectChanges(): void;
  }) {
    actionsTrigger(fixture.nativeElement as HTMLElement)?.click();
    fixture.detectChanges();
    return Array.from(overlay().querySelectorAll<HTMLButtonElement>('button'));
  }

  function menuItem(items: HTMLButtonElement[], label: string) {
    return items.find((b) => (b.textContent ?? '').trim() === label);
  }

  /** A button anywhere in the row host, matched by exact trimmed text. */
  function rowButton(host: HTMLElement, label: string) {
    return Array.from(host.querySelectorAll('button')).find(
      (b) => (b.textContent ?? '').trim() === label
    );
  }

  it('shows the date and time, the direction, the Category, and a signed amount', () => {
    const text = render(
      toTransactionRow(
        tx({
          amount: 120.5,
          categoryId: 1,
          date: new Date('2026-08-29T14:05:00'),
        }),
        NAMES,
        3
      )
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
      toTransactionRow(
        tx({
          generated: true,
          description: 'Rent',
          date: new Date('2026-08-29T00:00:00'),
        }),
        NAMES,
        3
      )
    );

    expect(text).toContain('Generated');
    expect(text).toContain('29 Aug 2026');
    expect(text).not.toContain('12:00');
  });

  it('drops the Category segment for a Transfer', () => {
    const text = render(
      toTransactionRow(
        tx({
          direction: 'transfer',
          categoryId: null,
          description: 'Move to savings',
          transferToAccountId: 9,
        }),
        NAMES,
        3
      )
    );

    expect(text).toContain('Transfer');
    expect(text).not.toContain('Uncategorised');
  });

  it('names the source Account on a landed Transfer and links to it', () => {
    const host = renderElement(
      toTransactionRow(
        tx({
          direction: 'transfer',
          accountId: 9,
          transferToAccountId: 3,
          categoryId: null,
          description: 'Move from savings',
        }),
        NAMES,
        3,
        ACCOUNT_NAMES
      )
    );

    expect(host.textContent).toContain('Recorded against');
    const link = Array.from(host.querySelectorAll('a')).find((a) =>
      (a.textContent ?? '').includes('Savings')
    );
    expect(link?.getAttribute('href')).toBe('/app/accounts/9');
  });

  describe('the actions menu', () => {
    it('offers Refile and Remove behind an ellipsis on an expense', () => {
      const fixture = renderFixture(toTransactionRow(tx(), NAMES, 3));

      const items = openMenu(fixture);
      expect(menuItem(items, 'Refile')).toBeDefined();
      expect(menuItem(items, 'Remove')).toBeDefined();
    });

    it('offers the menu on an income', () => {
      const fixture = renderFixture(
        toTransactionRow(tx({ direction: 'income', categoryId: 2 }), NAMES, 3)
      );

      expect(
        actionsTrigger(fixture.nativeElement as HTMLElement)
      ).toBeDefined();
      const items = openMenu(fixture);
      expect(menuItem(items, 'Refile')).toBeDefined();
      expect(menuItem(items, 'Remove')).toBeDefined();
    });

    it('offers the menu on a Transfer seen from the side it left', () => {
      const fixture = renderFixture(
        toTransactionRow(
          tx({
            direction: 'transfer',
            accountId: 3,
            transferToAccountId: 9,
            categoryId: null,
          }),
          NAMES,
          3,
          ACCOUNT_NAMES
        )
      );

      expect(
        actionsTrigger(fixture.nativeElement as HTMLElement)
      ).toBeDefined();
    });

    it('offers the same actions on a generated transaction', () => {
      const fixture = renderFixture(
        toTransactionRow(
          tx({ generated: true, description: 'Rent' }),
          NAMES,
          3
        )
      );

      const items = openMenu(fixture);
      expect(menuItem(items, 'Refile')).toBeDefined();
      expect(menuItem(items, 'Remove')).toBeDefined();
    });

    it('offers no menu at all on a Transfer seen from where it landed', () => {
      const host = renderElement(
        toTransactionRow(
          tx({
            direction: 'transfer',
            accountId: 9,
            transferToAccountId: 3,
            categoryId: null,
          }),
          NAMES,
          3,
          ACCOUNT_NAMES
        )
      );

      expect(actionsTrigger(host)).toBeUndefined();
      // …and that row still points back to its home Account (ADR 0010).
      expect(host.textContent).toContain('Recorded against');
    });

    it('emits refile when the Refile entry is chosen', () => {
      const fixture = renderFixture(toTransactionRow(tx(), NAMES, 3));
      const emitted: unknown[] = [];
      fixture.componentInstance.refile.subscribe(() => emitted.push('refile'));

      menuItem(openMenu(fixture), 'Refile')?.click();

      expect(emitted).toEqual(['refile']);
    });
  });

  describe('removing from the row', () => {
    it('asks for confirmation on the row, the Transaction still visible, and sends nothing yet', () => {
      const remove = vi.fn(() => of(undefined));
      const fixture = renderFixture(
        toTransactionRow(
          tx({ amount: 120.5, description: 'Coffee' }),
          NAMES,
          3
        ),
        remove as unknown as TransactionsService['remove']
      );

      menuItem(openMenu(fixture), 'Remove')?.click();
      fixture.detectChanges();

      const host = fixture.nativeElement as HTMLElement;
      const confirm = host.querySelector('[role="alertdialog"]');
      expect(confirm?.getAttribute('aria-label')).toBe('Confirm remove');
      expect(host.textContent?.toLowerCase()).toContain('moves the balance back');
      expect(host.textContent).toContain(formatPeso(120.5));
      expect(host.textContent?.toLowerCase()).toContain('can’t be undone');
      // The row it belongs to is still on screen behind the prompt.
      expect(host.textContent).toContain('Coffee');
      expect(remove).not.toHaveBeenCalled();
    });

    it('declining with Keep sends nothing, emits nothing, and restores the row', () => {
      const remove = vi.fn(() => of(undefined));
      const fixture = renderFixture(
        toTransactionRow(tx({ description: 'Coffee' }), NAMES, 3),
        remove as unknown as TransactionsService['remove']
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
        toTransactionRow(tx({ id: 7 }), NAMES, 3),
        remove as unknown as TransactionsService['remove']
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
        toTransactionRow(tx({ id: 7 }), NAMES, 3),
        remove as unknown as TransactionsService['remove']
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

    it('pins a notice with Try again on a failed removal, leaves the row, and emits nothing', async () => {
      const remove = vi.fn(() =>
        throwError(() => new ApiError('That could not be removed just now.', 500))
      );
      const fixture = renderFixture(
        toTransactionRow(tx({ id: 7, description: 'Coffee' }), NAMES, 3),
        remove as unknown as TransactionsService['remove']
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

    it('falls back to a generic notice when a failed removal is not an ApiError', async () => {
      const remove = vi.fn(() => throwError(() => new Error('offline')));
      const fixture = renderFixture(
        toTransactionRow(tx({ id: 7 }), NAMES, 3),
        remove as unknown as TransactionsService['remove']
      );

      menuItem(openMenu(fixture), 'Remove')?.click();
      fixture.detectChanges();
      rowButton(fixture.nativeElement as HTMLElement, 'Remove')?.click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(
        (fixture.nativeElement as HTMLElement).querySelector('[role="alert"]')
          ?.textContent
      ).toContain('Something went wrong removing this transaction');
    });

    it('retries the removal from Try again and, on success, emits removed', async () => {
      let attempt = 0;
      const remove = vi.fn(() => {
        attempt += 1;
        return attempt === 1
          ? throwError(() => new ApiError('Try later.', 500))
          : of(undefined);
      });
      const fixture = renderFixture(
        toTransactionRow(tx({ id: 7 }), NAMES, 3),
        remove as unknown as TransactionsService['remove']
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
      toTransactionRow(
        tx({
          description: 'Lunch',
          tags: [
            { id: 1, name: 'work' },
            { id: 2, name: 'reimbursable' },
          ],
        }),
        NAMES,
        3
      )
    );

    expect(text).toContain('#work');
    expect(text).toContain('#reimbursable');
  });
});
