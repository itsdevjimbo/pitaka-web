import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, map, Observable, throwError } from 'rxjs';
import { ApiError, API_BASE_URL } from '@/app/core/api';
import { AccountModifiedError } from '@/app/domains/app/accounts';
import { toGoalCalendarDate, toGoalDateOnly } from './goal-calendar';
import { GoalContribution, NewGoalContribution, UpdateGoalContribution } from './goal-contribution';

/** The Contribution resource sent by every Goal-Contributions endpoint. */
type GoalContributionResource = {
  id: number;
  goalId: number;
  accountId: number;
  transactionId: number | null;
  amount: number;
  contributionDate: string;
  note: string | null;
};

/** The hand-written, deliberately cold adapter over Goal Contribution resources. */
@Injectable({ providedIn: 'root' })
export class GoalContributionsService {
  private http = inject(HttpClient);
  private baseUrl = inject(API_BASE_URL);

  /** One Goal's history, read through the Goal-owned endpoint. */
  list(goalId: number): Observable<GoalContribution[]> {
    return this.http
      .get<GoalContributionResource[]>(`${this.baseUrl}/api/goals/${goalId}/contributions`)
      .pipe(map((resources) => resources.map(toGoalContribution)));
  }

  /** Every Contribution across every Goal, solely for fresh pooled headroom. */
  all(): Observable<GoalContribution[]> {
    return this.http
      .get<GoalContributionResource[]>(`${this.baseUrl}/api/goal-contributions`)
      .pipe(map((resources) => resources.map(toGoalContribution)));
  }

  /** Add an earmark. Only this write can surface the Account concurrency conflict. */
  create(contribution: NewGoalContribution): Observable<GoalContribution> {
    return this.http
      .post<GoalContributionResource>(`${this.baseUrl}/api/goal-contributions`, {
        goalId: contribution.goalId,
        accountId: contribution.accountId,
        transactionId: contribution.transactionId,
        amount: contribution.amount,
        contributionDate: toGoalDateOnly(contribution.contributionDate),
        note: contribution.note,
      })
      .pipe(
        map(toGoalContribution),
        catchError((error: unknown) => throwError(() => asAccountModified(error))),
      );
  }

  /** Correct a Contribution's note; its date and other facts stay settled. */
  update(id: number, contribution: UpdateGoalContribution): Observable<GoalContribution> {
    return this.http
      .put<GoalContributionResource>(`${this.baseUrl}/api/goal-contributions/${id}`, {
        note: contribution.note,
      })
      .pipe(map(toGoalContribution));
  }

  /** Delete one earmark; the Account money itself remains untouched. */
  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/api/goal-contributions/${id}`).pipe(map(() => undefined));
  }
}

function asAccountModified(error: unknown): unknown {
  if (error instanceof ApiError && error.status === 409 && /updated by another request/i.test(error.message)) {
    return new AccountModifiedError(error.message);
  }
  return error;
}

function toGoalContribution(resource: GoalContributionResource): GoalContribution {
  return {
    id: resource.id,
    goalId: resource.goalId,
    accountId: resource.accountId,
    transactionId: resource.transactionId,
    amount: resource.amount,
    contributionDate: toGoalCalendarDate(resource.contributionDate),
    note: resource.note,
  };
}
