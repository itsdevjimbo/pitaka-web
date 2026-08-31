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
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { forkJoin } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { PesoPipe } from '@/app/core/money';
import { CategoriesService } from '@/app/domains/app/categories/categories.service';
import { Budget, PERIODS } from '../../data/budget';
import { budgetPhase, BudgetPhase } from '../../data/budget-calendar';
import { BudgetsService } from '../../data/budgets.service';
import { NewBudgetDialog } from '../../ui/new-budget-dialog';

const LOAD_FAILED =
  'Something went wrong loading your budgets. Please try again.';

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

/** One Budget prepared for a row: the domain record plus its resolved Category. */
type BudgetRow = {
  budget: Budget;
  categoryLabel: string;
};

/** One heading and the Budgets beneath it, sorted by name. */
type BudgetGroup = {
  phase: BudgetPhase;
  label: string;
  rows: readonly BudgetRow[];
};

/**
 * The Budgets screen: every Budget the person has, in three groups the client
 * orders — Live, then Not yet started, then Finished — and by name within each.
 * A row shows the Budget's own facts: its name, ceiling, Period, Category name
 * (or "All spending"), and start date. **No Cycle window and no progress bar** —
 * the Cycle belongs to the server (ADR 0012) and the Spent figure arrives with a
 * later ticket; deriving either here would be arithmetic about to be deleted.
 *
 * A Profile with no Budgets is told what a Budget is for. A failed load says so
 * and offers a retry. *New budget* opens the create dialog; a successful create
 * shows the Budget straight away, then re-reads the list so it lands in the
 * server's data (ADR 0006 for the re-read after a write).
 */
@Component({
  selector: 'budget-list',
  templateUrl: './budget-list.html',
  imports: [DatePipe, MatButtonModule, MatIconModule, PesoPipe],
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
  protected readonly budgets = signal<readonly Budget[] | null>(null);
  protected readonly categoryNames = signal<ReadonlyMap<number, string>>(
    new Map()
  );
  protected readonly loading = signal(true);
  protected readonly errorMessage = signal<string | null>(null);

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
   */
  protected openNewBudgetDialog(): void {
    this.dialog
      .open<NewBudgetDialog, undefined, Budget>(NewBudgetDialog)
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((created) => {
        if (created) {
          this.onCreated(created);
        }
      });
  }

  /**
   * A Budget was created. Show it at once — from the create response — then
   * re-read the list so it lands in the server's data and picks up anything
   * changed elsewhere (ADR 0006: reconcile a write with a fresh read).
   */
  private onCreated(budget: Budget): void {
    this.budgets.update((list) => [...(list ?? []), budget]);
    this.reconcile();
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
