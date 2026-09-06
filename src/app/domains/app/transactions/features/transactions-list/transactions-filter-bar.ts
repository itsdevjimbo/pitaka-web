import { Component, computed, input, model } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import {
  TransactionCriteria,
  TransactionDirection,
  TRANSACTION_DIRECTIONS,
} from '../../data/transaction';

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

/** The keys of {@link TransactionCriteria}, for counting and stripping axes. */
const CRITERIA_KEYS: readonly (keyof TransactionCriteria)[] = [
  'direction',
  'accountId',
  'categoryId',
];

/**
 * The bar that turns the Transactions list into an answer: single-select
 * controls for direction, Account and Category, freely combinable, with AND
 * across the axes enforced by the server (#37). It owns no list state and issues
 * no reads — it is a controlled view over {@link TransactionCriteria}: the
 * current criteria come in, an edited copy goes back out through the two-way
 * `criteria`, and the page decides what a change means (a fresh read, a reset to
 * page 1). That split is what lets #41 move the source of truth to the URL
 * without touching this component, and #64/#65 add their axis as one more
 * control and one more criteria field rather than a rebuild.
 *
 * An axis with no selection emits **no criteria key at all**, not a key set to
 * `undefined`, so empty criteria are literally `{}` and the adapter sees no
 * parameter for that axis. Which filters are active is legible from the controls
 * themselves — each shows its chosen value — and summarised as a count beside a
 * one-press **Clear filters**.
 *
 * Phone-width collapsing is #42's; this renders the controls inline.
 */
@Component({
  selector: 'transactions-filter-bar',
  templateUrl: './transactions-filter-bar.html',
  imports: [
    MatFormFieldModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
  ],
  host: {
    class: 'block',
  },
})
export class TransactionsFilterBar {
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
  protected readonly activeCount = computed(() => {
    const criteria = this.criteria();
    return CRITERIA_KEYS.filter((key) => criteria[key] !== undefined).length;
  });

  protected setDirection(value: TransactionDirection | null): void {
    this.patch('direction', value);
  }

  protected setAccount(value: number | null): void {
    this.patch('accountId', value);
  }

  protected setCategory(value: number | null): void {
    this.patch('categoryId', value);
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
  private patch(
    key: keyof TransactionCriteria,
    value: TransactionDirection | number | null
  ): void {
    const next = { ...this.criteria() };
    if (value === null) {
      delete next[key];
    } else {
      next[key] = value as never;
    }
    this.criteria.set(next);
  }
}
