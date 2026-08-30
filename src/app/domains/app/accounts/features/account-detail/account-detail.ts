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
  RecordTransactionForm,
  Transaction,
  TransactionRow,
  TransactionRowModel,
  TransactionsService,
  toTransactionRow,
} from '@/app/domains/app/transactions';
import { Account, ACCOUNT_TYPES } from '../../data/account';
import { AccountsService } from '../../data/accounts.service';

const LOAD_FAILED =
  'Something went wrong loading this account. Please try again.';

/**
 * One Account opened up: its current balance, and the Transactions recorded
 * against it so the number on the list has something behind it. Each row reads
 * without opening it — the date and time in local time (ADR 0007), the amount, the
 * direction (income and expense told apart by more than a word), and the
 * Category, resolved through the shared reference cache rather than one request
 * per row. A generated transaction is marked as one; a Transfer reads as
 * neither income nor expense.
 *
 * The row itself belongs to the Transactions domain (ADR 0009): this screen
 * resolves the Category names, picks the Account to sign against, and hands each
 * finished row to the `transaction-row` component.
 *
 * An active Account can record against itself, inline: a signal reveals the
 * `record-transaction-form`, and a successful record re-reads the balance and
 * list in place — the rows stay visible, the screen never blanks back to the
 * spinner (that is for first entry only). A retired Account offers no record
 * control and points at the reactivate that lives on the accounts list.
 */
@Component({
  selector: 'account-detail',
  templateUrl: './account-detail.html',
  imports: [
    MatButtonModule,
    MatIconModule,
    RouterLink,
    PesoPipe,
    TransactionRow,
    RecordTransactionForm,
  ],
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
  protected readonly rows = signal<readonly TransactionRowModel[] | null>(null);
  protected readonly loading = signal(true);
  protected readonly errorMessage = signal<string | null>(null);

  /**
   * True when the load failed with a 404: the Account is gone or was never the
   * person's, so the error state drops "Try again" — a retry cannot succeed —
   * and points back to the list instead (story 51).
   */
  protected readonly notFound = signal(false);

  protected readonly types = ACCOUNT_TYPES;

  /** Whether the inline record form is open. Only ever set for an active Account. */
  protected readonly recording = signal(false);

  /** True once a load has succeeded and the Account has no Transactions. */
  protected readonly isEmpty = computed(() => this.rows()?.length === 0);

  // `load()` reads the required route input `id`, which the router only binds
  // after construction — so this kicks off from `ngOnInit`, not the constructor
  // the sibling `AccountList` uses.
  ngOnInit(): void {
    this.load();
  }

  /**
   * First entry: read the Account, its Transactions, and the Category names
   * together, behind the full-page loading state and error state.
   */
  protected load(): void {
    this.loading.set(true);
    this.errorMessage.set(null);
    this.notFound.set(false);

    const accountId = Number(this.id());

    this.fetch(accountId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.apply(result, accountId);
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

  /**
   * A Transaction was recorded. Close the form and re-read the balance and list
   * from the server (ADR 0006 — never patch a balance locally) *without*
   * tearing the screen down to the spinner: the rows stay put and refresh in
   * place. A failed re-read is logged and the screen keeps what it had.
   */
  protected onRecorded(): void {
    this.recording.set(false);

    const accountId = Number(this.id());
    this.fetch(accountId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => this.apply(result, accountId),
        error: (error: unknown) =>
          console.error('[account-detail] refresh after record failed', error),
      });
  }

  /** The Account, its Transactions, and the Category names, in one read. */
  private fetch(accountId: number) {
    return forkJoin({
      account: this.accounts.get(accountId),
      transactions: this.transactions.list(accountId),
      names: this.categories.names(),
    });
  }

  /** Push a completed read into the screen's signals. */
  private apply(
    result: {
      account: Account;
      transactions: readonly Transaction[];
      names: ReadonlyMap<number, string>;
    },
    accountId: number
  ): void {
    this.account.set(result.account);
    this.rows.set(
      result.transactions.map((t) => toTransactionRow(t, result.names, accountId))
    );
  }
}
