/**
 * A label classifying a Transaction as a kind of income or expense (see
 * `CONTEXT.md`). The API's names pass through unchanged (ADR 0003 translates
 * only three terms, and this is none of them).
 *
 * The hand-written type keeps an id, a name, and — since a form that records a
 * Transaction offers only Categories of the chosen direction (ADR 0010) — the
 * income/expense `kind`. The API also attaches `isDefault` and `isActive`;
 * nothing above the adapter reads those yet, so it drops them the way
 * `toAccount` drops an Account's owner id. Nesting is gone: the API dropped
 * `parentId`, so there is no tree to model.
 */
export type Category = {
  id: number;
  name: string;
  kind: CategoryKind;
};

/**
 * Which side of the ledger a Category classifies. The API's `CategoryType` has
 * exactly these two members — a Transfer is neither, and carries no Category at
 * all (ADR 0010) — lowered here to the same spelling as the matching
 * `TransactionDirection` members, so the record form can filter one list
 * against the other.
 */
export type CategoryKind = 'income' | 'expense';
