import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import { forkJoin, Observable, Subject, takeUntil } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { AccountsService } from '@/app/domains/app/accounts';
import { CategoriesService, Category } from '@/app/domains/app/categories';
import {
  activeCriteriaCount,
  Transaction,
  TransactionCriteria,
  TransactionSearchResult,
} from '../../data/transaction';
import {
  criteriaFromQueryParams,
  criteriaToQueryParams,
  sameCriteria,
} from '../../data/transaction-criteria-params';
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
 * {@link TransactionCriteria}, and **the URL is the source of truth** for it
 * (#41): the criteria are serialised to readable query parameters
 * (`transaction-criteria-params.ts`), so a narrowed view survives a refresh,
 * bookmarks, and travels in a link. A change in the bar writes the parameters
 * with `replaceUrl` — one history entry for a whole filtering session, so Back
 * leaves the page rather than stepping through every control that was touched —
 * and the route change, not the bar, drives a fresh page-1 read of *only* the
 * transactions (the Categories and Accounts no filter touches are not
 * re-fetched). The rows already on screen stay put under a busy affordance and
 * swap when the response lands, so a dropdown touch never blanks the page.
 * Arriving at a URL that already carries filters renders the list narrowed on
 * entry; the parse is total, so a hand-edited parameter widens the list rather
 * than breaking it. `page` is deliberately not carried — it is a position in a
 * result set, not something the person filtered by.
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
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  // State
  protected readonly rows = signal<readonly TransactionRowModel[] | null>(null);
  protected readonly totalCount = signal(0);
  protected readonly loading = signal(true);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly loadingMore = signal(false);
  protected readonly loadMoreError = signal<string | null>(null);

  /**
   * The active filter criteria, hydrated from the query string on entry and
   * kept in step with it thereafter (#41). The route is the source of truth:
   * the filter bar reads this into its controls, but a change there is written
   * to the URL and flows back here through the route subscription rather than
   * being set directly.
   */
  protected readonly criteria = signal<TransactionCriteria>(
    criteriaFromQueryParams(this.route.snapshot.queryParamMap)
  );

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
  protected readonly hasActiveCriteria = computed(
    () => activeCriteriaCount(this.criteria()) > 0
  );

  /**
   * A settled load that came back empty — but only when nothing is in flight.
   * While a filter change is running, `criteria` has already moved to the new
   * value and `rows`/`totalCount` still hold the old result, so an unguarded
   * read here would briefly mis-fire — clearing filters from the matched-nothing
   * state would flash the "nothing recorded" screen and unmount the filter bar.
   * The busy affordance covers that gap instead.
   */
  private readonly isEmpty = computed(
    () => !this.filtering() && this.rows() !== null && this.totalCount() === 0
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

    // The URL is the source of truth for the criteria (#41). Every emission of
    // the query string — the one replayed on subscribe, and every later change
    // from a filter edited in the bar, the back button, or a pasted link —
    // flows through {@link onUrlCriteriaChange}, which no-ops when the parsed
    // value already matches what is on screen. So the replay is harmless (it
    // matches the `criteria` seeded from the snapshot above) without a fragile
    // `skip(1)`, and `load()` below owns the one read on entry.
    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => this.onUrlCriteriaChange(params));

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
    this.resetToFirstPage();
    this.errorMessage.set(null);
    this.refreshError.set(null);
    this.filterError.set(null);
    this.filtering.set(false);

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
   * A filter changed in the bar: write the new criteria to the query string
   * (#41) and let the route change drive the re-read. Nothing is set here
   * directly — {@link onUrlCriteriaChange} adopts the parsed value once the URL
   * has moved. `replaceUrl` keeps one history entry for the whole filtering
   * session, so Back leaves the page rather than stepping backwards through
   * every control that was touched. `page` is never written: it is a position
   * in a result set, not something the person filtered by, and a caller
   * resetting to page 1 on a filter change has nothing to strip.
   */
  protected applyCriteria(criteria: TransactionCriteria): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: criteriaToQueryParams(criteria),
      replaceUrl: true,
    });
  }

  /** Clear every filter and restore the full list in one action. */
  protected clearFilters(): void {
    this.applyCriteria({});
  }

  /**
   * A new query string landed: parse it — totally, so a hand-edited junk value
   * widens rather than breaks — and, when it names criteria the list is not
   * already showing, adopt them and re-read page 1. The guard keeps a no-op
   * navigation (a parameter the parser dropped, a replayed value) from firing a
   * redundant read.
   */
  private onUrlCriteriaChange(params: ParamMap): void {
    const next = criteriaFromQueryParams(params);
    if (sameCriteria(next, this.criteria())) {
      return;
    }
    this.criteria.set(next);
    this.readCriteria(next);
  }

  /**
   * Read page 1 of the transactions under `criteria` — and only the
   * transactions. The rows on screen stay put under a busy affordance and swap
   * when the response lands, so a dropdown touch never blanks the page; the
   * Categories and Accounts no filter changes are not re-fetched. Any appended
   * pages are dropped and an in-flight *Load more* is cancelled. A failure keeps
   * the rows and pins an inline retry.
   */
  private readCriteria(criteria: TransactionCriteria): void {
    this.resetToFirstPage();
    this.refreshError.set(null);
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

  /**
   * Retry a filter-change read that failed. The URL already carries the current
   * criteria, so this re-runs the read directly rather than navigating to the
   * same parameters (which would not re-emit).
   */
  protected retryFilter(): void {
    this.readCriteria(this.criteria());
  }

  /**
   * Drop back to a single page 1: cancel any in-flight *Load more* against the
   * {@link reset} signal, clear its error and busy flag, and forget both the
   * appended-page count and the "server ran dry" latch. Shared by `load()` and
   * {@link readCriteria} — the two entry points that restart the list.
   */
  private resetToFirstPage(): void {
    this.reset.next();
    this.loadMoreError.set(null);
    this.loadingMore.set(false);
    this.reachedEnd.set(false);
    this.lastPage.set(1);
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
   *
   * `all()`, not `list()`: this bar governs *finding*, not filing, so a retired
   * Category has to stay offered — a Transaction filed under one keeps it
   * forever and must stay reachable (ADR 0017). `list()` narrowed to
   * active-only for the write pickers, and reading through it here would drop
   * those rows from both the option list and the id-to-name map below.
   */
  private read(): Observable<FirstPageRead> {
    return forkJoin({
      categories: this.categories.all(),
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
