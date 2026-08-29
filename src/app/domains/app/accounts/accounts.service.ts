import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, map, Observable, throwError } from 'rxjs';
import { ApiError, API_BASE_URL } from '@/app/core/api';
import { Account, AccountType, NewAccount } from './account';

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
