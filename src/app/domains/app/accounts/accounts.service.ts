import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, map, Observable, throwError } from 'rxjs';
import { ApiError, API_BASE_URL } from '@/app/core/api';
import { Account, AccountType, NewAccount } from './account';
import {
  AccountDeleteBlockedError,
  AccountModifiedError,
} from './account-errors';

/**
 * The `409 Conflict` bodies these endpoints send carry their meaning only in the
 * ProblemDetails `detail` prose, and a delete can 409 for three unrelated
 * reasons. The adapter has already surfaced `detail` as `ApiError.message` (ADR
 * 0002); these patterns read it once, here at the seam, so nothing above matches
 * on server text. Each mirrors a literal `Problem(detail: …)` string in the
 * API's `AccountsController`, and is deliberately specific enough that a
 * reworded, unrelated 409 elsewhere does not collide with it.
 *
 * Note: the API's Accounts endpoints do not yet emit the concurrency 409 — its
 * `AccountsController` still lacks the `DbUpdateConcurrencyException` catch that
 * `TransactionsController` and `GoalContributionsController` already have. The
 * client codes to the shape those siblings established; wiring it end to end is
 * an API-side follow-up (itsdevjimbo/pitaka#54).
 */
const CONFLICT_DETAIL = {
  /** "This account was updated by another request. Please try again." */
  modified: /updated by another request/i,
  /** "This account has transaction history and cannot be deleted." */
  hasHistory: /transaction history/i,
  /** "This account contains funds allocated toward a specific goal." */
  hasGoalAllocation: /allocated toward .*goal/i,
} as const;

/**
 * Wire shape of one Account from the API. `GET /api/accounts` returns a
 * collection of these and `POST /api/accounts` returns one. The API attaches
 * `userId` and `initialBalance`; nothing above the adapter needs either — the
 * balance the UI shows is always the recomputed `currentBalance` (ADR 0006).
 */
type AccountResource = {
  id: number;
  userId: number;
  name: string;
  type: AccountType;
  initialBalance: number;
  currentBalance: number;
  isActive: boolean;
};

/**
 * The hand-written resource service over the API's Accounts endpoints (ADR
 * 0002). Callers see {@link Account}; failures arrive already normalised to
 * `ApiError` by the interceptor.
 */
@Injectable({ providedIn: 'root' })
export class AccountsService {
  // Dependencies
  private http = inject(HttpClient);
  private baseUrl = inject(API_BASE_URL);

  /**
   * Every Account the signed-in person owns, balances included. Deliberately a
   * cold `Observable` with no caching: the balance is the server's recomputed
   * figure and every entry to the list re-reads it (ADR 0006).
   */
  list(): Observable<Account[]> {
    return this.http
      .get<AccountResource[]>(`${this.baseUrl}/api/accounts`)
      .pipe(map((resources) => resources.map(toAccount)));
  }

  /**
   * Open a new Account. On success the created row comes back with the server's
   * freshly computed balance.
   *
   * The API refuses a second Account with a name the Profile already uses with a
   * bare 409 + ProblemDetails `detail` and no field map. That this endpoint's
   * 409 always means "the name is taken" is a fact about this resource, not a
   * transport shape the normalizer should know (ADR 0002), so it is re-attached
   * here as a `name` field error — the caller then treats it like any other
   * server-blamed field and surfaces it under the name control.
   */
  create(account: NewAccount): Observable<Account> {
    return this.http
      .post<AccountResource>(`${this.baseUrl}/api/accounts`, {
        name: account.name,
        type: account.type,
        initialBalance: account.initialBalance,
      })
      .pipe(
        map(toAccount),
        catchError((error: unknown) => throwError(() => asNameConflict(error)))
      );
  }

  /**
   * Rename an Account. On success the whole row comes back, its balance the
   * server's own recomputed figure (ADR 0006).
   *
   * A 409 on this endpoint means one of two things and the person is pointed
   * differently for each: the new name is already taken — re-filed as a `name`
   * field error so it surfaces under the control, as {@link create} does — or
   * the Account moved underneath the write, which becomes an
   * {@link AccountModifiedError} the caller offers a retry for.
   */
  rename(id: number, name: string): Observable<Account> {
    return this.http
      .put<AccountResource>(`${this.baseUrl}/api/accounts/${id}`, { name })
      .pipe(
        map(toAccount),
        catchError((error: unknown) => {
          if (isConflict(error, CONFLICT_DETAIL.modified)) {
            return throwError(() => new AccountModifiedError(error.message));
          }
          return throwError(() => asNameConflict(error));
        })
      );
  }

  /**
   * Retire an Account (`isActive: false`) or bring it back (`isActive: true`).
   * Retiring never erases the Account or its history. A 409 here can only be the
   * optimistic-concurrency rejection, surfaced as an {@link AccountModifiedError}.
   */
  setActive(id: number, isActive: boolean): Observable<Account> {
    return this.http
      .patch<AccountResource>(`${this.baseUrl}/api/accounts/${id}/status`, {
        isActive,
      })
      .pipe(
        map(toAccount),
        catchError((error: unknown) => throwError(() => asModified(error)))
      );
  }

  /**
   * Delete an Account. The API guards this twice and the two refusals mean
   * different things: the Account has Transaction history, or it holds money
   * allocated toward a Goal. Each becomes an {@link AccountDeleteBlockedError}
   * with its own `reason` so the caller can word them apart — collapsing them
   * into one message strands the person. A concurrency 409 stays an
   * {@link AccountModifiedError}.
   */
  remove(id: number): Observable<void> {
    return this.http
      .delete<void>(`${this.baseUrl}/api/accounts/${id}`)
      .pipe(
        map(() => undefined),
        catchError((error: unknown) => throwError(() => asDeleteFailure(error)))
      );
  }
}

/** Narrow to an `ApiError` that is a 409 whose `detail` matches `pattern`. */
function isConflict(error: unknown, pattern: RegExp): error is ApiError {
  return (
    error instanceof ApiError && error.status === 409 && pattern.test(error.message)
  );
}

/** Re-file a duplicate-name 409 as a `name` field error; pass anything else on. */
function asNameConflict(error: unknown): unknown {
  if (error instanceof ApiError && error.status === 409) {
    return new ApiError(error.message, error.status, {
      name: [error.message],
    });
  }
  return error;
}

/** A concurrency 409 becomes an `AccountModifiedError`; anything else passes on. */
function asModified(error: unknown): unknown {
  if (isConflict(error, CONFLICT_DETAIL.modified)) {
    return new AccountModifiedError(error.message);
  }
  return error;
}

/** Sort a failed delete into its concurrency, history, or Goal-allocation case. */
function asDeleteFailure(error: unknown): unknown {
  if (isConflict(error, CONFLICT_DETAIL.modified)) {
    return new AccountModifiedError(error.message);
  }
  if (isConflict(error, CONFLICT_DETAIL.hasHistory)) {
    return new AccountDeleteBlockedError('transaction-history', error.message);
  }
  if (isConflict(error, CONFLICT_DETAIL.hasGoalAllocation)) {
    return new AccountDeleteBlockedError('goal-allocation', error.message);
  }
  return error;
}

/** Drop the fields nothing above the adapter uses (`userId`, `initialBalance`). */
function toAccount(resource: AccountResource): Account {
  return {
    id: resource.id,
    name: resource.name,
    type: resource.type,
    currentBalance: resource.currentBalance,
    isActive: resource.isActive,
  };
}
