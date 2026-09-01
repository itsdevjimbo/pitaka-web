import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import { API_BASE_URL } from '@/app/core/api';
import { toOffsetTimestamp } from './offset-timestamp';
import { parseTransactionDate } from './parse-transaction-date';
import {
  NewTransaction,
  RefileTransaction,
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
 * 0002). It reads one Account's list, records a new Transaction, refiles an
 * existing one, and removes one. Failures arrive already normalised to
 * `ApiError` by the interceptor — a 404 on the list means the Account is not the
 * person's, or is gone.
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

  /**
   * Refile an existing Transaction: `PUT /api/transactions/:id`, not
   * Account-scoped (ADR 0009). Only how a Transaction is filed can be corrected
   * — its date, Category, note and Tags — never its amount or direction, which
   * were settled at recording (see `CONTEXT.md`).
   *
   * The body is a **full replacement of the mutable set, never a patch**. The
   * API writes `categoryId` and `description` unconditionally from what it
   * receives, so every key goes every time — a missing one would null the field
   * it names. `tagIds` is always an array for the same reason: absent, it would
   * leave Tags untouched rather than replace them, which is not a replacement.
   * A caller correcting one field passes the Transaction's untouched values for
   * the rest, so nothing it did not mean to change is lost.
   *
   * A Transfer carries no Category on any write path (ADR 0010); the adapter
   * forces `categoryId: null` so a caller cannot cross that line. The date is
   * offset-stamped because the API rejects a naive `transactionDate` outright.
   *
   * Failures arrive already normalised — a bodyless rejection becomes a
   * form-level `ApiError` with an empty field map.
   */
  refile(
    transaction: Transaction,
    correction: RefileTransaction
  ): Observable<Transaction> {
    const isTransfer = transaction.direction === 'transfer';

    return this.http
      .put<TransactionResource>(
        `${this.baseUrl}/api/transactions/${transaction.id}`,
        {
          transactionDate: toOffsetTimestamp(correction.date),
          categoryId: isTransfer ? null : correction.categoryId,
          description: correction.description,
          tagIds: [...correction.tagIds],
        }
      )
      .pipe(map(toTransaction));
  }

  /**
   * Remove one Transaction: `DELETE /api/transactions/:id`, not Account-scoped
   * (ADR 0009). This is the one correction that legitimately moves a balance —
   * refiling never touches an amount, so a wrong amount is fixed by removing
   * and recording again (see `CONTEXT.md`). The API moves the balance back by
   * exactly what the Transaction moved; the caller re-reads that figure from the
   * server afterwards rather than doing the arithmetic (ADR 0006).
   *
   * A Transfer is one Transaction (ADR 0010): removing it unwinds both Accounts
   * at once, and it is removed only from the Account it was recorded against —
   * the sole place the UI offers this. A generated transaction removes like any
   * other and stays removed: the Schedule's next-run date has already advanced,
   * so nothing regenerates it.
   *
   * Landmine for the goals slice, invisible today: the API also deletes any Goal
   * contribution attached to this Transaction, silently. Goals are not built
   * yet, so nothing surfaces here and there is nothing to do — but a
   * contribution is destroyed, and the goals slice will have to reckon with a
   * removal reaching into its data when it lands.
   *
   * Failures arrive already normalised: a 404 or 403 means the Transaction is
   * gone or was never the person's, collapsed to one not-found line; anything
   * else is a form-level `ApiError` the caller shows and leaves the row put.
   */
  remove(id: number): Observable<void> {
    return this.http
      .delete<void>(`${this.baseUrl}/api/transactions/${id}`)
      .pipe(map(() => undefined));
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
  // The foreign key to the Schedule is the truthful "the app made this" signal,
  // and it also decides how the date is read below.
  const generated = resource.recurringTransactionId !== null;

  return {
    id: resource.id,
    amount: resource.amount,
    direction: DIRECTION[resource.type],
    accountId: resource.accountId,
    transferToAccountId: resource.transferToAccountId,
    // A person-recorded instant is stored UTC but comes back off MySQL with no
    // `Z`; a generated transaction is a bare wall-clock day. `generated` tells
    // the two naive strings apart so each reads to the right instant (ADR 0007).
    date: parseTransactionDate(resource.transactionDate, generated),
    categoryId: resource.categoryId,
    generated,
    description: resource.description,
    tags: resource.tags.map((tag) => ({ id: tag.id, name: tag.name })),
  };
}
