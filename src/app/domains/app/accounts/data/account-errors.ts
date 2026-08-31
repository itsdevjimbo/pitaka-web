/**
 * Lifecycle-write failures a screen has to word specifically, lifted out of the
 * generic `ApiError` so callers branch on a type rather than on server prose.
 *
 * The API answers each with a bare `409 Conflict` + a ProblemDetails `detail`
 * and nothing machine-readable to tell them apart. Which meaning a 409 on these
 * endpoints carries is a fact about the resource, so `AccountsService` reads the
 * `detail` once, at the seam, and re-throws one of these — the same move
 * `asNameConflict` makes when it refiles a duplicate-name 409 as a field error.
 */

/** Why a delete was refused: the person is pointed somewhere different for each. */
export type DeleteBlockReason =
  /** The Account has Transaction history — retire it instead of deleting. */
  | 'transaction-history'
  /** The Account holds money allocated to a Goal — resolve the Goal first. */
  | 'goal-allocation';

/** `DELETE /api/accounts/{id}` refused because the Account is not empty. */
export class AccountDeleteBlockedError extends Error {
  constructor(
    readonly reason: DeleteBlockReason,
    message: string
  ) {
    super(message);
    this.name = 'AccountDeleteBlockedError';
  }
}

/**
 * A rename, retire, reactivate, or delete refused with the API's optimistic-
 * concurrency 409 — the Account moved underneath the person (another tab,
 * another device) since the list was read. The person is told it moved and
 * offered a retry rather than silently overwriting the newer value.
 */
export class AccountModifiedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccountModifiedError';
  }
}
