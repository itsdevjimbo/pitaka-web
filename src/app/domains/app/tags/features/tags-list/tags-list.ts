import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  Signal,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { ApiError } from '@/app/core/api';
import { RowNotice } from '@/app/core/notices';
import { Tag } from '../../data/tag';
import { TagsService } from '../../data/tags.service';

/** The longest a Tag name may be — mirrors the API's `[MaxLength(255)]`, set on the inputs. */
const NAME_MAX = 255;

const LOAD_FAILED = 'Something went wrong loading your tags. Please try again.';

/** The re-read after a write failed: the change landed, the list may be stale. */
const REFRESH_FAILED =
  'Your change was saved, but this list may be out of date. Try again to refresh it.';

/** A write failed before the server could attribute it to anything. */
const ACTION_FAILED = 'Something went wrong. Please try again.';

/**
 * The 403 / 404 an honest person cannot reach on a freshly-read list — someone
 * else's Tag, or an id that is already gone. Both mean the list is stale, so
 * both re-read it and neither offers a Retry (retrying a 404 just fails again).
 */
const STALE = 'That tag is no longer there.';

/**
 * The one wording for a duplicate name, shared by the add field and the rename
 * field. Follows `duplicateCategoryNameMessage` minus its cross-kind clause,
 * which has nothing to attach to here. This deliberately differs from the entry
 * control on the transaction forms (#141), which attaches the existing Tag
 * silently: there the gesture is *attach*; here there is nothing to attach, so
 * it must speak.
 */
function duplicateNameMessage(name: string): string {
  return `You already have a tag called “${name}”.`;
}

/** A message pinned to one row after a delete failed for a reason that is not staleness. */
type RowNoticeState = { id: number; message: string; retry: () => void };

/**
 * The Tags screen: `/app/tags`, reached from the *Manage* navigation group. One
 * flat list of `{ id, name }` — no kind, no active axis, so no pane to split
 * into and no detail route. The screen owns its count, search, inline add field
 * and rows directly.
 *
 * It reads **cold** — `TagsService.readAll()`, whole-set and cache-bypassing —
 * and re-reads after every successful write (a flat row with no derived field
 * makes this cheap). Its writes invalidate the shared cache the transaction-form
 * autocomplete reads, but it never reads through that cache itself: one
 * direction of dependency, not two (#139).
 *
 * Three acts, not five — there is no retire on the wire. **Create** is an inline
 * field at the top, not a dialog, because Tags arrive in bursts; on success it
 * clears and keeps focus. **Rename** edits the name in place on the row, the
 * same control shape as the add field, so there is exactly one way to type a Tag
 * name here; it commits on Enter or blur, abandons on Escape, and a rename to
 * the Tag's own current name is a no-op the client swallows. **Delete** is an
 * inline confirm strip (the house pattern) whose wording states the effect as a
 * certainty — `DELETE /api/tags/{id}` has no in-use guard, so this is the first
 * delete in the app with no server-side backstop, and the explicit "can't be
 * undone" is earned.
 *
 * Zero Tags is every person's first view — nothing seeds one. The zero state
 * replaces the search and the count (a search box over an empty room searches
 * nothing) but keeps the add field, which is the only way out of zero, and
 * teaches that Tags are attached while filing — the one place that explanation
 * lives.
 */
@Component({
  selector: 'tags-list',
  templateUrl: './tags-list.html',
  imports: [MatButtonModule, MatIconModule, MatMenuModule, RowNotice],
  host: {
    class: 'flex flex-auto flex-col',
  },
})
export default class TagsList {
  // Dependencies
  private service = inject(TagsService);
  private destroyRef = inject(DestroyRef);
  private injector = inject(Injector);

  // Constants
  protected readonly nameMax = NAME_MAX;

  /**
   * The one Tailwind shell every inline name field wears — the search box, the
   * add field and the in-place rename field — so there is visibly exactly one
   * way to type a Tag name here.
   */
  protected readonly fieldClass =
    'w-full rounded-lg border border-neutral-200 bg-transparent py-1.5 pr-3 pl-8 text-sm disabled:opacity-50 dark:border-neutral-800';

  // State
  protected readonly tags = signal<readonly Tag[] | null>(null);
  protected readonly loading = signal(true);
  protected readonly errorMessage = signal<string | null>(null);

  /** Set when the re-read after a write fails — the rows stay, an inline retry re-runs it. */
  protected readonly refreshError = signal<string | null>(null);

  /** The staleness line for a 403 / 404 on rename or delete — re-reads, no Retry. */
  protected readonly staleMessage = signal<string | null>(null);

  protected readonly search = signal('');

  /** A message under the add field: a duplicate name, or a generic add failure. */
  protected readonly addError = signal<string | null>(null);

  /** `true` while a create is in flight — disables the add field so one gesture sends one request. */
  protected readonly adding = signal(false);

  /** The id of the row being renamed in place, or `null`. */
  protected readonly editingId = signal<number | null>(null);

  /** A message under the rename field: a duplicate name, or a generic rename failure. */
  protected readonly editError = signal<string | null>(null);

  /** The id of the row whose delete is awaiting confirmation, or `null`. */
  protected readonly confirmingDeleteId = signal<number | null>(null);

  /** The id of the row with a rename or delete request in flight. */
  protected readonly busyId = signal<number | null>(null);

  /** A per-row message left by a failed delete that was not staleness. */
  protected readonly notice = signal<RowNoticeState | null>(null);

  private readonly addInput =
    viewChild<ElementRef<HTMLInputElement>>('addInput');
  private readonly editInput =
    viewChild<ElementRef<HTMLInputElement>>('editInput');

  /** Alphabetical, case-insensitive — there is no `createdAt` or usage count to sort by. */
  private readonly sorted = computed(() =>
    [...(this.tags() ?? [])].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    )
  );

  protected readonly trimmedSearch = computed(() => this.search().trim());

  /** What is on screen: the whole set, narrowed by the search. */
  protected readonly visible = computed(() => {
    const query = this.trimmedSearch().toLocaleLowerCase();
    if (!query) {
      return this.sorted();
    }
    return this.sorted().filter((tag) =>
      tag.name.toLocaleLowerCase().includes(query)
    );
  });

  /** `true` once the person has at least one Tag — gates the search and the count. */
  protected readonly hasTags = computed(() => this.sorted().length > 0);

  /** The count beside the search — the whole set, not the search-narrowed view. */
  protected readonly count = computed(() => this.sorted().length);

  protected readonly hasSearch = computed(
    () => this.trimmedSearch().length > 0
  );

  /** The search matched nothing — offers a clear-search action, never read as an empty collection. */
  protected readonly noMatch = computed(
    () => this.hasSearch() && this.visible().length === 0
  );

  constructor() {
    this.load();
    // The add field is the only way out of the zero state, so it opens focused.
    this.focusOnceRendered(this.addInput);
  }

  /** Read the whole set cold. Bound to the failed-load retry. */
  protected load(): void {
    this.loading.set(true);
    this.errorMessage.set(null);
    this.refreshError.set(null);
    this.staleMessage.set(null);

    this.service
      .readAll()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (tags) => {
          this.tags.set(tags);
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
   * Re-read the whole set after a successful write. A failure keeps the rows on
   * screen — now one write stale — under an inline retry. After a delete this
   * leaves the deleted row standing, and it stands: removing it locally would
   * invent a list state the client never read, while the strip already says
   * what happened. Bound to the refresh strip's *Try again*, which re-runs this
   * read without disturbing the rows — unlike {@link load}, which is for a first
   * load that has no rows to keep.
   */
  protected reload(): void {
    this.refreshError.set(null);

    this.service
      .readAll()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (tags) => this.tags.set(tags),
        error: () => this.refreshError.set(REFRESH_FAILED),
      });
  }

  protected onSearch(value: string): void {
    this.search.set(value);
  }

  protected clearSearch(): void {
    this.search.set('');
  }

  /**
   * Create a Tag from the inline field. Trim, then refuse empty locally — Enter
   * on an empty or whitespace-only field does nothing. On success the field
   * clears and keeps focus; the alphabetical re-sort moves the new row into
   * view, so there is no flash.
   */
  protected addTag(raw: string): void {
    const name = raw.trim();
    this.addError.set(null);
    this.staleMessage.set(null);
    if (!name || this.adding()) {
      return;
    }

    this.adding.set(true);
    this.service
      .create(name)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.adding.set(false);
          const input = this.addInput()?.nativeElement;
          if (input) {
            input.value = '';
          }
          this.focusOnceRendered(this.addInput);
          this.reload();
        },
        error: (error: unknown) => {
          this.adding.set(false);
          this.addError.set(
            error instanceof ApiError && error.status === 409
              ? duplicateNameMessage(name)
              : error instanceof ApiError
                ? error.message
                : ACTION_FAILED
          );
        },
      });
  }

  /** Open one row for renaming. Rename and Delete are the row menu's only items. */
  protected startRename(tag: Tag): void {
    this.notice.set(null);
    this.confirmingDeleteId.set(null);
    this.editError.set(null);
    this.staleMessage.set(null);
    this.editingId.set(tag.id);
    this.focusOnceRendered(this.editInput);
  }

  /** Escape abandons the edit with no request. */
  protected cancelRename(): void {
    this.editingId.set(null);
    this.editError.set(null);
  }

  /**
   * Commit a rename on Enter or blur. An empty field abandons — blur-commit has
   * to be safe. A rename to the Tag's own current name is swallowed: no request,
   * so nobody is told their name conflicts with itself.
   */
  protected commitRename(tag: Tag, raw: string): void {
    if (this.editingId() !== tag.id || this.busyId() === tag.id) {
      return;
    }
    const name = raw.trim();
    if (!name || name === tag.name) {
      this.editingId.set(null);
      this.editError.set(null);
      return;
    }

    this.editError.set(null);
    this.busyId.set(tag.id);
    this.service
      .rename(tag.id, name)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.busyId.set(null);
          this.editingId.set(null);
          this.reload();
        },
        error: (error: unknown) => {
          this.busyId.set(null);
          if (error instanceof ApiError && error.status === 409) {
            this.editError.set(duplicateNameMessage(name));
          } else if (this.isStale(error)) {
            this.editingId.set(null);
            this.goStale();
          } else {
            this.editError.set(
              error instanceof ApiError ? error.message : ACTION_FAILED
            );
          }
        },
      });
  }

  protected askDelete(tag: Tag): void {
    this.notice.set(null);
    this.staleMessage.set(null);
    this.editingId.set(null);
    this.confirmingDeleteId.set(tag.id);
  }

  protected cancelDelete(): void {
    this.confirmingDeleteId.set(null);
  }

  /**
   * Delete a Tag. No inline acknowledgement afterwards — the confirm strip was
   * the feedback, and the row vanishing is that sentence coming true.
   */
  protected confirmDelete(tag: Tag): void {
    this.confirmingDeleteId.set(null);
    this.notice.set(null);
    this.busyId.set(tag.id);
    this.service
      .remove(tag.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.busyId.set(null);
          this.reload();
        },
        error: (error: unknown) => {
          this.busyId.set(null);
          if (this.isStale(error)) {
            this.goStale();
          } else {
            this.notice.set({
              id: tag.id,
              message: error instanceof ApiError ? error.message : ACTION_FAILED,
              retry: () => this.confirmDelete(tag),
            });
          }
        },
      });
  }

  private isStale(error: unknown): boolean {
    return (
      error instanceof ApiError &&
      (error.status === 403 || error.status === 404)
    );
  }

  /**
   * A 403 / 404 means the list is stale: show the one line, drop any open edit
   * or confirm, and re-read so the vanished row falls away. No Retry — retrying
   * a 404 just fails again. A failed re-read here is swallowed; the person still
   * has the line telling them what happened.
   */
  private goStale(): void {
    this.notice.set(null);
    this.editingId.set(null);
    this.confirmingDeleteId.set(null);
    this.staleMessage.set(STALE);

    this.service
      .readAll()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (tags) => this.tags.set(tags),
        error: () => undefined,
      });
  }

  /** Focus a view-child input on the render after it appears. */
  private focusOnceRendered(
    ref: Signal<ElementRef<HTMLInputElement> | undefined>
  ): void {
    afterNextRender(() => ref()?.nativeElement.focus(), {
      injector: this.injector,
    });
  }
}
