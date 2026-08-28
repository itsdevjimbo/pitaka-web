import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import { API_BASE_URL } from '@/app/core/api';
import { Account, AccountType } from './account';

/** Wire shape of one row from `GET /api/accounts` — the API attaches `userId`. */
type AccountResource = {
  id: number;
  userId: number;
  name: string;
  type: AccountType;
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
      .pipe(
        map((resources) =>
          resources.map((resource) => ({
            id: resource.id,
            name: resource.name,
            type: resource.type,
            currentBalance: resource.currentBalance,
            isActive: resource.isActive,
          }))
        )
      );
  }
}
