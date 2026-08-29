import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import { API_BASE_URL } from '@/app/core/api';
import { toOffsetTimestamp } from './offset-timestamp';
import {
  NewTransaction,
  Transaction,
  TransactionDirection,
} from './transaction';

/**
 * Wire shape of one Transaction from the API. `GET /api/accounts/:id/
 * transactions` returns a collection of these, already scoped to the Account
 * and ordered newest first, and `POST /api/transactions` returns one. The API
 * also attaches `userId` and a raw `isRecurring` flag, which nothing above the
 * adapter reads. `accountId` and `transferToAccountId` are kept — they sign a
 * Transfer against one Account.
 */
type TransactionResource = {
  id: number;
  userId: number;
  accountId: number;
  type: 'Income' | 'Expense' | 'Transfer';
  amount: number;
  transactionDate: string;
  isRecurring: boolean;
  categoryId: number | null;
  recurringTransactionId: number | null;
  transferToAccountId: number | null;
  description: string | null;
  tags: { id: number; name: string }[];
};

/**
 * The hand-written resource service over the API's Transactions endpoints (ADR
 * 0002). It reads one Account's list and records a new Transaction; it does not
 * edit or delete. Failures arrive already normalised to `ApiError` by the
 * interceptor — a 404 on the list means the Account is not the person's, or is
 * gone.
 */
@Injectable({ providedIn: 'root' })
export class TransactionsService {
  // Dependencies
  private http = inject(HttpClient);
  private baseUrl = inject(API_BASE_URL);

  /**
   * Every Transaction recorded against one Account, newest first (the API's
   * order, preserved). A cold `Observable` with no caching: the list sits
   * beneath a balance that is itself re-read on every entry (ADR 0006), so it
   * is re-read too.
   */
  list(accountId: number): Observable<Transaction[]> {
    return this.http
      .get<TransactionResource[]>(
        `${this.baseUrl}/api/accounts/${accountId}/transactions`
      )
      .pipe(map((resources) => resources.map(toTransaction)));
  }

  /**
   * Record one Transaction. The write endpoint is `POST /api/transactions`, not
   * Account-scoped even though the list is — the Account rides in the body, a
   * mismatch ADR 0009 records deliberately. The direction decides the last two
   * fields and the adapter holds the line so a caller cannot cross them: a
   * Transfer sends `categoryId: null` — no Category classifies one (ADR 0010) —
   * and its destination Account; an income or an expense sends its Category and
   * `transferToAccountId: null`. The moment is stamped with its UTC offset
   * because the API rejects a naive `transactionDate` outright.
   *
   * Failures arrive already normalised: a rejection with no body becomes a
   * form-level `ApiError` with an empty field map — a banner line, nothing to
   * pin to a control.
   */
  record(transaction: NewTransaction): Observable<Transaction> {
    const isTransfer = transaction.direction === 'transfer';

    return this.http
      .post<TransactionResource>(`${this.baseUrl}/api/transactions`, {
        accountId: transaction.accountId,
        type: API_TYPE[transaction.direction],
        amount: transaction.amount,
        categoryId: isTransfer ? null : transaction.categoryId,
        transactionDate: toOffsetTimestamp(transaction.date),
        transferToAccountId: isTransfer
          ? transaction.transferToAccountId
          : null,
      })
      .pipe(map(toTransaction));
  }
}

/** The API's `TransactionType` enum, lowered to a {@link TransactionDirection}. */
const DIRECTION: Record<TransactionResource['type'], TransactionDirection> = {
  Income: 'income',
  Expense: 'expense',
  Transfer: 'transfer',
};

/** A {@link TransactionDirection} raised back to the API's `TransactionType`. */
const API_TYPE: Record<TransactionDirection, TransactionResource['type']> = {
  income: 'Income',
  expense: 'Expense',
  transfer: 'Transfer',
};

/** Lift the wire row to the domain shape the list renders. */
function toTransaction(resource: TransactionResource): Transaction {
  return {
    id: resource.id,
    amount: resource.amount,
    direction: DIRECTION[resource.type],
    accountId: resource.accountId,
    transferToAccountId: resource.transferToAccountId,
    // No zone is appended and none is stripped: a real instant arrives with a
    // designator and converts to local, a person-entered wall-clock arrives
    // without one and is read as local (ADR 0007).
    date: new Date(resource.transactionDate),
    categoryId: resource.categoryId,
    // The foreign key to the Schedule is the truthful "the app made this" signal.
    generated: resource.recurringTransactionId !== null,
    description: resource.description,
    tags: resource.tags.map((tag) => ({ id: tag.id, name: tag.name })),
  };
}
