import { inject, Injectable } from '@angular/core';
import { catchError, map, Observable, of, throwError } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { GoalContributionsService } from './goal-contributions.service';

export type ContributionDeletionResult = 'deleted' | 'stale-absence' | 'recovered-absence';

/** Tracks whether a 404 followed an uncertain delete outcome for each row. */
@Injectable()
export class ContributionDeletionCoordinator {
  private readonly contributions = inject(GoalContributionsService);
  private readonly uncertain = new Set<number>();

  attempt(id: number): Observable<ContributionDeletionResult> {
    return this.contributions.delete(id).pipe(
      map(() => {
        this.uncertain.delete(id);
        return 'deleted' as const;
      }),
      catchError((error: unknown) => {
        if (error instanceof ApiError && error.status === 404) {
          const result = this.uncertain.has(id) ? 'recovered-absence' : 'stale-absence';
          this.uncertain.delete(id);
          return of(result as ContributionDeletionResult);
        }
        if (isAmbiguous(error)) {
          this.uncertain.add(id);
        }
        return throwError(() => error);
      }),
    );
  }
}

function isAmbiguous(error: unknown): boolean {
  return !(error instanceof ApiError) || error.status === 0 || error.status === 408 || error.status >= 500;
}
