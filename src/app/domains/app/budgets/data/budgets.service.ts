import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, map, Observable, throwError } from 'rxjs';
import { ApiError, API_BASE_URL } from '@/app/core/api';
import { Budget, NewBudget, Period } from './budget';
import { toCalendarDate, toDateOnly } from './budget-calendar';

/**
 * Wire shape of one Budget. `GET /api/budgets` returns a collection of these and
 * `POST /api/budgets` returns one. The API also attaches `amountSpent`,
 * `cycleStart` and `cycleEnd` on the GET (ADR 0012) and a `description`;
 * nothing above the adapter reads any of them in this slice, so `toBudget`
 * drops them — the same move `toAccount` makes for an Account's owner id.
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
 * 0002). It reads the list and creates one; editing and removing are later
 * tickets. Failures arrive already normalised to `ApiError` by the interceptor.
 *
 * Deliberately **cold** — no `shareReplay`, no store — the way `AccountsService`
 * is and unlike `CategoriesService`: the endpoint gains a balance-class Spent
 * figure in the next ticket, and a balance is never served from a cache (ADR
 * 0006).
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
  list(): Observable<Budget[]> {
    return this.http
      .get<BudgetResource[]>(`${this.baseUrl}/api/budgets`)
      .pipe(map((resources) => resources.map(toBudget)));
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
 * Lift the wire row to the domain shape. The two `DateOnly` strings become
 * calendar `Date`s at local midnight (ADR 0011); `period` is lowered; the Spent
 * figure, Cycle window and `description` are dropped.
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
