import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { ApiError, API_BASE_URL, errorInterceptor } from '@/app/core/api';
import { AccountModifiedError } from '@/app/domains/app/accounts';
import { TEST_API_BASE_URL as BASE_URL } from '@/testing/api-base-url';
import { GoalContributionsService } from './goal-contributions.service';
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
