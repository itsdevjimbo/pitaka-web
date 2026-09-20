import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of, throwError } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { ContributionDeletionCoordinator } from './contribution-deletion';
import { GoalContributionsService } from './goal-contributions.service';

describe('ContributionDeletionCoordinator', () => {
  function setup(remove: GoalContributionsService['delete']) {
    TestBed.configureTestingModule({
      providers: [ContributionDeletionCoordinator, { provide: GoalContributionsService, useValue: { delete: remove } }],
    });
    return TestBed.inject(ContributionDeletionCoordinator);
  }

  it('confirms a 204 deletion', async () => {
    const coordinator = setup(() => of(undefined));

    await expect(firstValueFrom(coordinator.attempt(9))).resolves.toBe('deleted');
  });

  it('classifies a first-attempt 404 as stale displayed data', async () => {
    const coordinator = setup(() => throwError(() => new ApiError('Missing', 404)));

    await expect(firstValueFrom(coordinator.attempt(9))).resolves.toBe('stale-absence');
  });

  it('classifies 404 as confirmed recovery only after an ambiguous failure', async () => {
    let attempts = 0;
    const coordinator = setup(() => {
      attempts += 1;
      return throwError(() => (attempts === 1 ? new ApiError('Timed out', 504) : new ApiError('Missing', 404)));
    });

    await expect(firstValueFrom(coordinator.attempt(9))).rejects.toMatchObject({ status: 504 });
    await expect(firstValueFrom(coordinator.attempt(9))).resolves.toBe('recovered-absence');
  });

  it('does not treat a definitive 4xx refusal as an ambiguous deletion', async () => {
    let attempts = 0;
    const coordinator = setup(() => {
      attempts += 1;
      return throwError(() => (attempts === 1 ? new ApiError('Forbidden', 403) : new ApiError('Missing', 404)));
    });

    await expect(firstValueFrom(coordinator.attempt(9))).rejects.toMatchObject({ status: 403 });
    await expect(firstValueFrom(coordinator.attempt(9))).resolves.toBe('stale-absence');
  });
});
