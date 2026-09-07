import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ApiError } from '@/app/core/api';
import { CategoriesService } from '../../data/categories.service';
import { Category } from '../../data/category';
import { CategoryPane } from '../../ui/category-pane';

const LOAD_FAILED =
  'Something went wrong loading your categories. Please try again.';

/** The re-read after a write failed: the change landed, the list may be stale. */
const REFRESH_FAILED =
  'Your change was saved, but this list may be out of date. Try again to refresh it.';

/**
 * The Categories screen: reference data, visited rarely and deliberately,
 * reached from the *Manage* navigation group. Expense and Income sit side by
 * side on desktop and stack on phone — the split is a permanent structural fact
 * (a Category's kind is settled at creation), made spatial so 27 expense rows
 * cannot bury Income below the fold. Each {@link CategoryPane} owns its own
 * count, search, Active/Retired/All switch, Add button and rows.
 *
 * The screen reads **cold** — `readAll()`, whole-set and cache-bypassing — and
 * invalidates the shared Categories cache through every write without ever
 * consulting it: one direction of dependency, not two (ADR 0017). Every
 * successful write in a pane re-reads the whole set here, so a rename re-sorts
 * and a retire sinks or hides in one place.
 *
 * A failed first load is screen-level: one read, one failure, one retry, with
 * the panes withheld — repeating an identical error beside itself would imply
 * two things broke. A failed post-write re-read keeps the rows and offers a
 * non-destructive inline retry: the write landed, so wiping both panes would
 * punish the person for succeeding. There is no whole-screen empty state — the
 * API seeds supplied Categories globally, so a real person never reaches one.
 */
@Component({
  selector: 'categories-list',
  templateUrl: './categories-list.html',
  imports: [MatButtonModule, MatIconModule, CategoryPane],
  host: {
    class: 'flex flex-auto flex-col',
  },
})
export default class CategoriesList {
  // Dependencies
  private service = inject(CategoriesService);
  private destroyRef = inject(DestroyRef);

  // State
  protected readonly categories = signal<readonly Category[] | null>(null);
  protected readonly loading = signal(true);
  protected readonly errorMessage = signal<string | null>(null);

  /** Set when the re-read after a write fails — the rows stay, an inline retry re-runs it. */
  protected readonly refreshError = signal<string | null>(null);

  protected readonly expenseCategories = computed(() =>
    (this.categories() ?? []).filter((category) => category.kind === 'expense')
  );

  protected readonly incomeCategories = computed(() =>
    (this.categories() ?? []).filter((category) => category.kind === 'income')
  );

  constructor() {
    this.load();
  }

  /** Read the whole set cold. Bound to the failed-load retry. */
  protected load(): void {
    this.loading.set(true);
    this.errorMessage.set(null);
    this.refreshError.set(null);

    this.service
      .readAll()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (categories) => {
          this.categories.set(categories);
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
   * Re-read the whole set after a pane reported a successful write. A failure
   * keeps the rows on screen — now one write stale — under an inline retry,
   * rather than replacing a good screen with the load error.
   */
  protected reload(): void {
    this.refreshError.set(null);

    this.service
      .readAll()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (categories) => this.categories.set(categories),
        // The framing — the write landed, the list is stale — matters more here
        // than a server detail, so it is fixed rather than taken from the error.
        error: () => this.refreshError.set(REFRESH_FAILED),
      });
  }
}
