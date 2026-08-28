import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import { API_BASE_URL } from '@/app/core/api';
import { Account } from './account';

/**
 * Wire shape of `GET /api/accounts`. Identical to {@link Account} but for the
 * `userId` the API attaches to every row; the adapter drops it on the way up.
 */
type AccountResource = Account & { userId: number };

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
   * Every Account the signed-in person owns, balances included. Deliberately
   * returns a cold `Observable` with no caching: the balance is the server's
   * recomputed figure and every entry to the list re-reads it (issue #6).
   */
  list(): Observable<Account[]> {
    return this.http
      .get<AccountResource[]>(`${this.baseUrl}/api/accounts`)
      .pipe(map((resources) => resources.map(toAccount)));
  }
}

/** Drop `userId`; nothing above the adapter needs an Account's owner. */
function toAccount({
  id,
  name,
  type,
  currentBalance,
  isActive,
}: AccountResource): Account {
  return { id, name, type, currentBalance, isActive };
}
