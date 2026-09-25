import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of, throwError } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { GoalContributionUnavailableError } from '../goal-errors';
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

  it.each([403, 404])('classifies a first-attempt %s as stale displayed data', async (status) => {
    const coordinator = setup(() =>
      throwError(() => new GoalContributionUnavailableError(new ApiError('Unavailable', status))),
    );

    await expect(firstValueFrom(coordinator.attempt(9))).resolves.toBe('stale-absence');
  });

  it.each([403, 404])('classifies a %s as confirmed recovery only after an ambiguous failure', async (status) => {
    let attempts = 0;
    const coordinator = setup(() => {
      attempts += 1;
      return throwError(() =>
        attempts === 1
          ? new ApiError('Timed out', 504)
          : new GoalContributionUnavailableError(new ApiError('Unavailable', status)),
      );
    });

    await expect(firstValueFrom(coordinator.attempt(9))).rejects.toMatchObject({ status: 504 });
    await expect(firstValueFrom(coordinator.attempt(9))).resolves.toBe('recovered-absence');
  });

  it('keeps an owned-resource 409 refusal visible and does not treat it as an ambiguous deletion', async () => {
    const coordinator = setup(() => throwError(() => new ApiError('The Contribution changed.', 409)));

    await expect(firstValueFrom(coordinator.attempt(9))).rejects.toMatchObject({ status: 409 });
  });
});
