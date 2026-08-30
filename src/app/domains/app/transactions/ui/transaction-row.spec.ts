import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideIcons } from '@/app/core/icons';
import { formatPeso } from '@/app/core/money';
import { Transaction } from '../data/transaction';
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
  function renderElement(row: TransactionRowModel) {
    TestBed.configureTestingModule({
      imports: [TransactionRow],
      providers: [provideIcons(), provideRouter([])],
    });
    const fixture = TestBed.createComponent(TransactionRow);
    fixture.componentRef.setInput('row', row);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  function render(row: TransactionRowModel) {
    return renderElement(row).textContent ?? '';
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
