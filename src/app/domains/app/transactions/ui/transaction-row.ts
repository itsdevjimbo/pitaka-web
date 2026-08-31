import { DatePipe } from '@angular/common';
import {
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { PesoPipe } from '@/app/core/money';
import { RowNotice } from '@/app/core/notices';
import { Transaction, TRANSACTION_DIRECTIONS } from '../data/transaction';
import { TransactionsService } from '../data/transactions.service';

/** The banner line for a removal that failed with nothing more specific to say. */
const COULD_NOT_REMOVE =
  'Something went wrong removing this transaction. Please try again.';

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
   * Transfer can only be acted on there (ADR 0010). `null` for every other row,
   * including a Transfer seen from the side it left.
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
 *
 * The row's actions sit behind an ellipsis menu — the same affordance an
 * Account row uses — holding *Refile* and *Remove*. Refile asks the screen to
 * swap the row for the inline form. Remove is destructive, so it never sits
 * inside that editor (ADR 0014): it is confirmed on the row itself, with the
 * amount and date still visible behind the prompt, and only then does the row
 * send the delete and, on success, tell the screen to re-read the balance and
 * list (ADR 0006). A removal the server rejects pins a notice to the row with
 * a "Try again" and leaves the row exactly where it was.
 */
@Component({
  selector: 'li[transaction-row]',
  templateUrl: './transaction-row.html',
  imports: [
    DatePipe,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    PesoPipe,
    RouterLink,
    RowNotice,
  ],
  host: {
    class:
      'flex flex-col gap-y-2 rounded-xl border border-neutral-200 px-4 py-3 dark:border-neutral-800',
  },
})
export class TransactionRow {
  private service = inject(TransactionsService);

  /** The finished row: domain fields plus resolved Category, headline, and sign. */
  readonly row = input.required<TransactionRowModel>();

  /** Asks the screen to swap this row for the refile form. */
  readonly refile = output<void>();

  /**
   * The Transaction was removed. The row is gone and the balance has moved back
   * by exactly what moved; the screen re-reads both from the server (ADR 0006).
   */
  readonly removed = output<void>();

  protected readonly directions = TRANSACTION_DIRECTIONS;

  /**
   * Whether this row can be acted on here at all — the single condition both
   * menu entries and the menu itself hang off, so ADR 0010's placement rule
   * lives in one place. A Transaction is acted on where it was recorded: a
   * Transfer seen from the Account it landed in (`recordedAgainst` set) is
   * read-only there and links back to its home instead. Every other row — an
   * income, an expense, a Transfer seen from the side it left, a generated
   * transaction — offers the full menu in place.
   */
  protected readonly canActOnHere = computed(
    () => this.row().recordedAgainst === null
  );

  /**
   * True once *Remove* has been chosen and the inline confirmation is showing.
   * Nothing has been sent — dismissing it undoes the choice and the balance has
   * not moved. Cleared the moment the confirmation is accepted, the way an
   * Account row clears its own delete confirmation on confirm.
   */
  protected readonly confirmingRemove = signal(false);

  /** True while the delete request is in flight — guards a double confirm. */
  protected readonly removing = signal(false);

  /**
   * The line a failed removal pins to the row, or `null`. Set means the delete
   * was rejected: a notice offers *Try again* and the row stays on screen,
   * matching how an Account row surfaces a failed lifecycle action.
   */
  protected readonly removeError = signal<string | null>(null);

  /** Reveal the inline confirmation. Sends nothing — the balance stays put. */
  protected askRemove(): void {
    this.removeError.set(null);
    this.confirmingRemove.set(true);
  }

  /** Dismiss the confirmation with nothing removed; leave the row as it was. */
  protected cancelRemove(): void {
    this.confirmingRemove.set(false);
  }

  /**
   * The confirmation was accepted: close it and send the delete. On success the
   * screen re-reads the balance and list (ADR 0006) — the API has moved the
   * balance back by exactly what moved. On failure a notice explains, the row is
   * left in place, and its *Try again* re-runs this.
   */
  protected async confirmRemove(): Promise<void> {
    if (this.removing()) {
      return;
    }
    this.removing.set(true);
    this.confirmingRemove.set(false);
    this.removeError.set(null);

    try {
      await firstValueFrom(this.service.remove(this.row().id));
      this.removed.emit();
    } catch (error) {
      this.removeError.set(
        error instanceof ApiError ? error.message : COULD_NOT_REMOVE
      );
    } finally {
      this.removing.set(false);
    }
  }
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
