/**
 * A label classifying a Transaction as a kind of income or expense (see
 * `CONTEXT.md`). The API's names pass through unchanged (ADR 0003 translates
 * only three terms, and this is none of them).
 *
 * The hand-written type keeps an id, a name, and — since a form that records a
 * Transaction offers only Categories of the chosen direction (ADR 0010) — the
 * income/expense `kind`. The API also attaches `isDefault` and `parentId`;
 * nothing above the adapter reads those, so it drops them the way `toAccount`
 * drops an Account's owner id. Nesting is discarded on purpose: the API rejects
 * a direct self-reference but not a deeper cycle, and a tree renderer over that
 * can loop.
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
