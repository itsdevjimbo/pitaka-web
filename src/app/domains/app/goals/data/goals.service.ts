import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, map, Observable, throwError } from 'rxjs';
import { ApiError, API_BASE_URL } from '@/app/core/api';
import { Goal, GoalStatus, NewGoal, UpdateGoal } from './goal';
import { toGoalCalendarDate, toGoalDateOnly } from './goal-calendar';
import { GoalUnavailableError, mapUnavailableResourceError } from './goal-errors';

/** The Goal resource sent by every Goals endpoint. */
type GoalResource = {
  id: number;
  name: string;
  targetAmount: number;
  targetDate: string | null;
  status: GoalStatus;
  currentAmount: number;
};

/** The hand-written, deliberately cold adapter over `/api/goals` (ADR 0002). */
@Injectable({ providedIn: 'root' })
export class GoalsService {
  private http = inject(HttpClient);
  private baseUrl = inject(API_BASE_URL);

  /** Every Goal, freshly read because each row carries its current money figure. */
  list(): Observable<Goal[]> {
    return this.http.get<GoalResource[]>(`${this.baseUrl}/api/goals`).pipe(map((resources) => resources.map(toGoal)));
  }

  /** One Goal and its server-computed current amount. */
  get(id: number): Observable<Goal> {
    return this.http.get<GoalResource>(`${this.baseUrl}/api/goals/${id}`).pipe(
      map(toGoal),
      catchError((error: unknown) =>
        throwError(() => mapUnavailableResourceError(error, (apiError) => new GoalUnavailableError(apiError))),
      ),
    );
  }

  /** Create a Goal; a duplicate name becomes a field-bound API error. */
  create(goal: NewGoal): Observable<Goal> {
    return this.http.post<GoalResource>(`${this.baseUrl}/api/goals`, toGoalRequest(goal)).pipe(
      map(toGoal),
      catchError((error: unknown) => throwError(() => asNameConflict(error))),
    );
  }

  /** Replace a Goal's editable fields; duplicate-name failures bind to `name`. */
  update(id: number, goal: UpdateGoal): Observable<Goal> {
    return this.http.put<GoalResource>(`${this.baseUrl}/api/goals/${id}`, toGoalRequest(goal)).pipe(
      map(toGoal),
      catchError((error: unknown) =>
        throwError(() =>
          mapUnavailableResourceError(asNameConflict(error), (apiError) => new GoalUnavailableError(apiError)),
        ),
      ),
    );
  }

  /** Set the explicit Goal lifecycle state. */
  setStatus(id: number, status: GoalStatus): Observable<Goal> {
    return this.http.patch<GoalResource>(`${this.baseUrl}/api/goals/${id}/status`, { status }).pipe(
      map(toGoal),
      catchError((error: unknown) =>
        throwError(() => mapUnavailableResourceError(error, (apiError) => new GoalUnavailableError(apiError))),
      ),
    );
  }

  /** Delete a Goal and its Contributions; callers reconcile with fresh reads. */
  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/api/goals/${id}`).pipe(
      map(() => undefined),
      catchError((error: unknown) =>
        throwError(() => mapUnavailableResourceError(error, (apiError) => new GoalUnavailableError(apiError))),
      ),
    );
  }
}

function toGoalRequest(goal: NewGoal): {
  name: string;
  targetAmount: number;
  targetDate: string | null;
} {
  return {
    name: goal.name,
    targetAmount: goal.targetAmount,
    targetDate: goal.targetDate === null ? null : toGoalDateOnly(goal.targetDate),
  };
}

function asNameConflict(error: unknown): unknown {
  if (error instanceof ApiError && error.status === 409) {
    return new ApiError('A Goal with this name already exists.', error.status, {
      name: ['A Goal with this name already exists.'],
    });
  }
  return error;
}

function toGoal(resource: GoalResource): Goal {
  return {
    id: resource.id,
    name: resource.name,
    targetAmount: resource.targetAmount,
    targetDate: resource.targetDate === null ? null : toGoalCalendarDate(resource.targetDate),
    status: resource.status,
    currentAmount: resource.currentAmount,
  };
}
