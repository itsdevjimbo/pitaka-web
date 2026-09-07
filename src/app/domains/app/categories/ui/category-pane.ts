import {
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { Observable } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { RowNotice } from '@/app/core/notices';
import { CategoriesService } from '../data/categories.service';
import { Category, CategoryKind } from '../data/category';
import { CategoryInUseError } from '../data/category-errors';
import { AddCategoryDialog } from './add-category-dialog';
import { RenameCategoryDialog } from './rename-category-dialog';

/** Which slice of the pane's kind is on screen. Retired is never hidden as an option. */
type PaneFilter = 'active' | 'retired' | 'all';

const FILTERS: readonly { value: PaneFilter; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'retired', label: 'Retired' },
  { value: 'all', label: 'All' },
];

const ACTION_FAILED = 'Something went wrong. Please try again.';

/**
 * A delete the API refused because something still files under the Category —
 * the person cannot know in advance which side of that guard they are on, so
 * Delete stays offered and this is what they are told. The blocker itself is
 * not named: the API returns one undifferentiated string covering Transaction,
 * Budget and Schedule, and the client must not guess (#107).
 */
const DELETE_BLOCKED_ACTIVE =
  'Something still uses this category, so it can’t be deleted. You can retire it instead — it stays on everything already filed under it.';

/** The same, once the Category is already retired: the first sentence alone, no way-out button. */
const DELETE_BLOCKED_RETIRED =
  'Something still uses this category, so it can’t be deleted.';

/** A message pinned to one row after a retire / reactivate / delete failed. */
type RowNoticeState = {
  id: number;
  message: string;
  retry?: () => void;
  retire?: () => void;
};

/** The inline acknowledgement after a write moved a row out of the current view. */
type MovedAck = {
  name: string;
  /** The segment the row is now in — the switch value that would show it. */
  segment: 'Retired' | 'Active';
  verb: 'retired' | 'reactivated';
};

/**
 * One side of the Categories screen — Expense or Income — with everything that
 * side owns: a count, a text search, an Active/Retired/All switch, an *Add*
 * button that opens the {@link AddCategoryDialog} for this kind, and the rows.
 *
 * Rows are a name, badges, and a per-row action menu — nothing more. Ordering is
 * this client's, not the wire's: alphabetical by name with retired sunk to the
 * bottom, because a person arrives with a name in mind and scans for it. A
 * Category carries no usage figure — the wire has none and it would cost a
 * request per row against an endpoint that does not exist — so none is shown.
 *
 * A Pitaka-supplied Category gets a quiet `Default` badge and **no menu**: the
 * API Forbids every write on it, so a menu would only ever raise a 403, and the
 * badge is what explains the absence. Supplied rows file inline under the same
 * pane as the person's own.
 *
 * Every successful write emits `changed` and the screen re-reads the whole set,
 * so a rename re-sorts and a retire sinks or hides in one place rather than
 * against a locally patched signal. Retiring from the Active view makes the row
 * vanish, so the pane says so inline — "Groceries retired" — naming the Retired
 * segment; it does **not** flip the switch the person set.
 */
@Component({
  selector: 'categories-category-pane',
  templateUrl: './category-pane.html',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    RowNotice,
  ],
})
export class CategoryPane {
  // Dependencies
  private service = inject(CategoriesService);
  private dialog = inject(MatDialog);
  private destroyRef = inject(DestroyRef);

  // Inputs
  readonly kind = input.required<CategoryKind>();

  /** This kind's whole set — active and retired, supplied and the person's own — in wire order. */
  readonly categories = input.required<readonly Category[]>();

  /**
   * Set by the screen when the re-read after a write failed: the rows on screen
   * are now one write stale. It suppresses this pane's "moved" acknowledgement,
   * whose row is still sitting in view because the re-read that would have
   * removed it never landed.
   */
  readonly refreshFailed = input(false);

  // Outputs

  /** Fired after any successful write so the screen re-reads (#107). */
  readonly changed = output<void>();

  // State
  protected readonly filters = FILTERS;
  protected readonly search = signal('');
  protected readonly filter = signal<PaneFilter>('active');

  /** The id of the row whose delete is awaiting confirmation, or `null`. */
  protected readonly confirmingDeleteId = signal<number | null>(null);

  /** The id of the row with a retire / reactivate / delete request in flight. */
  protected readonly busyId = signal<number | null>(null);

  /** A per-row message left by a failed retire / reactivate / delete. */
  protected readonly notice = signal<RowNoticeState | null>(null);

  /**
   * The "Groceries retired" line. A plain signal, held until the person's next
   * interaction with this pane — not tied to the re-read, which lands too fast
   * to be seen.
   */
  protected readonly moved = signal<MovedAck | null>(null);

  /**
   * The "Groceries retired" line as shown: withheld while the re-read that backs
   * it failed, because the moved row is then still in this view and the screen's
   * stale-list notice should stand alone rather than be contradicted.
   */
  protected readonly movedAck = computed(() =>
    this.refreshFailed() ? null : this.moved()
  );

  /** "Expense" / "Income" — the pane's heading. */
  protected readonly heading = computed(() =>
    this.kind() === 'expense' ? 'Expense' : 'Income'
  );

  /** Alphabetical by name, retired sunk to the bottom. Ordering is ours (#107). */
  private readonly sorted = computed(() =>
    [...this.categories()].sort(
      (a, b) =>
        Number(!a.isActive) - Number(!b.isActive) ||
        a.name.localeCompare(b.name)
    )
  );

  /** The switch-scoped set, before search narrows it — what the count measures. */
  private readonly switched = computed(() => {
    const all = this.sorted();
    switch (this.filter()) {
      case 'active':
        return all.filter((category) => category.isActive);
      case 'retired':
        return all.filter((category) => !category.isActive);
      default:
        return all;
    }
  });

  /** The search box value with the ends trimmed — the one form the rest of the pane reads. */
  protected readonly trimmedSearch = computed(() => this.search().trim());

  /** What is actually on screen: the switch-scoped set, narrowed by the search. */
  protected readonly visible = computed(() => {
    const query = this.trimmedSearch().toLocaleLowerCase();
    if (!query) {
      return this.switched();
    }
    return this.switched().filter((category) =>
      category.name.toLocaleLowerCase().includes(query)
    );
  });

  /** The count beside the heading — the switch view, not the search-narrowed one. */
  protected readonly count = computed(() => this.switched().length);

  protected readonly hasSearch = computed(
    () => this.trimmedSearch().length > 0
  );

  /** The search matched nothing — offers a clear-search action, never read as an empty history. */
  protected readonly noMatch = computed(
    () => this.hasSearch() && this.visible().length === 0
  );

  /**
   * The pane's honest zero state when the emptiness is *not* a search miss: a
   * line specific to the switch view, never one generic message. `null` when
   * there are rows. Empty-Retired is the normal case (supplied Categories cannot
   * be retired); an empty Active view is only reachable with no supplied rows,
   * but a bare pane reads as a bug, so it gets a line too.
   */
  protected readonly emptyMessage = computed<string | null>(() => {
    if (this.hasSearch() || this.visible().length > 0) {
      return null;
    }
    const kind = this.heading().toLowerCase();
    switch (this.filter()) {
      case 'retired':
        return 'Nothing retired yet.';
      case 'active':
        return `No active ${kind} categories.`;
      default:
        return `No ${kind} categories yet.`;
    }
  });

  protected onSearch(value: string): void {
    this.search.set(value);
    this.moved.set(null);
  }

  protected clearSearch(): void {
    this.search.set('');
  }

  protected setFilter(value: PaneFilter): void {
    this.filter.set(value);
    this.moved.set(null);
    this.notice.set(null);
    this.confirmingDeleteId.set(null);
  }

  /**
   * Open the *New category* dialog for this pane, handed its kind. A successful
   * create re-reads the list so the row lands in order; Cancel, the close
   * control and Escape do nothing.
   */
  protected openAdd(): void {
    this.notice.set(null);
    this.confirmingDeleteId.set(null);
    this.moved.set(null);

    this.dialog
      .open<AddCategoryDialog, CategoryKind, Category>(AddCategoryDialog, {
        data: this.kind(),
      })
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((created) => {
        if (created) {
          this.changed.emit();
        }
      });
  }

  /**
   * Open the *Rename* dialog for one row, seeded with its Category. A successful
   * rename re-reads the list; Cancel, the close control and Escape do nothing.
   */
  protected openRename(category: Category): void {
    this.notice.set(null);
    this.confirmingDeleteId.set(null);
    this.moved.set(null);

    this.dialog
      .open<RenameCategoryDialog, Category, Category>(RenameCategoryDialog, {
        data: category,
      })
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((renamed) => {
        if (renamed) {
          this.changed.emit();
        }
      });
  }

  /** Retire an active Category, or bring a retired one back — fired directly, no confirmation. */
  protected setActive(category: Category, isActive: boolean): void {
    const hiddenAfter =
      (isActive && this.filter() === 'retired') ||
      (!isActive && this.filter() === 'active');

    this.runRowWrite(
      category.id,
      this.service.setActive(category.id, isActive),
      (error) => ({
        id: category.id,
        message: messageFor(error),
        retry: () => this.setActive(category, isActive),
      }),
      () => {
        this.moved.set(
          hiddenAfter
            ? {
                name: category.name,
                segment: isActive ? 'Active' : 'Retired',
                verb: isActive ? 'reactivated' : 'retired',
              }
            : null
        );
        this.changed.emit();
      }
    );
  }

  /** Ask on the row before deleting — kept even though the API refuses deletion for anything ever used. */
  protected askDelete(category: Category): void {
    this.notice.set(null);
    this.moved.set(null);
    this.confirmingDeleteId.set(category.id);
  }

  protected cancelDelete(): void {
    this.confirmingDeleteId.set(null);
  }

  protected confirmDelete(category: Category): void {
    this.confirmingDeleteId.set(null);
    this.runRowWrite(
      category.id,
      this.service.remove(category.id),
      (error) => this.noticeForFailedDelete(category, error),
      () => {
        this.moved.set(null);
        this.changed.emit();
      }
    );
  }

  /**
   * Mark the row busy, run the write, then run `onSuccess` — the screen re-read —
   * or pin the row a notice on failure. Only the failure wording differs between
   * callers.
   */
  private runRowWrite(
    id: number,
    write$: Observable<unknown>,
    noticeFor: (error: unknown) => RowNoticeState,
    onSuccess: () => void
  ): void {
    this.notice.set(null);
    this.busyId.set(id);

    write$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.busyId.set(null);
        onSuccess();
      },
      error: (error: unknown) => {
        this.busyId.set(null);
        this.notice.set(noticeFor(error));
      },
    });
  }

  /** Turn a failed delete into a row notice with the right way forward. */
  private noticeForFailedDelete(
    category: Category,
    error: unknown
  ): RowNoticeState {
    if (error instanceof CategoryInUseError) {
      if (category.isActive) {
        return {
          id: category.id,
          message: DELETE_BLOCKED_ACTIVE,
          retire: () => this.setActive(category, false),
        };
      }
      return { id: category.id, message: DELETE_BLOCKED_RETIRED };
    }
    return {
      id: category.id,
      message: messageFor(error),
      retry: () => this.confirmDelete(category),
    };
  }
}

/** The person-facing line for a retire / reactivate / delete failure that is not a delete block. */
function messageFor(error: unknown): string {
  return error instanceof ApiError ? error.message : ACTION_FAILED;
}
