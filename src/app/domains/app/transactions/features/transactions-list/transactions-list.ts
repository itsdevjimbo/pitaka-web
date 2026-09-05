import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { forkJoin, Observable } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { AccountsService } from '@/app/domains/app/accounts';
import { CategoriesService } from '@/app/domains/app/categories/categories.service';
import { Transaction, TransactionSearchResult } from '../../data/transaction';
import { TransactionsService } from '../../data/transactions.service';
import {
  RefileTransactionDialog,
  RefileTransactionDialogData,
} from '../../ui/refile-transaction-dialog';
import {
  TransactionRow,
  TransactionRowModel,
  toSpanningRow,
} from '../../ui/transaction-row';

const LOAD_FAILED =
  'Something went wrong loading your transactions. Please try again.';

const LOAD_MORE_FAILED =
  'Something went wrong loading more transactions. Please try again.';

/** Category id → name and Account id → name, resolved once for a whole page of rows. */
type NameMaps = {
  categoryNames: ReadonlyMap<number, string>;
  accountNames: ReadonlyMap<number, string>;
};

/**
 * One first-page read: the Category names, every Account, and page 1 of the
 * un-scoped search — the three things entry needs behind a single loading state.
 */
type FirstPageRead = {
  categoryNames: ReadonlyMap<number, string>;
  accounts: readonly { id: number; name: string }[];
  firstPage: TransactionSearchResult;
};

/**
 * The Transactions page: every Transaction the person has recorded, across every
 * Account, newest first. It reads #37's un-scoped, paged endpoint with empty
 * criteria — the whole list, no filtering yet — and renders each row through the
 * Transactions domain's own {@link TransactionRow} in its spanning reading, so a
 * row names its own Account (and both ends of a Transfer) rather than being
 * signed against a viewpoint (ADR 0010). A Transfer arrives once here: the
 * un-scoped list filters on the Profile alone, unlike the per-Account list.
 *
 * The read is cold and uncached (matching every resource service here — ADR
 * 0006), so a Transaction recorded a minute ago on another screen is present on
 * entry. First entry reads the first page, the Category names (through the
 * shared reference cache) and the Accounts together, behind one loading state.
 *
 * `totalCount` is shown against what is on screen so a partial list is never
 * mistaken for the whole answer — the endpoint caps a page at 50. **Load more**
 * appends the next page and disappears once every row is shown. A failed first
 * load explains itself and retries the whole read from the top; a failed *Load
 * more* keeps what is shown and offers its own retry. With no criteria active a
 * `totalCount` of zero *is* the "nothing recorded yet" answer — no extra probe
 * request — and its empty state is distinct from the failed-load one.
 *
 * The row keeps its own actions menu in the spanning reading (a Transfer always
 * shows here against its home Account — ADR 0010), so *Refile* and *Remove* work
 * from this page too. Either one re-runs the whole read from the top — the same
 * fresh read as first entry (ADR 0006) — which resets the list to its first
 * page; a paged list has no cheap in-place patch and this screen holds no
 * balance to reconcile.
 */
@Component({
  selector: 'transactions-list',
  templateUrl: './transactions-list.html',
  imports: [MatButtonModule, MatIconModule, TransactionRow],
  host: {
    class: 'flex flex-auto flex-col',
  },
})
export default class TransactionsList {
  // Dependencies
  private transactions = inject(TransactionsService);
  private categories = inject(CategoriesService);
  private accounts = inject(AccountsService);
  private destroyRef = inject(DestroyRef);
  private dialog = inject(MatDialog);

  // State
  protected readonly rows = signal<readonly TransactionRowModel[] | null>(null);
  protected readonly totalCount = signal(0);
  protected readonly loading = signal(true);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly loadingMore = signal(false);
  protected readonly loadMoreError = signal<string | null>(null);

  /** The page last appended by *Load more* — where the next one carries on from. */
  private readonly lastPage = signal(1);

  /** The name maps from the last read, reused to build appended *Load more* rows. */
  private names: NameMaps = {
    categoryNames: new Map(),
    accountNames: new Map(),
  };

  /** How many rows are currently shown — what `totalCount` is measured against. */
  protected readonly shownCount = computed(() => this.rows()?.length ?? 0);

  /**
   * True once a load has succeeded and nothing matched. With no criteria active
   * a `totalCount` of zero is the whole answer — the Profile has recorded
   * nothing — so the empty state reads it directly rather than a probe request.
   */
  protected readonly isEmpty = computed(
    () => this.rows() !== null && this.totalCount() === 0
  );

  /** Whether a page of rows is still unshown — gates the *Load more* control. */
  protected readonly hasMore = computed(() => {
    const rows = this.rows();
    return rows !== null && rows.length < this.totalCount();
  });

  constructor() {
    this.load();
  }

  /**
   * First entry, the failed-load retry, and the re-read after a row is refiled
   * or removed: read the first page of Transactions, the Category names and the
   * Accounts together, behind the full-page loading and error states. Any extra
   * pages that Load more had appended are dropped — the list resets to page one.
   */
  protected load(): void {
    this.loading.set(true);
    this.errorMessage.set(null);
    this.loadMoreError.set(null);
    this.lastPage.set(1);

    this.read()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.apply(result);
          this.loading.set(false);
        },
        error: (error: unknown) => {
          this.errorMessage.set(
            error instanceof ApiError ? error.message : LOAD_FAILED
          );
          this.loading.set(false);
        },
      });
  }

  /**
   * Append the next page to the list rather than replacing it. The Category and
   * Account names come from the maps the first load kept — the Category cache is
   * shared anyway (one request, not one per row), and no Account this list can
   * name appears only after entry. A failure leaves the rows on screen and pins
   * its own retry.
   */
  protected loadMore(): void {
    if (this.loadingMore()) {
      return;
    }
    this.loadingMore.set(true);
    this.loadMoreError.set(null);

    this.transactions
      .search({}, this.lastPage() + 1)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.rows.update((rows) => [
            ...(rows ?? []),
            ...this.toRows(result.transactions),
          ]);
          this.totalCount.set(result.totalCount);
          this.lastPage.update((page) => page + 1);
          this.loadingMore.set(false);
        },
        error: (error: unknown) => {
          this.loadMoreError.set(
            error instanceof ApiError ? error.message : LOAD_MORE_FAILED
          );
          this.loadingMore.set(false);
        },
      });
  }

  /**
   * Open the *Refile transaction* dialog over this screen, seeded with the
   * Transaction as it stands. The list behind it does not reflow. A successful
   * refile re-runs the whole read; Cancel, the close control, and Escape do
   * nothing.
   */
  protected openRefileDialog(transaction: Transaction): void {
    this.dialog
      .open<RefileTransactionDialog, RefileTransactionDialogData, Transaction>(
        RefileTransactionDialog,
        { data: { transaction } }
      )
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((refiled) => {
        if (refiled) {
          this.load();
        }
      });
  }

  /**
   * A Transaction was removed from its row: re-run the whole read (ADR 0006).
   * The row is gone and, elsewhere, a balance has moved — nothing on this screen
   * shows one, so there is only the list to refresh.
   */
  protected onRemoved(): void {
    this.load();
  }

  /**
   * The Category names, every Account, and page 1 of the un-scoped search — in
   * one read, re-run on every entry like the resources beside it (ADR 0006). The
   * Category cache dedupes its own request.
   */
  private read(): Observable<FirstPageRead> {
    return forkJoin({
      categoryNames: this.categories.names(),
      accounts: this.accounts.list(),
      firstPage: this.transactions.search({}, 1),
    });
  }

  /** Push a completed first-page read into the screen's signals. */
  private apply(result: FirstPageRead): void {
    this.names = {
      categoryNames: result.categoryNames,
      accountNames: new Map(
        result.accounts.map((account) => [account.id, account.name])
      ),
    };
    this.totalCount.set(result.firstPage.totalCount);
    this.rows.set(this.toRows(result.firstPage.transactions));
  }

  /** Build the spanning row model for each Transaction from the kept name maps. */
  private toRows(transactions: readonly Transaction[]): TransactionRowModel[] {
    return transactions.map((transaction) =>
      toSpanningRow(
        transaction,
        this.names.categoryNames,
        this.names.accountNames
      )
    );
  }
}
