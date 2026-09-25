import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { ApiError, API_BASE_URL, errorInterceptor } from '@/app/core/api';
import { AccountModifiedError } from '@/app/domains/app/accounts';
import { TEST_API_BASE_URL as BASE_URL } from '@/testing/api-base-url';
import { GoalContributionsService } from './contributions/goal-contributions.service';
import { GoalContributionUnavailableError, GoalUnavailableError } from './goal-errors';
import { GoalsService } from './goals.service';

describe('Goals data adapters', () => {
  let goals: GoalsService;
  let contributions: GoalContributionsService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: BASE_URL },
      ],
    });
    goals = TestBed.inject(GoalsService);
    contributions = TestBed.inject(GoalContributionsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('keeps Goal reads cold and maps DateOnly fields as calendar days', async () => {
    const first = firstValueFrom(goals.list());
    http.expectOne(`${BASE_URL}/api/goals`).flush([goalResource(1)]);

    const second = firstValueFrom(goals.list());
    http.expectOne(`${BASE_URL}/api/goals`).flush([goalResource(1)]);

    await expect(first).resolves.toEqual([goal(1)]);
    await expect(second).resolves.toEqual([goal(1)]);
  });

  it('GETs one Goal by id', async () => {
    const result = firstValueFrom(goals.get(8));
    const request = http.expectOne(`${BASE_URL}/api/goals/8`);
    expect(request.request.method).toBe('GET');
    request.flush(goalResource(8));

    await expect(result).resolves.toEqual(goal(8));
  });

  it.each([403, 404])('maps ID-addressed Goal responses with status %s to one unavailable error', async (status) => {
    const unavailableBody = { title: 'Unavailable', detail: 'Private server wording.' };
    const unavailable = { status, statusText: status === 403 ? 'Forbidden' : 'Not Found' };

    const read = firstValueFrom(goals.get(8));
    http.expectOne(`${BASE_URL}/api/goals/8`).flush(unavailableBody, unavailable);
    await expect(read).rejects.toBeInstanceOf(GoalUnavailableError);

    const updated = firstValueFrom(goals.update(8, { name: 'Holiday', targetAmount: 5000, targetDate: null }));
    http.expectOne(`${BASE_URL}/api/goals/8`).flush(unavailableBody, unavailable);
    await expect(updated).rejects.toBeInstanceOf(GoalUnavailableError);

    const statusChange = firstValueFrom(goals.setStatus(8, 'Completed'));
    http.expectOne(`${BASE_URL}/api/goals/8/status`).flush(unavailableBody, unavailable);
    await expect(statusChange).rejects.toBeInstanceOf(GoalUnavailableError);

    const deleted = firstValueFrom(goals.delete(8));
    http.expectOne(`${BASE_URL}/api/goals/8`).flush(unavailableBody, unavailable);
    await expect(deleted).rejects.toBeInstanceOf(GoalUnavailableError);
  });

  it('normalizes either duplicate Goal-name response into a name field error', async () => {
    const result = firstValueFrom(
      goals.create({
        name: 'Holiday',
        targetAmount: 5000,
        targetDate: new Date(2026, 11, 25),
      }),
    );
    const request = http.expectOne(`${BASE_URL}/api/goals`);
    expect(request.request.body).toEqual({
      name: 'Holiday',
      targetAmount: 5000,
      targetDate: '2026-12-25',
    });
    request.flush(
      { title: 'Conflict', status: 409, detail: 'An goal with this name already exists.' },
      { status: 409, statusText: 'Conflict' },
    );

    const error = await result.catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).fieldErrors).toEqual({
      name: ['A Goal with this name already exists.'],
    });
  });

  it('uses the Goal-owned history endpoint and keeps it cold', async () => {
    const first = firstValueFrom(contributions.list(8));
    http.expectOne(`${BASE_URL}/api/goals/8/contributions`).flush([contributionResource(3)]);

    const second = firstValueFrom(contributions.list(8));
    http.expectOne(`${BASE_URL}/api/goals/8/contributions`).flush([contributionResource(3)]);

    await expect(first).resolves.toEqual([contribution(3)]);
    await expect(second).resolves.toEqual([contribution(3)]);
  });

  it.each([403, 404])('maps Goal-owned Contribution reads and ID-addressed writes with status %s', async (status) => {
    const unavailableBody = { title: 'Unavailable', detail: 'Private server wording.' };
    const unavailable = { status, statusText: status === 403 ? 'Forbidden' : 'Not Found' };

    const history = firstValueFrom(contributions.list(8));
    http.expectOne(`${BASE_URL}/api/goals/8/contributions`).flush(unavailableBody, unavailable);
    await expect(history).rejects.toBeInstanceOf(GoalUnavailableError);

    const updated = firstValueFrom(contributions.update(3, { note: 'Changed' }));
    http.expectOne(`${BASE_URL}/api/goal-contributions/3`).flush(unavailableBody, unavailable);
    await expect(updated).rejects.toBeInstanceOf(GoalContributionUnavailableError);

    const deleted = firstValueFrom(contributions.delete(3));
    http.expectOne(`${BASE_URL}/api/goal-contributions/3`).flush(unavailableBody, unavailable);
    await expect(deleted).rejects.toBeInstanceOf(GoalContributionUnavailableError);
  });

  it('leaves a create-time missing body reference as the normalized API error', async () => {
    const created = firstValueFrom(
      contributions.create({
        goalId: 8,
        accountId: 2,
        transactionId: null,
        amount: 12.5,
        contributionDate: new Date(2026, 8, 13),
        note: null,
      }),
    );
    http
      .expectOne(`${BASE_URL}/api/goal-contributions`)
      .flush(
        { title: 'Not Found', detail: 'The referenced record does not exist.' },
        { status: 404, statusText: 'Not Found' },
      );

    const error = await created.catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).not.toBeInstanceOf(GoalContributionUnavailableError);
    expect(error).not.toBeInstanceOf(GoalUnavailableError);
    expect((error as ApiError).status).toBe(404);
  });

  it('GETs pooled Contributions and maps the create-only Account conflict', async () => {
    const all = firstValueFrom(contributions.all());
    const allRequest = http.expectOne(`${BASE_URL}/api/goal-contributions`);
    expect(allRequest.request.method).toBe('GET');
    allRequest.flush([contributionResource(3)]);
    await expect(all).resolves.toEqual([contribution(3)]);

    const created = firstValueFrom(
      contributions.create({
        goalId: 8,
        accountId: 2,
        transactionId: null,
        amount: 12.5,
        contributionDate: new Date(2026, 8, 13),
        note: null,
      }),
    );
    const createRequest = http.expectOne(`${BASE_URL}/api/goal-contributions`);
    expect(createRequest.request.body).toEqual({
      goalId: 8,
      accountId: 2,
      transactionId: null,
      amount: 12.5,
      contributionDate: '2026-09-13',
      note: null,
    });
    createRequest.flush(
      {
        title: 'Conflict',
        status: 409,
        detail: 'The record was updated by another request. Please try again.',
      },
      { status: 409, statusText: 'Conflict' },
    );

    await expect(created).rejects.toBeInstanceOf(AccountModifiedError);
  });

  it('updates only a Contribution note while its date stays settled', async () => {
    const updated = firstValueFrom(contributions.update(3, { note: 'Revised note' }));
    const request = http.expectOne(`${BASE_URL}/api/goal-contributions/3`);

    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({ note: 'Revised note' });
    request.flush({ ...contributionResource(3), note: 'Revised note' });

    await expect(updated).resolves.toEqual({
      ...contribution(3),
      note: 'Revised note',
    });
  });
});

function goalResource(id: number) {
  return {
    id,
    name: 'Holiday',
    targetAmount: 5000,
    targetDate: '2026-12-25',
    status: 'Active' as const,
    currentAmount: 1250.5,
  };
}

function goal(id: number) {
  return {
    ...goalResource(id),
    targetDate: new Date(2026, 11, 25),
  };
}

function contributionResource(id: number) {
  return {
    id,
    goalId: 8,
    accountId: 2,
    transactionId: null,
    amount: 12.5,
    contributionDate: '2026-09-13',
    note: 'First amount',
  };
}

function contribution(id: number) {
  return {
    ...contributionResource(id),
    contributionDate: new Date(2026, 8, 13),
  };
}
