/**
 * A label classifying a Transaction as a kind of income or expense (see
 * `CONTEXT.md`). The API's names pass through unchanged (ADR 0003 translates
 * only three terms, and this is none of them).
 *
 * The hand-written type keeps only what a caller resolving a Transaction's
 * Category needs — an id and a name. The API also attaches `type`, `isDefault`,
 * and `parentId`; nothing that reads this screen uses them, so the adapter
 * drops them the way `toAccount` drops an Account's owner id.
 */
export type Category = {
  id: number;
  name: string;
};
