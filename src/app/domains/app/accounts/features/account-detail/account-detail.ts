import { Component, computed, DestroyRef, ElementRef, inject, input, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { forkJoin, Observable, Subject, takeUntil } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { PesoPipe } from '@/app/core/money';
import { ResourceState } from '@/app/core/notices';
import { CategoriesService } from '@/app/domains/app/categories';
import {
  RecordTransactionDialog,
  RecordTransactionDialogData,
  RefileTransactionDialog,
  RefileTransactionDialogData,
  Transaction,
  TransactionSearchResult,
  TransactionRow,
  TransactionRowModel,
  TransactionsService,
  TransferDestinationAccount,
  toAccountRow,
} from '@/app/domains/app/transactions';
import { Account, ACCOUNT_TYPES } from '../../data/account';
import { AccountsService } from '../../data/accounts.service';

const LOAD_FAILED = 'Something went wrong loading this account. Please try again.';
const LOAD_MORE_FAILED = 'Something went wrong loading more transactions. Please try again.';

type AccountDetailRead = {
  account: Account;
  firstPage: TransactionSearchResult;
  names: ReadonlyMap<number, string>;
  accounts: readonly Account[];
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
 * The row itself belongs to the Transactions domain (ADR 0009): this screen
 * resolves the Category names, picks the Account to sign against, and hands each
 * finished row to the `transaction-row` component.
 *
 * An active Account can record against itself: *Record* opens the
 * `record-transaction-dialog` over this screen — the balance and the list stay
 * put behind it, so a person can see what they already recorded and not record
 * it twice — and a successful record closes the dialog and re-reads the balance
 * and list in place, the rows staying visible rather than blanking back to the
 * spinner (that is for first entry only). The screen hands the form the Account
 * the money moves from and the valid Transfer destinations (itself and every
 * retired Account excluded); the form does no filtering. A retired Account
 * offers no record control and points at the reactivate that lives on the
 * accounts list.
 *
 * A row's own menu carries *Refile*, which opens the `refile-transaction-dialog`
 * the same way, seeded with that Transaction's moment, Category, and note; the
 * row stays legible behind it. A successful refile closes the dialog and
 * re-reads in place, so a corrected date reorders the row to where it belongs.
 */
@Component({
  selector: 'account-detail',
  templateUrl: './account-detail.html',
  imports: [MatButtonModule, MatIconModule, RouterLink, PesoPipe, ResourceState, TransactionRow],
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
  private dialog = inject(MatDialog);
  private host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly firstPageReset = new Subject<void>();
  private readonly paginationReset = new Subject<void>();
  private actionMessageTimer: ReturnType<typeof setTimeout> | null = null;

  /** The Account id from the route (`accounts/:id`), bound by the router. */
  readonly id = input.required<string>();

  /** The route id as a number — the shape every service call and the row builder want. */
  private readonly accountId = computed(() => Number(this.id()));

  // State
  protected readonly account = signal<Account | null>(null);

  /**
   * Every Account the person owns. Feeds two things: the `destinations` the
   * record dialog is seeded with, and the name a Transfer that landed here shows
   * for the Account it was recorded against (ADR 0010).
   */
  protected readonly accountsList = signal<readonly Account[]>([]);
  protected readonly rows = signal<readonly TransactionRowModel[] | null>(null);
  protected readonly loading = signal(true);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly refreshError = signal(false);
  protected readonly savedStale = signal(false);
  protected readonly refreshing = signal(false);
  protected readonly actionsUnavailable = computed(() => this.refreshing() || this.refreshError());
  protected readonly loadingMore = signal(false);
  protected readonly loadMoreError = signal<string | null>(null);
  protected readonly totalCount = signal(0);
  protected readonly shownCount = computed(() => this.rows()?.length ?? 0);
  private readonly reachedEnd = signal(false);
  protected readonly hasMore = computed(() => !this.reachedEnd() && this.shownCount() < this.totalCount());
  protected readonly dialogOpen = signal(false);
  protected readonly actionMessage = signal<string | null>(null);
  private readonly lastPage = signal(1);
  private categoryNames: ReadonlyMap<number, string> = new Map();
  private accountNames: ReadonlyMap<number, string> = new Map();
  private readonly focusAfterRemove = signal<number | 'heading' | null>(null);

  /**
   * True when the load failed with a 404: the Account is gone or was never the
   * person's, so the error state drops "Try again" — a retry cannot succeed —
   * and points back to the list instead (story 51).
   */
  protected readonly notFound = signal(false);

  protected readonly types = ACCOUNT_TYPES;

  /**
   * The Accounts a Transfer recorded here may land in: every active Account
   * except the one in view. A self-transfer nets to zero and comes back as a row
   * claiming money moved when none did; a retired Account is one the API refuses
   * with an unattributable rejection. Excluding both here — the screen's job, not
   * the form's — closes both by construction before the form ever opens.
   */
  protected readonly destinations = computed<readonly TransferDestinationAccount[]>(() => {
    const current = this.accountId();
    return this.accountsList()
      .filter((account) => account.isActive && account.id !== current)
      .map((account) => ({ id: account.id, name: account.name }));
  });

  /** True once a load has succeeded and the Account has no Transactions. */
  protected readonly isEmpty = computed(() => this.rows()?.length === 0);

  // `load()` reads the required route input `id`, which the router only binds
  // after construction — so this kicks off from `ngOnInit`, not the constructor
  // the sibling `AccountList` uses.
  ngOnInit(): void {
    this.destroyRef.onDestroy(() => {
      this.firstPageReset.complete();
      this.paginationReset.complete();
      if (this.actionMessageTimer !== null) {
        clearTimeout(this.actionMessageTimer);
      }
    });
    this.load();
  }

  /**
   * First entry: read the Account, its Transactions, and the Category names
   * together, behind the full-page loading state and error state.
   */
  protected load(): void {
    this.firstPageReset.next();
    this.resetPagination();
    this.loading.set(true);
    this.errorMessage.set(null);
    this.refreshError.set(false);
    this.savedStale.set(false);
    this.notFound.set(false);

    this.read()
      .pipe(takeUntil(this.firstPageReset), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.apply(result);
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
   * Open the *Record a transaction* dialog over this screen, seeded with the
   * Account the money moves from and the valid Transfer destinations. The
   * balance and list behind it do not reflow. It closes with the recorded
   * Transaction on a successful record, or with nothing on Cancel, the close
   * control, or Escape. Only ever reachable for an active Account.
   */
  protected openRecordDialog(): void {
    this.dialogOpen.set(true);
    const ref = this.dialog.open<RecordTransactionDialog, RecordTransactionDialogData, Transaction>(
      RecordTransactionDialog,
      {
        data: { fromAccountId: this.accountId(), destinations: this.destinations() },
      },
    );

    ref
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((recorded) => {
        this.dialogOpen.set(false);
        if (recorded) {
          this.onRecorded();
        }
      });
  }

  /** A Transaction was recorded: refresh the balance and list in place (ADR 0006). */
  protected onRecorded(): void {
    this.showActionMessage('Transaction recorded.');
    this.refreshInPlace(true);
  }

  /**
   * Open the *Refile transaction* dialog over this screen, seeded with the
   * Transaction as it stands now — its date, time, Category, and note. The row
   * stays legible behind it and nothing reflows. It closes with the corrected
   * Transaction on a successful refile, or with nothing on Cancel, the close
   * control, or Escape. The row only offers this where a Transaction can be
   * corrected (its home, for a Transfer — ADR 0010), so this is never reached
   * for a Transfer seen from the side it landed on.
   */
  protected openRefileDialog(transaction: Transaction): void {
    this.dialogOpen.set(true);
    const ref = this.dialog.open<RefileTransactionDialog, RefileTransactionDialogData, Transaction>(
      RefileTransactionDialog,
      { data: { transaction } },
    );

    ref
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((refiled) => {
        this.dialogOpen.set(false);
        if (refiled) {
          this.onRefiled();
        }
      });
  }

  /**
   * A Transaction was refiled: close the dialog and refresh in place. A
   * corrected date or Category can move where the row sits or change what it
   * says, and the balance shown afterwards is always the server's (ADR 0006) —
   * even though refiling never moves one.
   */
  protected onRefiled(): void {
    this.showActionMessage('Transaction refiled.');
    this.refreshInPlace(true);
  }

  /**
   * A Transaction was removed from its row: refresh in place. The row is gone
   * and the balance has moved back by exactly what moved — the figure shown is
   * the server's re-read, not local arithmetic (ADR 0006), and the rows stay
   * visible rather than blanking to the spinner.
   */
  protected onRemoved(removed: TransactionRowModel): void {
    const rows = this.rows() ?? [];
    const index = rows.findIndex((row) => row.id === removed.id);
    this.focusAfterRemove.set(rows[index + 1]?.id ?? rows[index - 1]?.id ?? 'heading');
    this.showActionMessage('Transaction removed.');
    this.refreshInPlace(true);
  }

  /**
   * Re-read the balance and list from the server (ADR 0006 — never patch a
   * balance locally) *without* tearing the screen down to the spinner: the rows
   * stay put and refresh in place. A failed re-read keeps what the screen had,
   * marks those figures stale, and gates writes until this same read succeeds.
   */
  protected retryRefresh(): void {
    this.refreshInPlace();
  }

  protected checkUncertainRemoval(): void {
    this.refreshInPlace(false);
  }

  private refreshInPlace(savedStale = this.savedStale()): void {
    this.firstPageReset.next();
    this.resetPagination();
    this.refreshError.set(false);
    this.savedStale.set(savedStale);
    this.refreshing.set(true);
    this.read()
      .pipe(takeUntil(this.firstPageReset), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.apply(result);
          this.refreshing.set(false);
          this.savedStale.set(false);
        },
        error: () => {
          this.refreshing.set(false);
          this.refreshError.set(true);
        },
      });
  }

  protected loadMore(): void {
    if (this.actionsUnavailable() || this.loadingMore() || !this.hasMore()) {
      return;
    }
    this.loadingMore.set(true);
    this.loadMoreError.set(null);
    const page = this.lastPage() + 1;
    this.transactions
      .search({ accountId: this.accountId() }, page)
      .pipe(takeUntil(this.paginationReset), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.rows.update((rows) => [...(rows ?? []), ...this.toRows(result.transactions)]);
          this.totalCount.set(result.totalCount);
          this.lastPage.set(page);
          this.reachedEnd.set(result.transactions.length === 0);
          this.loadingMore.set(false);
        },
        error: (error: unknown) => {
          this.loadMoreError.set(error instanceof ApiError ? error.message : LOAD_MORE_FAILED);
          this.loadingMore.set(false);
        },
      });
  }

  /**
   * The Account, its Transactions, the Category names, and every Account — in
   * one read. The full Account list feeds two things: the `destinations` the
   * record dialog is seeded with, and the name a Transfer that landed here shows
   * for the Account it was recorded against (ADR 0010). It is re-read on every
   * entry like the balance beside it (ADR 0006).
   */
  private read(): Observable<AccountDetailRead> {
    return forkJoin({
      account: this.accounts.get(this.accountId()),
      firstPage: this.transactions.search({ accountId: this.accountId() }, 1),
      names: this.categories.names(),
      accounts: this.accounts.all(),
    });
  }

  /** Push a completed read into the screen's signals. */
  private apply(result: AccountDetailRead): void {
    this.account.set(result.account);
    this.accountsList.set(result.accounts);
    this.categoryNames = result.names;
    this.accountNames = new Map(result.accounts.map((account) => [account.id, account.name]));
    this.rows.set(this.toRows(result.firstPage.transactions));
    this.totalCount.set(result.firstPage.totalCount);
    this.reachedEnd.set(result.firstPage.transactions.length === 0);
    this.refreshError.set(false);
    this.restoreFocusAfterRemove();
  }

  private toRows(transactions: readonly Transaction[]): TransactionRowModel[] {
    return transactions.map((transaction) =>
      toAccountRow(transaction, this.categoryNames, this.accountId(), this.accountNames),
    );
  }

  private resetPagination(): void {
    this.paginationReset.next();
    this.lastPage.set(1);
    this.reachedEnd.set(false);
    this.loadingMore.set(false);
    this.loadMoreError.set(null);
  }

  private showActionMessage(message: string): void {
    if (this.actionMessageTimer !== null) {
      clearTimeout(this.actionMessageTimer);
    }
    this.actionMessage.set(message);
    this.actionMessageTimer = setTimeout(() => {
      this.actionMessage.set(null);
      this.actionMessageTimer = null;
    }, 5000);
  }

  private restoreFocusAfterRemove(): void {
    const target = this.focusAfterRemove();
    if (target === null) {
      return;
    }
    this.focusAfterRemove.set(null);
    queueMicrotask(() => {
      const selector = target === 'heading' ? '#transaction-history-heading' : `#transaction-actions-${target}`;
      this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus();
    });
  }
}
