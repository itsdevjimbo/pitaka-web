/**
 * A label classifying a Transaction as a kind of income or expense (see
 * `CONTEXT.md`). The API's names pass through unchanged (ADR 0003 translates
 * only three terms, and this is none of them).
 *
 * The hand-written type keeps an id, a name, the income/expense `kind` — since a
 * form that records a Transaction offers only Categories of the chosen direction
 * (ADR 0010) — and `isActive`. That last one is lifted rather than dropped
 * because *Retired* has to be rendered from the wire: a badge on a management
 * row, a `Retired` marker on a filter option. Inferring retiredness from a
 * Category being absent from `list()` was rejected — it silently becomes wrong
 * the first time `list()` narrows for some other reason (ADR 0017).
 *
 * The API also attaches `isDefault`, which nothing above the adapter reads yet,
 * so it is dropped the way `toAccount` drops an Account's owner id.
 */
export type Category = {
  id: number;
  name: string;
  kind: CategoryKind;
  isActive: boolean;
};

/**
 * Which side of the ledger a Category classifies. The API's `CategoryType` has
 * exactly these two members — a Transfer is neither, and carries no Category at
 * all (ADR 0010) — lowered here to the same spelling as the matching
 * `TransactionDirection` members, so the record form can filter one list
 * against the other.
 */
export type CategoryKind = 'income' | 'expense';

/**
 * What it takes to create a Category: a name and the `kind` the pane it was
 * typed into stands for. The kind is settled at creation and never changes —
 * `PUT` will not move it — so a rename carries a name alone.
 */
export type NewCategory = {
  name: string;
  kind: CategoryKind;
};
