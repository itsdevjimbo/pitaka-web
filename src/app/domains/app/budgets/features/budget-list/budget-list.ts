import { DatePipe } from '@angular/common';
import {
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { forkJoin } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { PesoPipe } from '@/app/core/money';
import { RowNotice } from '@/app/core/notices';
import { CategoriesService } from '@/app/domains/app/categories/categories.service';
import { Budget, BudgetWithSpend, PERIODS } from '../../data/budget';
import {
  budgetPhase,
  BudgetPhase,
  budgetRemaining,
  BudgetRemaining,
} from '../../data/budget-calendar';
import { BudgetsService } from '../../data/budgets.service';
import { AdjustBudgetDialog } from '../../ui/adjust-budget-dialog';
import { NewBudgetDialog } from '../../ui/new-budget-dialog';

const LOAD_FAILED =
  'Something went wrong loading your budgets. Please try again.';

/** The person-facing line for a removal that failed with nothing to say about why. */
const ACTION_FAILED = 'Something went wrong. Please try again.';

/** What a Budget with no Category — one that watches every expense — reads as. */
const ALL_SPENDING_LABEL = 'All spending';

/** Stand-in when a Budget's Category id is not in the shared cache. */
const UNKNOWN_CATEGORY_LABEL = 'Unknown category';

/**
 * The three groups in the order the list shows them, each with its heading. All
 * three are derivable from a Budget's dates alone (ADR 0011); the API returns
 * Budgets in raw database order, so the ordering here is the client's.
 */
const PHASE_ORDER: readonly { phase: BudgetPhase; label: string }[] = [
  { phase: 'live', label: 'Live' },
  { phase: 'not-started', label: 'Not yet started' },
  { phase: 'finished', label: 'Finished' },
];

/**
 * One Budget prepared for a row: the domain record, its resolved Category, and
 * what is left of its ceiling this Cycle (`remaining`). `remaining` is derived
 * off `budget`, so it stays consistent through a re-read.
 */
type BudgetRow = {
  budget: BudgetWithSpend;
  categoryLabel: string;
  remaining: BudgetRemaining;
};

/** One heading and the Budgets beneath it, sorted by name. */
type BudgetGroup = {
  phase: BudgetPhase;
  label: string;
  rows: readonly BudgetRow[];
};

/**
 * The state behind one row's {@link RowNotice} after a removal failed: `id`
 * picks the row it belongs to, `retry` re-runs the removal that failed. A Budget
 * removal is never refused for a reason the API can name (no history or
 * allocation guard as on an Account), so there is nothing to word beyond
 * "try again".
 */
type RowNoticeState = {
  id: number;
  message: string;
  retry: () => void;
};

/**
 * The Budgets screen: every Budget the person has, in three groups the client
 * orders — Live, then Not yet started, then Finished — and by name within each.
 *
 * Every row states the Budget's own facts — name, ceiling, Period, Category,
 * start date. On top of that a **live** row shows it against its ceiling: the
 * Spent figure, what is left (or how far over, plainly and never clamped), and
 * the Cycle window the server summed over — spelled out, because a figure with
 * no window is unreadable (ADR 0012). A **finished** row is the same block
 * framed as history: its final Cycle's total, and "under" rather than "left". A
 * **not-yet-started** row shows no spend block at all — its start date stands in
 * for a "₱0 spent" that would read as restraint. Every figure comes from a fresh
 * list read (ADR 0006), never from a cache or the create response.
 *
 * A Profile with no Budgets is told what a Budget is for. A failed load says so
 * and offers a retry. *New budget* opens the create dialog; a successful create
 * re-reads the list so the new Budget lands with its server-resolved Cycle
 * figures (ADR 0006 for the re-read after a write).
 *
 * Each row can be **adjusted** or **removed** from its menu. Adjust opens a
 * prefilled form in a dialog; removal is behind a confirm — a Budget is
 * hard-deleted with nothing to restore it, and the confirm says so. Both writes
 * are followed by a fresh read of the list (ADR 0006): an adjustment can move
 * the Cycle, so the row's figures only make sense once re-read.
 */
@Component({
  selector: 'budget-list',
  templateUrl: './budget-list.html',
  imports: [
    DatePipe,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    PesoPipe,
    RowNotice,
  ],
  host: {
    class: 'flex flex-auto flex-col',
  },
})
export default class BudgetList {
  // Dependencies
  private service = inject(BudgetsService);
  private categoriesService = inject(CategoriesService);
  private destroyRef = inject(DestroyRef);
  private dialog = inject(MatDialog);

  // State
  protected readonly budgets = signal<readonly BudgetWithSpend[] | null>(null);
  protected readonly categoryNames = signal<ReadonlyMap<number, string>>(
    new Map()
  );
  protected readonly loading = signal(true);
  protected readonly errorMessage = signal<string | null>(null);

  /** The id of the Budget whose removal is awaiting confirmation, or `null`. */
  protected readonly confirmingRemoveId = signal<number | null>(null);

  /** The id of the Budget with a removal request in flight, or `null`. */
  protected readonly busyId = signal<number | null>(null);

  /** A per-row message left by a failed removal. */
  protected readonly notice = signal<RowNoticeState | null>(null);

  protected readonly periods = PERIODS;

  /**
   * The Budgets split into the three ordered groups and sorted by name within
   * each. Empty groups are dropped, so a screen with only finished Budgets shows
   * one heading, not three. Phase is derived here rather than stored on the
   * Budget, so a re-read (or any other input change) re-evaluates it against the
   * current date.
   */
  protected readonly groups = computed<readonly BudgetGroup[]>(() => {
    const budgets = this.budgets();
    if (!budgets) {
      return [];
    }

    const names = this.categoryNames();
    const now = new Date();
    const rows: (BudgetRow & { phase: BudgetPhase })[] = budgets.map(
      (budget) => ({
        budget,
        phase: budgetPhase(budget, now),
        categoryLabel:
          budget.categoryId === null
            ? ALL_SPENDING_LABEL
            : (names.get(budget.categoryId) ?? UNKNOWN_CATEGORY_LABEL),
        remaining: budgetRemaining(budget),
      })
    );

    return PHASE_ORDER.map(({ phase, label }) => ({
      phase,
      label,
      rows: rows
        .filter((row) => row.phase === phase)
        .sort((a, b) => a.budget.name.localeCompare(b.budget.name)),
    })).filter((group) => group.rows.length > 0);
  });

  /** True once a load has succeeded and the person has no Budgets at all. */
  protected readonly isEmpty = computed(() => this.budgets()?.length === 0);

  constructor() {
    this.load();
  }

  /**
   * Read the Budgets and the Category names together, behind the full-page
   * loading and error states. A Category-cache failure fails the load too — a
   * list of Budgets with no Category names is not worth showing over a retry.
   * Bound to the error state's *Try again*.
   */
  protected load(): void {
    this.loading.set(true);
    this.errorMessage.set(null);

    forkJoin({
      budgets: this.service.list(),
      categoryNames: this.categoriesService.names(),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ budgets, categoryNames }) => {
          this.categoryNames.set(categoryNames);
          this.budgets.set(budgets);
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
   * Open the *New budget* dialog. It closes with the created Budget on a
   * successful save, or with nothing on Cancel, the close control, or Escape.
   * The create response is the bare Budget with no Cycle figures behind it, and
   * this screen renders every row against its Cycle — so rather than splice a
   * figureless row in, re-read straight away and let the new Budget land with
   * its server-resolved Spent figure and window (ADR 0006; ADR 0012).
   */
  protected openNewBudgetDialog(): void {
    this.afterDialog(
      this.dialog.open<NewBudgetDialog, undefined, Budget>(NewBudgetDialog),
      () => this.reconcile()
    );
  }

  /**
   * Open the *Adjust budget* dialog for one row, seeded with its Budget. It
   * closes with the adjusted Budget on a successful save, or with nothing
   * otherwise. Opening it clears any pending remove confirm or row notice so the
   * row is not showing two things at once. An adjustment can have moved the
   * Cycle, so on success the list is re-read (ADR 0006; ADR 0012).
   */
  protected openAdjustDialog(budget: Budget): void {
    this.notice.set(null);
    this.confirmingRemoveId.set(null);

    this.afterDialog(
      this.dialog.open<AdjustBudgetDialog, Budget, Budget>(AdjustBudgetDialog, {
        data: budget,
      }),
      () => this.reconcile()
    );
  }

  /**
   * Run `handle` once a dialog closes with a saved Budget, and do nothing when
   * it closes with none (Cancel, the close control, Escape). Torn down with the
   * component. The move `AccountList.onDialogResult` makes.
   */
  private afterDialog(
    ref: MatDialogRef<unknown, Budget>,
    handle: () => void
  ): void {
    ref
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((result) => {
        if (result) {
          handle();
        }
      });
  }

  /** Ask before removing a Budget — it is hard-deleted, with nothing to restore it. */
  protected askRemove(budget: Budget): void {
    this.notice.set(null);
    this.confirmingRemoveId.set(budget.id);
  }

  protected cancelRemove(): void {
    this.confirmingRemoveId.set(null);
  }

  /**
   * The person confirmed the removal: mark the row busy, `DELETE` it, then
   * re-read the list on success (ADR 0006) or pin the row a notice with a retry
   * on failure. A Budget removal is never refused for a reason the API can name,
   * so the only way forward a failure offers is "try again".
   */
  protected confirmRemove(budget: Budget): void {
    this.confirmingRemoveId.set(null);
    this.notice.set(null);
    this.busyId.set(budget.id);

    this.service
      .remove(budget.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.busyId.set(null);
          this.reconcile();
        },
        error: (error: unknown) => {
          this.busyId.set(null);
          this.notice.set({
            id: budget.id,
            message: messageFor(error),
            retry: () => this.confirmRemove(budget),
          });
        },
      });
  }

  /**
   * Re-read the list after a write (ADR 0006). A failed reconcile is logged and
   * left — the screen keeps what it had rather than flipping to an error — the
   * same treatment `AccountList.reconcile` gives it.
   */
  private reconcile(): void {
    this.service
      .list()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (budgets) => this.budgets.set(budgets),
        error: (error: unknown) =>
          console.error('[budgets] reconcile after write failed', error),
      });
  }
}

/** The person-facing line for a failed removal: the server's words, or a plain one. */
function messageFor(error: unknown): string {
  return error instanceof ApiError ? error.message : ACTION_FAILED;
}
