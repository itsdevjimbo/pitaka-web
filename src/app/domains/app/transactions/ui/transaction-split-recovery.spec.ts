import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { GoalContributionsService } from '@/app/domains/app/goals';
import { TransactionsService } from '../data/transactions.service';
import { TransactionSplitContextStore } from './transaction-split-context';
import { TRANSACTION_SPLIT_IDEMPOTENCY_KEY, TransactionSplitRecoveryStore } from './transaction-split-recovery';

describe('TransactionSplitRecoveryStore', () => {
  const firstKey = '74287c99-1f5c-49b7-9d24-81e884c634a0';
  const secondKey = '2c159351-a5b0-4930-9f19-f1446a8d9231';
  let split: ReturnType<typeof vi.fn>;
  let refresh: ReturnType<typeof vi.fn>;
  let refreshGoalHistory: ReturnType<typeof vi.fn>;
  let authoritativeState: WritableSignal<{
    linkedTotal: number;
    remainingCapacity: number;
    availableHeadroom: number;
  }>;
  let store: TransactionSplitRecoveryStore;

  beforeEach(() => {
    split = vi.fn();
    refresh = vi.fn().mockResolvedValue(true);
    refreshGoalHistory = vi.fn().mockReturnValue(of([]));
    authoritativeState = signal({ linkedTotal: 135.5, remainingCapacity: 364.5, availableHeadroom: 864.5 });
    const keys = [firstKey, secondKey];
    TestBed.configureTestingModule({
      providers: [
        TransactionSplitRecoveryStore,
        { provide: TransactionsService, useValue: { splitLinkedContributions: split } },
        { provide: TransactionSplitContextStore, useValue: { refresh, state: authoritativeState.asReadonly() } },
        { provide: GoalContributionsService, useValue: { list: refreshGoalHistory } },
        { provide: TRANSACTION_SPLIT_IDEMPOTENCY_KEY, useValue: () => keys.shift()! },
      ],
    });
    store = TestBed.inject(TransactionSplitRecoveryStore);
  });

  it('shows every row and shared failure from a definitive atomic refusal, then refreshes facts', async () => {
    const failures = [
      { reason: 'goal_inactive', rowIndex: 0, goalId: 12, goalName: 'Holiday', currentState: 'Completed' },
      { reason: 'target_overrun_acknowledgement_required', rowIndex: 1, goalId: 9, currentProgress: 90, target: 100 },
      { reason: 'account_headroom_exceeded', accountId: 7, availableHeadroom: 25 },
    ];
    split.mockReturnValue(
      throwError(() =>
        apiError(409, {
          reason: 'split_rejected',
          created: false,
          failures,
        }),
      ),
    );

    await store.submit(payload());

    expect(store.state()).toEqual({
      status: 'refused',
      attempt: { key: firstKey, payload: payload() },
      failures,
      invalidRowIndexes: [0, 1],
      refresh: 'succeeded',
      message: "We couldn't save your contributions. Nothing was created.",
    });
    expect(refresh).toHaveBeenCalledOnce();
    expect(refreshGoalHistory).toHaveBeenCalledWith(12);
    expect(refreshGoalHistory).toHaveBeenCalledWith(9);
    expect(split).toHaveBeenCalledOnce();
  });

  it.each([
    'goal_inactive',
    'account_inactive',
    'transaction_ineligible',
    'transaction_missing',
    'transaction_capacity_exceeded',
    'account_headroom_exceeded',
    'concurrent_state_changed',
    'target_overrun_acknowledgement_required',
  ] as const)('recognises %s as a definitive structured refusal', async (reason) => {
    split.mockReturnValue(throwError(() => apiError(409, { reason, created: false, failures: [{ reason }] })));

    await store.submit(payload());

    expect(store.state().status).toBe('refused');
  });

  it('retains indexed validation paths without inventing financial facts', async () => {
    split.mockReturnValue(
      throwError(
        () =>
          new ApiError('Please correct the highlighted fields and try again.', 400, {
            'contributions[1].amount': ['Use a positive cent-precise amount.'],
            'contributions[0].goalId': ['This Goal is unavailable.'],
            contributionDate: ['Choose a valid date.'],
            contributions: ['Goal indexes 0 and 2 are duplicates.'],
          }),
      ),
    );

    await store.submit(payload());

    expect(store.state()).toMatchObject({
      status: 'validation-error',
      attempt: { key: firstKey, payload: payload() },
      fieldErrors: {
        'contributions[1].amount': ['Use a positive cent-precise amount.'],
        'contributions[0].goalId': ['This Goal is unavailable.'],
        contributionDate: ['Choose a valid date.'],
        contributions: ['Goal indexes 0 and 2 are duplicates.'],
      },
    });
    expect(refresh).not.toHaveBeenCalled();
    expect(refreshGoalHistory).not.toHaveBeenCalled();
  });

  it.each([
    new ApiError('Could not reach the server.', 0),
    new ApiError('Server failed.', 500),
    apiError(503, { reason: 'operation_outcome_unknown' }),
  ])('treats an unproven monetary outcome as uncertain and never retries automatically', async (error) => {
    split.mockReturnValue(throwError(() => error));

    await store.submit(payload());

    expect(store.state()).toMatchObject({
      status: 'uncertain',
      attempt: { key: firstKey, payload: payload() },
      message: "We couldn't confirm whether the contribution was created. Retry safely to check.",
    });
    expect(split).toHaveBeenCalledOnce();
    expect(refresh).not.toHaveBeenCalled();
    expect(refreshGoalHistory).not.toHaveBeenCalled();
  });

  it('replays explicitly with the same key and immutable payload, including its date across midnight', async () => {
    const original = payload();
    split
      .mockReturnValueOnce(throwError(() => apiError(503, { reason: 'operation_outcome_unknown' })))
      .mockReturnValueOnce(of(success()));

    await store.submit(original);
    original.contributionDate = '2026-09-21';
    original.contributions.reverse();
    await store.retryUncertain();

    expect(split).toHaveBeenNthCalledWith(1, payload(), firstKey);
    expect(split).toHaveBeenNthCalledWith(2, payload(), firstKey);
    expect(store.state()).toMatchObject({ status: 'confirmed', refresh: 'succeeded' });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('blocks changed input and a new key until an uncertain original operation is resolved', async () => {
    split.mockReturnValue(throwError(() => new ApiError('Server failed.', 500)));
    await store.submit(payload());

    const accepted = await store.submit(payload({ contributionDate: '2026-09-21' }));

    expect(accepted).toBe(false);
    expect(split).toHaveBeenCalledOnce();
    expect(store.state()).toMatchObject({ status: 'uncertain', attempt: { key: firstKey } });
  });

  it('replaces a freshly generated key collision only after explicit confirmation', async () => {
    split
      .mockReturnValueOnce(throwError(() => apiError(409, { reason: 'idempotency_mismatch' })))
      .mockReturnValueOnce(of(success()));

    await store.submit(payload({ contributionDate: '2026-09-21' }));

    expect(store.state()).toMatchObject({
      status: 'idempotency-mismatch',
      freshKeyCollision: true,
      attempt: { key: firstKey, payload: payload({ contributionDate: '2026-09-21' }) },
    });
    expect(store.state()).not.toHaveProperty('message', "We couldn't save your contributions. Nothing was created.");
    expect(await store.submit(payload())).toBe(false);

    await store.retryFreshKeyCollision();
    expect(split).toHaveBeenNthCalledWith(2, payload({ contributionDate: '2026-09-21' }), secondKey);
    expect(store.state()).toMatchObject({ status: 'confirmed', attempt: { key: secondKey } });
  });

  it('keeps a replay mismatch tied to its original key until the original payload is supplied', async () => {
    split
      .mockReturnValueOnce(throwError(() => apiError(503, { reason: 'operation_outcome_unknown' })))
      .mockReturnValueOnce(throwError(() => apiError(409, { reason: 'idempotency_mismatch' })))
      .mockReturnValueOnce(of(success()));

    await store.submit(payload());
    await store.retryUncertain();

    expect(store.state()).toMatchObject({
      status: 'idempotency-mismatch',
      freshKeyCollision: false,
      attempt: { key: firstKey },
    });
    expect(await store.retryFreshKeyCollision()).toBe(false);

    await store.resolveMismatch(payload());
    expect(split).toHaveBeenNthCalledWith(3, payload(), firstKey);
    expect(store.state()).toMatchObject({ status: 'confirmed', attempt: { key: firstKey } });
  });

  it('treats a replay after deletion as historical and a failed current read never resubmits', async () => {
    split.mockReturnValue(of(success()));
    refreshGoalHistory.mockImplementation((goalId: number) =>
      goalId === 12 ? throwError(() => new ApiError('Gone', 404)) : of([]),
    );

    await store.submit(payload());

    expect(store.state()).toEqual({
      status: 'confirmed',
      attempt: { key: firstKey, payload: payload() },
      historicalResult: success(),
      refresh: 'failed',
    });
    expect(split).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledOnce();
    expect(refreshGoalHistory).toHaveBeenCalledTimes(2);
  });

  it('keeps stale saved snapshots historical while refreshed context remains authoritative', async () => {
    const saved = success({ linkedTotal: 135.5, remainingCapacity: 364.5 });
    split.mockReturnValue(of(saved));
    refresh.mockImplementation(async () => {
      authoritativeState.set({ linkedTotal: 10, remainingCapacity: 490, availableHeadroom: 990 });
      return true;
    });

    await store.submit(payload());

    expect(store.state()).toMatchObject({
      status: 'confirmed',
      historicalResult: saved,
      refresh: 'succeeded',
    });
    expect(authoritativeState()).toEqual({ linkedTotal: 10, remainingCapacity: 490, availableHeadroom: 990 });
    expect(authoritativeState().remainingCapacity).not.toBe(saved.remainingCapacity);
  });

  it('uses a new key for changed semantic input only after a definitive resolution', async () => {
    split
      .mockReturnValueOnce(
        throwError(() =>
          apiError(409, { reason: 'goal_inactive', created: false, failures: [{ reason: 'goal_inactive' }] }),
        ),
      )
      .mockReturnValueOnce(of(success()));
    await store.submit(payload());

    await store.submit(payload({ contributionDate: '2026-09-21' }));

    expect(split).toHaveBeenNthCalledWith(2, payload({ contributionDate: '2026-09-21' }), secondKey);
  });
});

function payload(overrides: Partial<{ contributionDate: string }> = {}) {
  return {
    transactionId: 42,
    contributionDate: overrides.contributionDate ?? '2026-09-20',
    contributions: [
      { goalId: 12, amount: 125.5, note: '  Keep spaces  ', acknowledgeTargetOverrun: false },
      { goalId: 9, amount: 10, note: '', acknowledgeTargetOverrun: true },
    ],
  };
}

function success(overrides: Partial<{ linkedTotal: number; remainingCapacity: number }> = {}) {
  return {
    transactionId: 42,
    transactionAmount: 500,
    linkedTotal: 135.5,
    remainingCapacity: 364.5,
    account: {
      id: 7,
      name: 'BPI Savings',
      currentBalance: 1000,
      earmarkedTotal: 135.5,
      availableHeadroom: 864.5,
      active: true,
    },
    contributions: [],
    ...overrides,
  };
}

function apiError(status: number, details: Record<string, unknown>): ApiError {
  return new ApiError('Server prose is not the contract.', status, {}, details);
}
