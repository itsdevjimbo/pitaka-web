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

/** An Account reduced to what a row shows for it: an id to link to, a name. */
type NamedAccount = { id: number; name: string };

/** Whether a Transaction is a Transfer — the check the two builders share. */
function isTransfer(transaction: Transaction): boolean {
  return transaction.direction === 'transfer';
}

/**
 * How a Transaction row is being read — the decision that fixes what its sign
 * means and which Account, if any, it names. One row component renders either;
 * a screen picks the reading by calling {@link toAccountRow} or {@link
 * toSpanningRow}, never by passing a flag.
 *
 * `account` — an Account is in view (Account detail). The amount is signed
 * against it: `incoming` is `true` where the money adds (an income, or a
 * Transfer landing here) and `false` where it subtracts. Where a Transfer
 * landed, `recordedAgainst` names the Account it was recorded against — its
 * home — to link back to, the one place it can be acted on (ADR 0010); it is
 * `null` for every other row, including a Transfer seen from the side it left.
 *
 * `spanning` — no Account is in view (a list spanning every Account). There is no
 * `incoming` field because the sign is derivable and nothing should be able to
 * set it: an income adds, an expense subtracts, and a Transfer is neither
 * incoming nor outgoing — it reads as the movement between its two ends
 * (ADR 0010). `account` names this row's own Account, always; `transferTo`
 * names the far end of a Transfer, and is `null` on an income or an expense.
 */
export type TransactionRowReading =
  | { kind: 'account'; incoming: boolean; recordedAgainst: NamedAccount | null }
  | { kind: 'spanning'; account: NamedAccount; transferTo: NamedAccount | null };

/**
 * A {@link Transaction} with the three fields the row template needs on top of
 * the domain shape: `categoryName` for the meta line, `headline` for the main
 * line — its note if it has one, otherwise what it is (a Transfer, or its
 * Category) — and a discriminated {@link TransactionRowReading} that carries the
 * sign and the Account names, resolved for whichever of the two ways the row is
 * being read.
 */
export type TransactionRowModel = Transaction & {
  categoryName: string;
  headline: string;
  reading: TransactionRowReading;
};

/**
 * One Transaction as a row: the direction carried by an icon and a colour as
 * much as a word, the date in the person's own timezone (ADR 0007), the
 * Category, the amount signed for whichever {@link TransactionRowReading} the row carries, its
 * Tags, and a "Generated" badge when a Schedule created it.
 *
 * The Transactions domain owns this row. A screen that shows it resolves the
 * Category and Account names and picks the reading — {@link toAccountRow} where
 * an Account is in view, {@link toSpanningRow} where none is — then hands over a
 * finished {@link TransactionRowModel}. The dependency runs one way: nothing
 * here reaches back into Accounts.
 *
 * The row's actions sit behind an ellipsis menu — the same affordance an
 * Account row uses — holding *Refile* and *Remove*. Refile asks the screen to
 * open the refile dialog over it. Remove is destructive, so it never sits
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

  /** Asks the screen to open the refile dialog for this Transaction. */
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
   * lives in one place. A Transaction is acted on where it was recorded: under
   * the account reading, a Transfer seen from the Account it landed in
   * (`recordedAgainst` set) is read-only there and links back to its home
   * instead. Every other row — an income, an expense, a Transfer seen from the
   * side it left, a generated transaction — offers the full menu in place.
   * Under the spanning reading the row always names its Transaction's home
   * Account (ADR 0010), so the menu is always in place there.
   */
  protected readonly canActOnHere = computed(() => {
    const reading = this.row().reading;
    return reading.kind === 'spanning' || reading.recordedAgainst === null;
  });

  /**
   * The sign the amount renders with: a plus where the money adds, a minus
   * where it subtracts, and neither for a Transfer read with no Account in
   * view. Under the account reading the sign is `incoming`, already resolved
   * against the Account on screen. Under the spanning reading it comes from the
   * direction — an income adds, an expense subtracts, a Transfer is neither
   * (ADR 0010).
   */
  protected readonly amountSign = computed<'plus' | 'minus' | 'none'>(() => {
    const reading = this.row().reading;
    if (reading.kind === 'account') {
      return reading.incoming ? 'plus' : 'minus';
    }
    switch (this.row().direction) {
      case 'income':
        return 'plus';
      case 'expense':
        return 'minus';
      case 'transfer':
        return 'none';
    }
  });

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
 * The part of a row that is the same whichever way it is read: the Category name
 * resolved through the caller's shared cache, and the headline — the note if
 * there is one, otherwise what the Transaction is. A Transfer has no Category,
 * so "Uncategorised" never heads its row.
 */
function baseRow(
  transaction: Transaction,
  categoryNames: ReadonlyMap<number, string>
): { categoryName: string; headline: string } {
  const resolved =
    transaction.categoryId === null
      ? null
      : (categoryNames.get(transaction.categoryId) ?? null);
  const categoryName = resolved ?? NO_CATEGORY;

  const headline =
    transaction.description ||
    (isTransfer(transaction)
      ? TRANSACTION_DIRECTIONS.transfer.label
      : categoryName);

  return { categoryName, headline };
}

/** An Account's id and name, or a stand-in name when the id is not in the map. */
function nameAccount(
  id: number,
  accountNames: ReadonlyMap<number, string>
): NamedAccount {
  return { id, name: accountNames.get(id) ?? UNNAMED_ACCOUNT };
}

/**
 * Build a row for a screen with an Account in view — Account detail. The amount
 * is signed against that Account: a Transfer adds where the money lands (this
 * Account is its destination) and subtracts where it leaves (ADR 0010). Seen
 * from the landing side, the row also names the Account the Transfer was
 * recorded against and links there — the one place it can be acted on;
 * `accountNames` resolves that name the way `categoryNames` resolves a
 * Category's.
 */
export function toAccountRow(
  transaction: Transaction,
  categoryNames: ReadonlyMap<number, string>,
  viewedAccountId: number,
  accountNames: ReadonlyMap<number, string> = NO_ACCOUNT_NAMES
): TransactionRowModel {
  const landedHere =
    isTransfer(transaction) &&
    transaction.transferToAccountId === viewedAccountId;

  const incoming = transaction.direction === 'income' || landedHere;

  // Only on the landing side: `accountId` is the Transfer's home, the one place
  // it can be acted on. The row points there.
  const recordedAgainst = landedHere
    ? nameAccount(transaction.accountId, accountNames)
    : null;

  return {
    ...transaction,
    ...baseRow(transaction, categoryNames),
    reading: { kind: 'account', incoming, recordedAgainst },
  };
}

/**
 * Build a row for a screen with no Account in view — a list spanning every
 * Account. No amount is signed against a viewpoint: the row derives its sign
 * from the direction (ADR 0010). Every row names its own Account, and a Transfer
 * names both ends — the movement from the one it leaves to the one it lands in.
 * `accountNames` is required, not optional: the spanning reading always names an
 * Account, so a caller with no names to resolve against would render every row
 * as "another account".
 */
export function toSpanningRow(
  transaction: Transaction,
  categoryNames: ReadonlyMap<number, string>,
  accountNames: ReadonlyMap<number, string>
): TransactionRowModel {
  const transferTo =
    isTransfer(transaction) && transaction.transferToAccountId !== null
      ? nameAccount(transaction.transferToAccountId, accountNames)
      : null;

  return {
    ...transaction,
    ...baseRow(transaction, categoryNames),
    reading: {
      kind: 'spanning',
      account: nameAccount(transaction.accountId, accountNames),
      transferTo,
    },
  };
}
