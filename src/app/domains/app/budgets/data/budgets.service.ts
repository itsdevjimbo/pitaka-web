import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, map, Observable, throwError } from 'rxjs';
import { ApiError, API_BASE_URL } from '@/app/core/api';
import {
  AdjustBudget,
  Budget,
  BudgetWithSpend,
  NewBudget,
  Period,
} from './budget';
import { toCalendarDate, toDateOnly } from './budget-calendar';

/**
 * Wire shape of one Budget as the write endpoints send it. `POST /api/budgets`
 * returns one of these. The API also attaches a `description` nothing above the
 * adapter reads, so `toBudget` drops it — the same move `toAccount` makes for an
 * Account's owner id.
 */
type BudgetResource = {
  id: number;
  name: string;
  amountLimit: number;
  period: 'Daily' | 'Weekly' | 'Monthly' | 'Quarterly' | 'Yearly';
  startDate: string;
  endDate: string | null;
  categoryId: number | null;
  description: string | null;
};

/**
 * What `GET /api/budgets` adds to each row: the Spent figure and the Cycle
 * window the server summed over (ADR 0012). Only the list carries these — a
 * created Budget comes back as a bare {@link BudgetResource} — so the two
 * shapes, and the two mappers, stay apart.
 */
type BudgetWithSpendResource = BudgetResource & {
  amountSpent: number;
  cycleStart: string;
  cycleEnd: string;
};

/** The API's `BudgetPeriod` enum, lowered to a {@link Period}. */
const PERIOD: Record<BudgetResource['period'], Period> = {
  Daily: 'daily',
  Weekly: 'weekly',
  Monthly: 'monthly',
  Quarterly: 'quarterly',
  Yearly: 'yearly',
};

/** A {@link Period} raised back to the API's `BudgetPeriod`. */
const API_PERIOD: Record<Period, BudgetResource['period']> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
};

/**
 * The hand-written resource service over the API's Budgets endpoints (ADR
 * 0002). It reads the list, creates one, adjusts one, and removes one.
 * Failures arrive already normalised to `ApiError` by the interceptor.
 *
 * Deliberately **cold** — no `shareReplay`, no store — the way `AccountsService`
 * is and unlike `CategoriesService`: the list carries a balance-class Spent
 * figure (ADR 0012) and a balance is never served from a cache (ADR 0006).
 */
@Injectable({ providedIn: 'root' })
export class BudgetsService {
  // Dependencies
  private http = inject(HttpClient);
  private baseUrl = inject(API_BASE_URL);

  /**
   * Every Budget the signed-in person has. The API returns them in raw database
   * order — there is no `OrderBy` — so the list screen groups and sorts them;
   * this method only lifts the wire rows to the domain shape.
   */
  list(): Observable<BudgetWithSpend[]> {
    return this.http
      .get<BudgetWithSpendResource[]>(`${this.baseUrl}/api/budgets`)
      .pipe(map((resources) => resources.map(toBudgetWithSpend)));
  }

  /**
   * Create a Budget from the five fields the form offers. `startDate` is sent as
   * a `"YYYY-MM-DD"` string assembled from local getters (ADR 0011), `period` is
   * raised to the API's enum spelling, and `categoryId` is `null` for a Budget
   * over all spending. `endDate` and `description` are not offered and not sent.
   *
   * The API refuses a second Budget with a name already in use with a bare 409 +
   * ProblemDetails `detail`. Unlike the Accounts endpoints, a 409 here has
   * exactly one meaning, so it is refiled as a `name` field error at this seam —
   * `AccountsService.asNameConflict` is the move copied — and surfaces under the
   * control like any other server-blamed field. A category that fails the API's
   * existence check comes back as a bodyless 400, which stays a form-level line.
   */
  create(budget: NewBudget): Observable<Budget> {
    return this.http
      .post<BudgetResource>(`${this.baseUrl}/api/budgets`, {
        name: budget.name,
        amountLimit: budget.amountLimit,
        period: API_PERIOD[budget.period],
        startDate: toDateOnly(budget.startDate),
        categoryId: budget.categoryId,
      })
      .pipe(
        map(toBudget),
        catchError((error: unknown) => throwError(() => asNameConflict(error)))
      );
  }

  /**
   * Adjust a Budget. `PUT /api/budgets/{id}` takes the same `BudgetRequest` as
   * {@link create} and is a **full replacement, not a patch** — every field is
   * written from what it receives — so the whole mutable set goes on the wire
   * every time, `endDate` included, carried through from what the caller was
   * handed. Omitting a key would null the field it names.
   *
   * Changing `period` or `startDate` moves the Cycle, so the Spent figure the
   * next list read returns is against a different window — correct, and the
   * re-read after this write (ADR 0006) is what surfaces it.
   *
   * The name is still unique. `PUT` answers a taken name with the same bare 409
   * + ProblemDetails `detail` as `POST`, and it means exactly one thing here
   * too, so it is refiled as a `name` field error at this seam — the same
   * {@link asNameConflict} move. `Budget` carries no `Version` (unlike an
   * Account), so there is no concurrency 409 to model: editing is
   * last-write-wins.
   */
  adjust(id: number, budget: AdjustBudget): Observable<Budget> {
    return this.http
      .put<BudgetResource>(`${this.baseUrl}/api/budgets/${id}`, {
        name: budget.name,
        amountLimit: budget.amountLimit,
        period: API_PERIOD[budget.period],
        startDate: toDateOnly(budget.startDate),
        endDate: budget.endDate === null ? null : toDateOnly(budget.endDate),
        categoryId: budget.categoryId,
      })
      .pipe(
        map(toBudget),
        catchError((error: unknown) => throwError(() => asNameConflict(error)))
      );
  }

  /**
   * Remove a Budget. `DELETE /api/budgets/{id}` → `204`. This is **not** the
   * Accounts shape: an Account retires without being erased, a Budget is
   * hard-deleted with nothing to restore it. The API refuses this for no reason
   * — there is no history or allocation guard as there is on an Account — so
   * there is no block state to word; a failure is a plain normalised `ApiError`.
   */
  remove(id: number): Observable<void> {
    return this.http
      .delete<void>(`${this.baseUrl}/api/budgets/${id}`)
      .pipe(map(() => undefined));
  }
}

/** Refile a duplicate-name 409 as a `name` field error; pass anything else on. */
function asNameConflict(error: unknown): unknown {
  if (error instanceof ApiError && error.status === 409) {
    return new ApiError(error.message, error.status, {
      name: [error.message],
    });
  }
  return error;
}

/**
 * Lift a write-endpoint row to the domain shape. The two `DateOnly` strings
 * become calendar `Date`s at local midnight (ADR 0011); `period` is lowered;
 * `description` is dropped.
 */
function toBudget(resource: BudgetResource): Budget {
  return {
    id: resource.id,
    name: resource.name,
    amountLimit: resource.amountLimit,
    period: PERIOD[resource.period],
    startDate: toCalendarDate(resource.startDate),
    endDate:
      resource.endDate === null ? null : toCalendarDate(resource.endDate),
    categoryId: resource.categoryId,
  };
}

/**
 * Lift a `GET /api/budgets` row: the {@link toBudget} shape plus the Spent
 * figure and the Cycle window, the window's two `DateOnly` strings parsed as
 * calendar days the same way the Budget's own dates are (ADR 0011).
 */
function toBudgetWithSpend(resource: BudgetWithSpendResource): BudgetWithSpend {
  return {
    ...toBudget(resource),
    amountSpent: resource.amountSpent,
    cycleStart: toCalendarDate(resource.cycleStart),
    cycleEnd: toCalendarDate(resource.cycleEnd),
  };
}
