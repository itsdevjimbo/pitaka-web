import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { forkJoin, Observable, Subject, takeUntil } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { AccountsService } from '@/app/domains/app/accounts';
import { CategoriesService } from '@/app/domains/app/categories/categories.service';
import { Category } from '@/app/domains/app/categories/category';
import {
  Transaction,
  TransactionCriteria,
  TransactionSearchResult,
} from '../../data/transaction';
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
import {
  FilterAccountOption,
  FilterCategoryOption,
  TransactionsFilterBar,
} from './transactions-filter-bar';

const LOAD_FAILED =
  'Something went wrong loading your transactions. Please try again.';

const LOAD_MORE_FAILED =
  'Something went wrong loading more transactions. Please try again.';

const REFRESH_FAILED =
  'Something went wrong refreshing your transactions. Please try again.';

const FILTER_FAILED =
  'Something went wrong applying your filters. Please try again.';

/** Category id → name and Account id → name, resolved once for a whole page of rows. */
type NameMaps = {
  categoryNames: ReadonlyMap<number, string>;
  accountNames: ReadonlyMap<number, string>;
};

/** An Account as the first-page read hands it over — enough to name a row and fill the filter. */
type ListedAccount = { id: number; name: string; isActive: boolean };

/**
 * One first-page read: every Category, every Account, and page 1 of the
 * un-scoped search under the current criteria — the three things entry needs
 * behind a single loading state. The Category and Account collections feed both
 * the row name maps and the filter bar's options.
 */
type FirstPageRead = {
  categories: readonly Category[];
  accounts: readonly ListedAccount[];
  firstPage: TransactionSearchResult;
};

/** Categories sorted for a picker: by name, case-insensitively. */
function toCategoryOptions(
  categories: readonly Category[]
): FilterCategoryOption[] {
  return categories
    .map((category) => ({ id: category.id, name: category.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Accounts sorted for a picker: active first, then retired, each group by name. */
function toAccountOptions(
  accounts: readonly ListedAccount[]
): FilterAccountOption[] {
  return accounts
    .map((account) => ({
      id: account.id,
      name: account.name,
      retired: !account.isActive,
    }))
    .sort(
      (a, b) =>
        Number(a.retired) - Number(b.retired) || a.name.localeCompare(b.name)
    );
}

/**
 * The Transactions page: every Transaction the person has recorded, across every
 * Account, newest first — and the filter bar that narrows it. Entry reads #37's
 * un-scoped, paged endpoint with the current criteria (empty on first entry —
 * the whole list), the Categories and the Accounts together behind one loading
 * state, and renders each row through the Transactions domain's own
 * {@link TransactionRow} in its spanning reading, so a row names its own Account
 * (and both ends of a Transfer) rather than being signed against a viewpoint
 * (ADR 0010). A Transfer arrives once here: the un-scoped list filters on the
 * Profile alone, unlike the per-Account list.
 *
 * The read is cold and uncached (matching every resource service here — ADR
 * 0006), so a Transaction recorded a minute ago on another screen is present on
 * entry.
 *
 * **Filtering** is server-side (#37 owns the criteria-to-parameter translation).
 * The {@link TransactionsFilterBar} is a controlled view over
 * {@link TransactionCriteria}: this page holds the criteria and, on any change,
 * issues a fresh page-1 read of *only* the transactions — the Categories and
 * Accounts no filter touches are not re-fetched. The rows already on screen stay
 * put under a busy affordance and swap when the response lands, so a dropdown
 * touch never blanks the page. #41 will move the source of truth to the URL
 * without this page's read logic changing.
 *
 * `totalCount` is shown against what is on screen so a partial list is never
 * mistaken for the whole answer — the endpoint caps a page at 50. **Load more**
 * appends the next page (under the same criteria) and disappears once every
 * matching row is shown. A failed first load explains itself and retries the
 * whole read; a failed *Load more* or filter change keeps what is shown and
 * offers its own retry.
 *
 * Two empty states, told apart by whether any criteria are active alongside a
 * zero `totalCount`, with no extra request: **nothing recorded** (no criteria)
 * says so and the filter bar is not rendered at all — three controls over an
 * empty set is furniture; **nothing matched** (criteria active) says *that* and
 * offers Clear filters.
 *
 * The row keeps its own actions menu in the spanning reading (a Transfer always
 * shows here against its home Account — ADR 0010), so *Refile* and *Remove* work
 * from this page. Either one re-runs the whole read from the top under the
 * current criteria — the same fresh read as first entry (ADR 0006) — which
 * resets the list to its first page.
 */
@Component({
  selector: 'transactions-list',
  templateUrl: './transactions-list.html',
  imports: [
    MatButtonModule,
    MatIconModule,
    TransactionRow,
    TransactionsFilterBar,
  ],
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

  /**
   * The active filter criteria — this page's own state and the single source of
   * truth the filter bar reads from and writes back to. Empty on first entry;
   * #41 will hydrate it from the route instead.
   */
  protected readonly criteria = signal<TransactionCriteria>({});

  /** True while a filter-change read is in flight — the busy affordance over the kept rows. */
  protected readonly filtering = signal(false);

  /** Set when a filter-change read fails: the old rows stay, an inline retry re-runs it. */
  protected readonly filterError = signal<string | null>(null);

  /** The Account options the filter bar offers — retired ones included, marked. */
  protected readonly accountOptions = signal<readonly FilterAccountOption[]>(
    []
  );

  /** The Category options the filter bar offers — flat, from the shared cache. */
  protected readonly categoryOptions = signal<readonly FilterCategoryOption[]>(
    []
  );

  /**
   * Set when the re-read after a refile or remove fails. Unlike a failed first
   * load it does not take over the screen: the already-shown rows stay put — now
   * one refile or removal stale — and an inline retry re-runs the read. Cleared
   * whenever `load()` starts over.
   */
  protected readonly refreshError = signal<string | null>(null);

  /** The page last appended by *Load more* — where the next one carries on from. */
  private readonly lastPage = signal(1);

  /**
   * Fires when the list restarts from page 1 — a `load()`, or a filter change.
   * Any in-flight *Load more* is torn down against it, so a late page can't be
   * stitched under the freshly reset list.
   */
  private readonly reset = new Subject<void>();

  /**
   * True once a page has come back with no rows while `totalCount` still claimed
   * more — a server answer that would otherwise leave *Load more* on screen
   * appending nothing on every press. Cleared when the list starts over.
   */
  private readonly reachedEnd = signal(false);

  /** The name maps from the last full read, reused to build appended and re-filtered rows. */
  private names: NameMaps = {
    categoryNames: new Map(),
    accountNames: new Map(),
  };

  /** How many rows are currently shown — what `totalCount` is measured against. */
  protected readonly shownCount = computed(() => this.rows()?.length ?? 0);

  /** Whether any axis is narrowed — the discriminant between the two empty states. */
  protected readonly hasActiveCriteria = computed(() => {
    const criteria = this.criteria();
    return (
      criteria.direction !== undefined ||
      criteria.accountId !== undefined ||
      criteria.categoryId !== undefined
    );
  });

  /** True once a load has succeeded and nothing came back. */
  private readonly isEmpty = computed(
    () => this.rows() !== null && this.totalCount() === 0
  );

  /**
   * Nothing came back and no filter is active — the Profile has recorded
   * nothing. With no criteria a zero `totalCount` is the whole answer, so this
   * reads it directly rather than a probe request. The filter bar is not
   * rendered in this state.
   */
  protected readonly noneRecorded = computed(
    () => this.isEmpty() && !this.hasActiveCriteria()
  );

  /**
   * Nothing came back but a filter is active — the criteria matched nothing.
   * A distinct state from the nothing-recorded one, offering Clear filters.
   */
  protected readonly matchedNothing = computed(
    () => this.isEmpty() && this.hasActiveCriteria()
  );

  /** Whether a page of rows is still unshown — gates the *Load more* control. */
  protected readonly hasMore = computed(() => {
    const rows = this.rows();
    return (
      rows !== null && !this.reachedEnd() && rows.length < this.totalCount()
    );
  });

  constructor() {
    this.destroyRef.onDestroy(() => this.reset.complete());
    this.load();
  }

  /**
   * First entry, the failed-load retry, and the re-read after a row is refiled
   * or removed: read the first page of Transactions under the current criteria,
   * the Categories and the Accounts together. Any extra pages that *Load more*
   * had appended are dropped — the list resets to page one — and an in-flight
   * append is cancelled so its response can't land on the reset list.
   *
   * With no list on screen yet — first entry, or a retry from the failed-load
   * state — the read sits behind the full-page loading and error states. With a
   * list already shown, the re-read after a refile or remove keeps those rows
   * in place: a failure leaves them (now one edit stale) and pins an inline
   * retry, the same contract as a failed *Load more*, rather than replacing a
   * good list with the whole-page error state.
   */
  protected load(): void {
    this.reset.next();
    this.errorMessage.set(null);
    this.refreshError.set(null);
    this.filterError.set(null);
    this.loadMoreError.set(null);
    this.loadingMore.set(false);
    this.filtering.set(false);
    this.reachedEnd.set(false);
    this.lastPage.set(1);

    const refreshing = this.rows() !== null;
    this.loading.set(!refreshing);

    this.read()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.apply(result);
          this.loading.set(false);
        },
        error: (error: unknown) => {
          const message =
            error instanceof ApiError
              ? error.message
              : refreshing
                ? REFRESH_FAILED
                : LOAD_FAILED;
          (refreshing ? this.refreshError : this.errorMessage).set(message);
          this.loading.set(false);
        },
      });
  }

  /**
   * A filter changed: adopt the new criteria and read page 1 of the
   * transactions again — and only the transactions. The rows on screen stay put
   * under a busy affordance and swap when the response lands, so a dropdown
   * touch never blanks the page; the Categories and Accounts no filter changes
   * are not re-fetched. Any appended pages are dropped and an in-flight *Load
   * more* is cancelled. A failure keeps the rows and pins an inline retry.
   */
  protected applyCriteria(criteria: TransactionCriteria): void {
    this.criteria.set(criteria);
    this.reset.next();
    this.loadMoreError.set(null);
    this.loadingMore.set(false);
    this.reachedEnd.set(false);
    this.lastPage.set(1);
    this.filterError.set(null);
    this.filtering.set(true);

    this.transactions
      .search(criteria, 1)
      .pipe(takeUntil(this.reset), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.totalCount.set(result.totalCount);
          this.rows.set(this.toRows(result.transactions));
          this.reachedEnd.set(result.transactions.length === 0);
          this.filtering.set(false);
        },
        error: (error: unknown) => {
          this.filterError.set(
            error instanceof ApiError ? error.message : FILTER_FAILED
          );
          this.filtering.set(false);
        },
      });
  }

  /** Clear every filter and restore the full list in one action. */
  protected clearFilters(): void {
    this.applyCriteria({});
  }

  /**
   * Append the next page to the list rather than replacing it, under the same
   * criteria the list is currently narrowed by. The Category and Account names
   * come from the maps the first load kept — the Category cache is shared anyway
   * (one request, not one per row), and no Account this list can name appears
   * only after entry. A failure leaves the rows on screen and pins its own
   * retry.
   */
  protected loadMore(): void {
    if (this.loadingMore()) {
      return;
    }
    this.loadingMore.set(true);
    this.loadMoreError.set(null);

    this.transactions
      .search(this.criteria(), this.lastPage() + 1)
      .pipe(takeUntil(this.reset), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.rows.update((rows) => [
            ...(rows ?? []),
            ...this.toRows(result.transactions),
          ]);
          this.totalCount.set(result.totalCount);
          this.lastPage.update((page) => page + 1);
          if (result.transactions.length === 0) {
            this.reachedEnd.set(true);
          }
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
   * The Categories, every Account, and page 1 of the un-scoped search under the
   * current criteria — in one read, re-run on every entry like the resources
   * beside it (ADR 0006). The Category cache dedupes its own request.
   */
  private read(): Observable<FirstPageRead> {
    return forkJoin({
      categories: this.categories.list(),
      accounts: this.accounts.list(),
      firstPage: this.transactions.search(this.criteria(), 1),
    });
  }

  /** Push a completed first-page read into the screen's signals. */
  private apply(result: FirstPageRead): void {
    this.names = {
      categoryNames: new Map(
        result.categories.map((category) => [category.id, category.name])
      ),
      accountNames: new Map(
        result.accounts.map((account) => [account.id, account.name])
      ),
    };
    this.accountOptions.set(toAccountOptions(result.accounts));
    this.categoryOptions.set(toCategoryOptions(result.categories));
    this.totalCount.set(result.firstPage.totalCount);
    this.rows.set(this.toRows(result.firstPage.transactions));
    this.reachedEnd.set(result.firstPage.transactions.length === 0);
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
