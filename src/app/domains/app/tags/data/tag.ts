/**
 * A free-form label the person attaches to Transactions to cut across Categories
 * (see `CONTEXT.md`). A Transaction may carry many. The API's name passes
 * through unchanged (ADR 0003 translates only three terms, and this is none of
 * them).
 *
 * The hand-written type is an id and a name and nothing else, because the wire
 * `TagResource` is exactly that: there is nothing to adapt away, so this type is
 * the wire shape one-to-one.
 *
 * `transactions/data/transaction.ts` re-exports this rather than declaring its
 * own: a Transaction carries `tags: readonly Tag[]` with names embedded, and the
 * dependency runs transactions → tags, the way Account detail imports from
 * `transactions/` (ADR 0009).
 */
export type Tag = {
  id: number;
  name: string;
};
