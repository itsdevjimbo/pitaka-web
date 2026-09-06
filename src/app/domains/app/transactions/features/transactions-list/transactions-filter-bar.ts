import {
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  model,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { debounceTime, map, Subject } from 'rxjs';
import { Media } from '@/app/core/media';
import {
  activeCriteriaCount,
  TransactionCriteria,
  TransactionDirection,
  TRANSACTION_DIRECTIONS,
} from '../../data/transaction';

/**
 * How long the note field waits for typing to settle before it folds a value
 * into the criteria (#64). Long enough that a word typed at speed emits once,
 * short enough that the list still feels like it reacts to the search rather
 * than lagging it.
 */
export const NOTE_DEBOUNCE_MS = 300;

/**
 * One Account the filter bar offers as an option. A retired Account is offered
 * here — unlike the record form, which would be handing over something the API
 * rejects — because filtering by one is a valid question about history that
 * still exists (#40). `retired` marks it so a person understands why it has no
 * recent activity.
 */
export type FilterAccountOption = {
  id: number;
  name: string;
  retired: boolean;
};

/** One Category the bar offers, flat — nesting is discarded everywhere (ADR 0010, #40). */
export type FilterCategoryOption = {
  id: number;
  name: string;
};

/** The directions the bar offers, in reading order, labelled from the canonical record. */
const DIRECTION_OPTIONS = (['income', 'expense', 'transfer'] as const).map(
  (value) => ({ value, label: TRANSACTION_DIRECTIONS[value].label })
);

/**
 * Below this width the bar's controls fold behind a disclosure (#42); at it and
 * up they render inline. `640px` is the phone/desktop boundary this codebase
 * already draws — Tailwind's `sm` breakpoint, and the width the Material
 * overrides in `styles/components/material.css` switch at — named once here so
 * the JS collapse tracks the CSS layout.
 */
const PHONE_QUERY = '(max-width: 640px)';

/**
 * The bar that turns the Transactions list into an answer: a free-text field
 * for the note (#64), single-select controls for direction, Account and
 * Category, a `mat-date-range-input` for a date range (#65), all freely
 * combinable, with AND across the axes enforced by the server (#37). It owns no
 * list state and issues no reads — it is a controlled view over
 * {@link TransactionCriteria}: the current criteria come in, an edited copy goes
 * back out through the two-way `criteria`, and the page decides what a change
 * means (a fresh read, a reset to page 1). That split is what lets #41 move the
 * source of truth to the URL without touching this component.
 *
 * An axis with no selection emits **no criteria key at all**, not a key set to
 * `undefined`, so empty criteria are literally `{}` and the adapter sees no
 * parameter for that axis. The date range's two ends are independently optional
 * and each drops its key the same way when cleared. Which filters are active is
 * legible from the controls themselves — each shows its chosen value — and
 * summarised as a count beside a one-press **Clear filters** (the date range
 * counts once, however many ends are set).
 *
 * The note field leads the bar — it is the control reached for without deciding
 * anything first (#35) — and is **debounced** by {@link NOTE_DEBOUNCE_MS}, so a
 * word typed at speed folds one value into the criteria rather than one per
 * keystroke. Its value is trimmed on the way out and an all-whitespace or empty
 * field drops the `description` key entirely, the same "absent means unfiltered"
 * contract as every other axis. The match itself is the API's — case-insensitive
 * substring over the note alone (pitaka#73) — and is not reproduced here.
 *
 * The date-range ends are held as the person picked them — inclusive calendar
 * days — and the adapter turns `to` into the API's exclusive bound and drops an
 * inverted range before the wire (`date-range-bounds.ts`, #65). This component
 * does no date arithmetic and no wire shaping.
 *
 * **At phone width** ({@link PHONE_QUERY}) every control but the note search
 * folds behind a disclosure (#42): the search stays out in the open — it is the
 * one control reached for without deciding anything first (#35) — and the
 * toggle beside it carries the active-filter count, so a narrowed list is never
 * mistaken for the whole picture while the controls are hidden. Opening or
 * closing the disclosure is pure view state ({@link TransactionsFilterBar.isOpen});
 * it never touches the criteria. From the small breakpoint up the disclosure is
 * gone and the controls render inline; growing the viewport back past the
 * breakpoint drops straight to that inline layout, disclosure state and all.
 */
@Component({
  selector: 'transactions-filter-bar',
  templateUrl: './transactions-filter-bar.html',
  imports: [
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
    MatDatepickerModule,
  ],
  host: {
    class: 'block',
  },
})
export class TransactionsFilterBar {
  private readonly destroyRef = inject(DestroyRef);
  private readonly media = inject(Media);

  /** Every Account the person owns, retired ones included and marked. */
  readonly accounts = input<readonly FilterAccountOption[]>([]);

  /** The person's Categories, flat, from the shared reference cache. */
  readonly categories = input<readonly FilterCategoryOption[]>([]);

  /**
   * The active criteria, two-way. The page holds the source of truth and reacts
   * to a change; this component only reads it into the controls and writes an
   * edited copy back.
   */
  readonly criteria = model<TransactionCriteria>({});

  protected readonly directionOptions = DIRECTION_OPTIONS;

  /** How many axes are narrowed — shown beside Clear filters, and gates it. */
  protected readonly activeCount = computed(() =>
    activeCriteriaCount(this.criteria())
  );

  /** True below {@link PHONE_QUERY} — the width at which the controls collapse. */
  protected readonly isPhone = this.media.match(PHONE_QUERY);

  /**
   * Whether the phone-width disclosure is open. Pure view state — toggling it
   * shows or hides the controls but never edits `criteria`. Reset whenever the
   * viewport grows past the breakpoint (see the constructor), so shrinking back
   * lands on a shut disclosure rather than a stale open one. Ignored from the
   * small breakpoint up, where the controls always show.
   */
  protected readonly isOpen = signal(false);

  /**
   * Whether the controls (everything but the note search) are shown: always from
   * the small breakpoint up, only while the disclosure is open below it. The
   * controls stay mounted either way — the template hides them with `hidden`
   * rather than removing them — so the disclosure's `aria-controls` always
   * resolves and a mid-edit `mat-select` keeps its state across a toggle.
   */
  protected readonly showControls = computed(
    () => !this.isPhone() || this.isOpen()
  );

  /**
   * Every raw keystroke in the note field. Debounced and trimmed before it
   * reaches the criteria, so a burst of typing is one edit and a value that
   * trims to nothing drops the axis.
   */
  private readonly noteInput = new Subject<string>();

  constructor() {
    // The disclosure is a phone-width affordance; once the controls render
    // inline there is nothing to keep open, and leaving it open would surprise
    // a viewport that later shrinks back.
    effect(() => {
      if (!this.isPhone()) {
        this.isOpen.set(false);
      }
    });

    this.noteInput
      .pipe(
        debounceTime(NOTE_DEBOUNCE_MS),
        map((raw) => raw.trim()),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((note) => {
        // De-dupe against the criteria itself, not the last keystroke: after
        // Clear filters wipes the field, retyping the same term must still
        // re-narrow the list.
        const next = note === '' ? undefined : note;
        if (next !== this.criteria().description) {
          this.patch('description', next ?? null);
        }
      });
  }

  /** A keystroke in the note field — folded into the criteria once typing settles. */
  protected onNoteInput(value: string): void {
    this.noteInput.next(value);
  }

  /** Open or shut the phone-width disclosure. Leaves the active filters alone. */
  protected toggleOpen(): void {
    this.isOpen.update((open) => !open);
  }

  protected setDirection(value: TransactionDirection | null): void {
    this.patch('direction', value);
  }

  protected setAccount(value: number | null): void {
    this.patch('accountId', value);
  }

  protected setCategory(value: number | null): void {
    this.patch('categoryId', value);
  }

  /** The start of the date range — an inclusive calendar day, or unset. */
  protected setDateFrom(value: Date | null): void {
    this.patch('from', value);
  }

  /** The end of the date range — an inclusive calendar day, or unset. */
  protected setDateTo(value: Date | null): void {
    this.patch('to', value);
  }

  /** Restore the full list in one action — every axis unset. */
  protected clear(): void {
    this.criteria.set({});
  }

  /**
   * Fold one axis into the criteria, or drop its key entirely when the person
   * chose the "Any" option (`null`). Dropping rather than setting `undefined`
   * keeps `{}` the honest shape of no filters and the adapter free of an empty
   * parameter.
   */
  private patch<K extends keyof TransactionCriteria>(
    key: K,
    value: TransactionCriteria[K] | null
  ): void {
    const next = { ...this.criteria() };
    if (value === null) {
      delete next[key];
    } else {
      next[key] = value;
    }
    this.criteria.set(next);
  }
}
