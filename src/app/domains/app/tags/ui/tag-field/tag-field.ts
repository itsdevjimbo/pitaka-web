import {
  Component,
  DestroyRef,
  ElementRef,
  computed,
  inject,
  model,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  MatAutocompleteActivatedEvent,
  MatAutocompleteModule,
  MatAutocompleteSelectedEvent,
  MatAutocompleteTrigger,
} from '@angular/material/autocomplete';
import { MatChipInputEvent, MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { ApiError } from '@/app/core/api';
import { Tag } from '../../data/tag';
import { TagsService } from '../../data/tags.service';

/** The synthetic option that stands for "make a new Tag from what is typed". */
const CREATE = Symbol('create-tag');

/** The one line shown when the option set could not be fetched. */
const LOAD_FAILED = 'Tags couldn’t be loaded.';

/**
 * The Tag entry control on the record and refile transaction forms — the app's
 * first chip field and first autocomplete, introduced deliberately (`@angular/
 * material` has both; nothing else in the app uses either, so there is no house
 * pattern to follow). Chips sit inside the field, the autocomplete opens
 * beneath, and choosing an existing Tag and making a new one are the **same
 * gesture**: you type a name and you get that Tag, and whether it already
 * existed is this control's problem, not the person's.
 *
 * `selected` is the two-way model the form binds — the chips, and the ids it
 * sends. Record opens it empty; refile seeds it from the Transaction's own Tags
 * (not from a fetch), so those chips survive even a failed option load.
 *
 * **The Enter collision is the sharpest trap here.** Material's autocomplete
 * reads Enter as "take the highlighted option"; the chip input reads it as
 * "commit what I typed". Both fire on the one keystroke (the autocomplete
 * `preventDefault`s but does not stop propagation). The highlighted option
 * wins — `onOptionSelected` handles it and `commitTyped` bails — and raw text
 * is committed only when **nothing** is highlighted, which is exactly when
 * nothing matched. Typing `gro` with `groceries` highlighted must never create
 * a Tag called `gro`.
 *
 * `Create "…"` shows only when nothing matches, which makes the duplicate-name
 * `409` structurally rare rather than something to explain. A name that already
 * exists attaches the existing Tag **silently** — no error, no after-the-fact
 * hint — because the outcome matches what was asked for. This differs on
 * purpose from the Tags screen's add field (#140), where creating is the whole
 * gesture and being told the Tag already exists is useful.
 *
 * An inline create attaches the row the `POST` returns and appends it to this
 * control's **own** option source. `TagsService.create` drops the shared cache
 * from inside the service as usual, but that drop pushes nothing here — this is
 * not patching the shared cache (ADR 0017 forbids it); the appended row lives
 * in the control and is allowed to lag by the same argument that permits the
 * cache at all.
 *
 * A failed fetch of the option set **disables the field** with a short line —
 * with the set unloaded everything looks new, so a live field would offer to
 * create Tags that already exist and race a `409` per keystroke. The rest of
 * the form saves normally.
 */
@Component({
  selector: 'tags-tag-field',
  templateUrl: './tag-field.html',
  imports: [
    MatFormFieldModule,
    MatChipsModule,
    MatAutocompleteModule,
    MatIconModule,
  ],
})
export class TagField {
  // Dependencies
  private service = inject(TagsService);
  private destroyRef = inject(DestroyRef);

  /** The chips on the field — the Tags the Transaction will carry. Two-way. */
  readonly selected = model<readonly Tag[]>([]);

  protected readonly CREATE = CREATE;
  protected readonly loadFailedMessage = LOAD_FAILED;

  private readonly input =
    viewChild<ElementRef<HTMLInputElement>>('tagInput');
  private readonly autocompleteTrigger = viewChild(MatAutocompleteTrigger);

  /** The fetched option set — `null` until the first read settles. */
  private readonly fetched = signal<readonly Tag[] | null>(null);

  /** Tags created inline this session — appended to this control's own options. */
  private readonly created = signal<readonly Tag[]>([]);

  /** `true` once the option fetch has failed: the field goes disabled. */
  protected readonly loadFailed = signal(false);

  /** What is in the text input right now, driving the local filter. */
  protected readonly query = signal('');

  /** The autocomplete option the keyboard has highlighted, or `null`. */
  private readonly activeOption = signal<Tag | typeof CREATE | null>(null);

  /** `true` while a create request is in flight — one gesture, one request. */
  private readonly creating = signal(false);

  protected readonly trimmedQuery = computed(() => this.query().trim());

  /** Every Tag this control knows about: the fetched set plus inline creations. */
  private readonly known = computed(() => {
    const byId = new Map<number, Tag>();
    for (const tag of this.fetched() ?? []) {
      byId.set(tag.id, tag);
    }
    for (const tag of this.created()) {
      byId.set(tag.id, tag);
    }
    return [...byId.values()];
  });

  /** The options offered: the known set minus the chips, narrowed by the query. */
  protected readonly filteredOptions = computed(() => {
    const query = this.trimmedQuery().toLocaleLowerCase();
    const chosen = new Set(this.selected().map((tag) => tag.id));
    return this.known()
      .filter((tag) => !chosen.has(tag.id))
      .filter((tag) => !query || tag.name.toLocaleLowerCase().includes(query))
      .sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      );
  });

  /**
   * `Create "…"` shows only when the query names nothing that already exists —
   * no option matched it, and no known Tag (chosen or not) carries that exact
   * name. Withheld while the field is disabled.
   */
  protected readonly showCreate = computed(() => {
    const query = this.trimmedQuery().toLocaleLowerCase();
    if (!query || this.loadFailed() || this.filteredOptions().length > 0) {
      return false;
    }
    return !this.known().some(
      (tag) => tag.name.toLocaleLowerCase() === query
    );
  });

  constructor() {
    this.service
      .all()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (tags) => this.fetched.set(tags),
        error: () => this.loadFailed.set(true),
      });
  }

  /**
   * Each keystroke re-filters and drops any highlight — Material's key manager
   * resets its active item on input too. Clearing it here (and on {@link
   * onClosed}), *not* inside {@link attach}, is what makes the Enter collision
   * order-independent: whichever of the two keydown handlers runs first, the
   * other still sees the highlight and defers.
   */
  protected onInput(value: string): void {
    this.query.set(value);
    this.activeOption.set(null);
  }

  protected onOptionActivated(event: MatAutocompleteActivatedEvent): void {
    this.activeOption.set(
      (event.option?.value as Tag | typeof CREATE | undefined) ?? null
    );
  }

  /** The panel closed: nothing is highlighted any more. */
  protected onClosed(): void {
    this.activeOption.set(null);
  }

  /**
   * A highlighted option was taken — by click, or by Enter with the panel open.
   * This is the authority for the highlighted-option-wins case; {@link
   * commitTyped} steps aside whenever an option is active.
   */
  protected onOptionSelected(event: MatAutocompleteSelectedEvent): void {
    const value = event.option.value as Tag | typeof CREATE;
    if (value === CREATE) {
      this.createAndAttach(this.trimmedQuery());
    } else {
      this.attach(value);
    }
  }

  /**
   * Enter (or another separator) in the input. If an option is highlighted,
   * {@link onOptionSelected} owns this keystroke and we do nothing. Otherwise
   * the raw text is committed: an exact name match attaches that Tag silently,
   * anything else creates.
   */
  protected commitTyped(event: MatChipInputEvent): void {
    if (this.activeOption() !== null) {
      return;
    }
    const name = (event.value ?? '').trim();
    event.chipInput.clear();
    this.query.set('');
    if (!name) {
      return;
    }
    const existing = this.byName(name);
    if (existing) {
      this.attach(existing);
    } else {
      this.createAndAttach(name);
    }
  }

  /** Backspace on an empty input detaches the last chip (the × does the same). */
  protected onBackspace(event: Event, input: HTMLInputElement): void {
    const chips = this.selected();
    if (input.value !== '' || chips.length === 0) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    this.remove(chips[chips.length - 1]);
  }

  protected remove(tag: Tag): void {
    this.selected.set(this.selected().filter((chip) => chip.id !== tag.id));
  }

  /**
   * Create a Tag and attach the row the `POST` returns. A name that turns out
   * to already exist — either found locally, or a `409` race against a stale
   * list — attaches the existing Tag silently, with nothing surfaced.
   */
  private createAndAttach(rawName: string): void {
    const name = rawName.trim();
    if (!name || this.creating()) {
      return;
    }
    const existing = this.byName(name);
    if (existing) {
      this.attach(existing);
      return;
    }

    this.creating.set(true);
    this.service
      .create(name)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (tag) => {
          this.creating.set(false);
          this.created.update((rows) => [...rows, tag]);
          this.attach(tag);
        },
        error: (error: unknown) => {
          this.creating.set(false);
          if (error instanceof ApiError && error.status === 409) {
            this.resolveConflict(name);
          }
          // Anything else: no chip is added and the field stays usable. The
          // person can try the name again.
        },
      });
  }

  /** A duplicate-name `409`: re-read the set and attach the real row, silently. */
  private resolveConflict(name: string): void {
    this.service
      .all()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (tags) => {
          const match = tags.find(
            (tag) =>
              tag.name.toLocaleLowerCase() === name.toLocaleLowerCase()
          );
          if (match) {
            this.created.update((rows) => [...rows, match]);
            this.attach(match);
          }
        },
        error: () => undefined,
      });
  }

  private attach(tag: Tag): void {
    if (!this.selected().some((chip) => chip.id === tag.id)) {
      this.selected.set([...this.selected(), tag]);
    }
    this.query.set('');
    const el = this.input()?.nativeElement;
    if (el) {
      el.value = '';
    }
    // Closing the panel fires `(closed)` → `onClosed`, which clears the
    // highlight. Not cleared here directly — see `onInput`.
    this.autocompleteTrigger()?.closePanel();
  }

  private byName(name: string): Tag | undefined {
    const needle = name.toLocaleLowerCase();
    return this.known().find(
      (tag) => tag.name.toLocaleLowerCase() === needle
    );
  }
}
