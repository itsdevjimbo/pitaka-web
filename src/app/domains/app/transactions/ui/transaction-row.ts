import { DatePipe } from '@angular/common';
import { Component, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { PesoPipe } from '@/app/core/money';
import { Transaction, TRANSACTION_DIRECTIONS } from '../data/transaction';

/** Shown for an income or expense the person never filed under a Category. */
const NO_CATEGORY = 'Uncategorised';

/** Stand-in when a Transfer's home Account is not in the caller's name map. */
const UNNAMED_ACCOUNT = 'another account';

/** No account names — the default when a caller has none to resolve against. */
const NO_ACCOUNT_NAMES: ReadonlyMap<number, string> = new Map();

/**
 * A {@link Transaction} with the three fields the row template needs on top of
 * the domain shape: `categoryName` for the meta line, `headline` for the main
 * line — its note if it has one, otherwise what it is (a Transfer, or its
 * Category) — and `incoming`, whether the amount adds to the Account in view
 * (income, or a Transfer landing here) or subtracts from it, so the row can be
 * signed.
 */
export type TransactionRowModel = Transaction & {
  categoryName: string;
  headline: string;
  incoming: boolean;

  /**
   * For a Transfer seen from the Account it landed in: the Account it was
   * recorded against — its home — to name on the row and link back to, since a
   * Transfer can only be re-filed or removed there (ADR 0010). `null` for every
   * other row, including a Transfer seen from the side it left.
   */
  recordedAgainst: { id: number; name: string } | null;
};

/**
 * One Transaction as a row in an Account's list: the direction carried by an
 * icon and a colour as much as a word, the date in the person's own timezone
 * (ADR 0007), the Category, the amount signed against the Account in view, its
 * Tags, and a "Generated" badge when a Schedule created it.
 *
 * The Transactions domain owns this row. A screen that shows it resolves the
 * Category names and picks the Account to sign against — with {@link
 * toTransactionRow} — then hands over a finished {@link TransactionRowModel}.
 * The dependency runs one way: nothing here reaches back into Accounts.
 */
@Component({
  selector: 'li[transaction-row]',
  templateUrl: './transaction-row.html',
  imports: [DatePipe, MatIconModule, PesoPipe, RouterLink],
  host: {
    class:
      'flex flex-col gap-y-2 rounded-xl border border-neutral-200 px-4 py-3 dark:border-neutral-800',
  },
})
export class TransactionRow {
  /** The finished row: domain fields plus resolved Category, headline, and sign. */
  readonly row = input.required<TransactionRowModel>();

  protected readonly directions = TRANSACTION_DIRECTIONS;
}

/**
 * Build the row an Account's list renders: resolve the Category name through the
 * caller's shared cache, choose the headline, and sign the amount against the
 * Account in view.
 *
 * A Transfer is signed against a single Account (ADR 0010): it adds where the
 * money lands — this Account is its destination — and subtracts where it leaves.
 * The rule needs an Account in view, which every screen rendering a Transaction
 * today has. Seen from the landing side, the row also names the Account the
 * Transfer was recorded against and links there; `accountNames` resolves that
 * name the way `categoryNames` resolves a Category's.
 */
export function toTransactionRow(
  transaction: Transaction,
  categoryNames: ReadonlyMap<number, string>,
  viewedAccountId: number,
  accountNames: ReadonlyMap<number, string> = NO_ACCOUNT_NAMES
): TransactionRowModel {
  const resolved =
    transaction.categoryId === null
      ? null
      : (categoryNames.get(transaction.categoryId) ?? null);
  const categoryName = resolved ?? NO_CATEGORY;

  const isTransfer = transaction.direction === 'transfer';

  // A Transfer has no Category, so never let "Uncategorised" head its row.
  const headline =
    transaction.description ||
    (isTransfer ? TRANSACTION_DIRECTIONS.transfer.label : categoryName);

  const landedHere =
    isTransfer && transaction.transferToAccountId === viewedAccountId;

  const incoming = transaction.direction === 'income' || landedHere;

  // Only on the landing side: `accountId` is the Transfer's home, the one place
  // it can be acted on. The row points there.
  const recordedAgainst = landedHere
    ? {
        id: transaction.accountId,
        name: accountNames.get(transaction.accountId) ?? UNNAMED_ACCOUNT,
      }
    : null;

  return { ...transaction, categoryName, headline, incoming, recordedAgainst };
}
