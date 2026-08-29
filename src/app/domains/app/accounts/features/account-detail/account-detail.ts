import { DatePipe } from '@angular/common';
import {
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  OnInit,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { PesoPipe } from '@/app/core/money';
import { CategoriesService } from '@/app/domains/app/categories/categories.service';
import {
  Transaction,
  TRANSACTION_DIRECTIONS,
} from '@/app/domains/app/transactions/transaction';
import { TransactionsService } from '@/app/domains/app/transactions/transactions.service';
import { Account, ACCOUNT_TYPES } from '../../data/account';
import { AccountsService } from '../../data/accounts.service';

const LOAD_FAILED =
  'Something went wrong loading this account. Please try again.';

/** Shown for an income or expense the person never filed under a Category. */
const NO_CATEGORY = 'Uncategorised';

/**
 * A Transaction with the fields the row template needs on top of the domain
 * shape: `categoryName` for the meta line, `headline` for the main line — its
 * note if it has one, otherwise what it is (a Transfer, or its Category) — and
 * `incoming`, whether the amount adds to the viewed Account (income, or a
 * Transfer landing here) or subtracts from it, so the row can be signed.
 */
type TransactionRow = Transaction & {
  categoryName: string;
  headline: string;
  incoming: boolean;
};

/**
 * One Account opened up: its current balance, and the Transactions recorded
 * against it so the number on the list has something behind it. Each row reads
 * without opening it — the date and time in local time (ADR 0007), the amount, the
 * direction (income and expense told apart by more than a word), and the
 * Category, resolved through the shared reference cache rather than one request
 * per row. A generated transaction is marked as one; a Transfer reads as
 * neither income nor expense.
 *
 * Read-only. Nothing here creates, edits, or deletes a Transaction — that is a
 * later slice.
 */
@Component({
  selector: 'account-detail',
  templateUrl: './account-detail.html',
  imports: [DatePipe, MatButtonModule, MatIconModule, RouterLink, PesoPipe],
  host: {
    class: 'flex flex-auto flex-col',
  },
})
export default class AccountDetail implements OnInit {
  // Dependencies
  private accounts = inject(AccountsService);
  private transactions = inject(TransactionsService);
  private categories = inject(CategoriesService);
  private destroyRef = inject(DestroyRef);

  /** The Account id from the route (`accounts/:id`), bound by the router. */
  readonly id = input.required<string>();

  // State
  protected readonly account = signal<Account | null>(null);
  protected readonly rows = signal<readonly TransactionRow[] | null>(null);
  protected readonly loading = signal(true);
  protected readonly errorMessage = signal<string | null>(null);

  /**
   * True when the load failed with a 404: the Account is gone or was never the
   * person's, so the error state drops "Try again" — a retry cannot succeed —
   * and points back to the list instead (story 51).
   */
  protected readonly notFound = signal(false);

  protected readonly types = ACCOUNT_TYPES;
  protected readonly directions = TRANSACTION_DIRECTIONS;

  /** True once a load has succeeded and the Account has no Transactions. */
  protected readonly isEmpty = computed(() => this.rows()?.length === 0);

  // `load()` reads the required route input `id`, which the router only binds
  // after construction — so this kicks off from `ngOnInit`, not the constructor
  // the sibling `AccountList` uses.
  ngOnInit(): void {
    this.load();
  }

  /** Read the Account, its Transactions, and the Category names together. */
  protected load(): void {
    this.loading.set(true);
    this.errorMessage.set(null);
    this.notFound.set(false);

    const accountId = Number(this.id());

    forkJoin({
      account: this.accounts.get(accountId),
      transactions: this.transactions.list(accountId),
      names: this.categories.names(),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ account, transactions, names }) => {
          this.account.set(account);
          this.rows.set(transactions.map((t) => toRow(t, names, accountId)));
          this.loading.set(false);
        },
        error: (error: unknown) => {
          const apiError = error instanceof ApiError ? error : null;
          this.errorMessage.set(apiError ? apiError.message : LOAD_FAILED);
          this.notFound.set(apiError?.status === 404);
          this.loading.set(false);
        },
      });
  }
}

/** Build the row the template renders: resolved Category name, headline, sign. */
function toRow(
  transaction: Transaction,
  names: ReadonlyMap<number, string>,
  accountId: number
): TransactionRow {
  const resolved =
    transaction.categoryId === null
      ? null
      : (names.get(transaction.categoryId) ?? null);
  const categoryName = resolved ?? NO_CATEGORY;

  const isTransfer = transaction.direction === 'transfer';

  // A Transfer has no Category, so never let "Uncategorised" head its row.
  const headline =
    transaction.description ||
    (isTransfer ? TRANSACTION_DIRECTIONS.transfer.label : categoryName);

  // Which way the amount is signed against the Account on screen. A Transfer is
  // signed against a single Account (CONTEXT.md): it adds here when this is the
  // Account it lands in, subtracts otherwise. The API returns only the outgoing
  // side today (pitaka#58), so an unmatched Transfer stays outgoing and the
  // incoming case is already right once that lands.
  const incoming =
    transaction.direction === 'income' ||
    (isTransfer && transaction.transferToAccountId === accountId);

  return { ...transaction, categoryName, headline, incoming };
}
