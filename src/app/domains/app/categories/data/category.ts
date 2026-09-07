/**
 * A label classifying a Transaction as a kind of income or expense (see
 * `CONTEXT.md`). The API's names pass through unchanged (ADR 0003 translates
 * only three terms, and this is none of them).
 *
 * The hand-written type keeps an id, a name, the income/expense `kind` — since a
 * form that records a Transaction offers only Categories of the chosen direction
 * (ADR 0010) — `isActive`, and `isDefault`. `isActive` is lifted rather than
 * dropped because *Retired* has to be rendered from the wire: a badge on a
 * management row, a `Retired` marker on a filter option. Inferring retiredness
 * from a Category being absent from `list()` was rejected — it silently becomes
 * wrong the first time `list()` narrows for some other reason (ADR 0017).
 *
 * `isDefault` is `true` for a Category Pitaka supplies rather than one the person
 * created. The Categories screen reads it to badge a supplied row and withhold
 * its action menu — the API Forbids `PUT`, `PATCH` and `DELETE` on those rows
 * (#107), so the menu would only ever raise a 403. It was dropped until a screen
 * needed it; the screen that manages the collection is that screen.
 */
export type Category = {
  id: number;
  name: string;
  kind: CategoryKind;
  isActive: boolean;

  /** `true` when Pitaka supplies the Category; such a row is read-only. */
  isDefault: boolean;
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

/**
 * The longest a Category name may be. Mirrors the API's `[MaxLength(255)]` on
 * both `CreateCategoryRequest.Name` and `UpdateCategoryRequest.Name`, so the
 * add field and the rename form share one figure.
 */
export const CATEGORY_NAME_MAX = 255;
