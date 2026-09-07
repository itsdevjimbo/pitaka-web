/**
 * A delete-write failure a screen has to word specifically, lifted out of the
 * generic `ApiError` so callers branch on a type rather than on server prose —
 * the same move `AccountsService` makes with `AccountDeleteBlockedError`.
 *
 * Unlike the Accounts endpoints, where one `409` carries several meanings in its
 * ProblemDetails `detail` prose, each Categories endpoint's `409` is
 * unambiguous: a duplicate name on `POST`/`PUT`, and this one — something still
 * files under or narrows to the Category — on `DELETE`. So `CategoriesService`
 * re-files each at the seam by the endpoint alone, with no `detail` sniffing,
 * and there is deliberately **no** `CategoryModifiedError`: `PATCH /{id}/status`
 * cannot `409`, and Categories carry no optimistic-concurrency rejection
 * anywhere (ADR 0017).
 */

/**
 * `DELETE /api/categories/{id}` refused with a `409` because a Transaction, a
 * Budget, or a Schedule still points at the Category. The API returns one
 * undifferentiated string covering all three — it cannot name which — so this
 * error carries only the message, and the caller offers *Retire* as the way out
 * rather than guessing at the blocker.
 */
export class CategoryInUseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CategoryInUseError';
  }
}
