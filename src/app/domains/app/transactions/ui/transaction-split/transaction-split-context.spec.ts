import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { API_BASE_URL, errorInterceptor } from '@/app/core/api';
import { TEST_API_BASE_URL as BASE_URL } from '@/testing/api-base-url';
import { Transaction } from '../../data/transaction';
import { TransactionSplitContextStore } from './transaction-split-context';

describe('TransactionSplitContextStore', () => {
  let store: TransactionSplitContextStore;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        TransactionSplitContextStore,
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: BASE_URL },
      ],
    });
    store = TestBed.inject(TransactionSplitContextStore);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('prepares fixed generated-income context and only Active Goal choices with progress', async () => {
    const source = transaction({ generated: true });
    const loaded = store.load(source);
    expect(store.state()).toEqual({ status: 'loading' });

    linkedRequest().flush(linkedResource());
    goalsRequest().flush([
      goalResource({ id: 2, name: 'Emergency', currentAmount: 1250 }),
      goalResource({ id: 3, name: 'Done', status: 'Completed' }),
      goalResource({ id: 4, name: 'Paused dream', status: 'Abandoned' }),
    ]);
    await loaded;

    expect(store.state()).toMatchObject({
      status: 'ready',
      context: {
        source,
        goals: [
          {
            id: 2,
            name: 'Emergency',
            status: 'Active',
            currentAmount: 1250,
            targetAmount: 5000,
          },
        ],
        availability: { available: true },
      },
    });
    expect(store.canCreate()).toBe(true);
  });

  it.each([
    ['expense', transaction({ direction: 'expense' }), linkedResource(), 'transaction-ineligible'],
    ['transfer', transaction({ direction: 'transfer' }), linkedResource(), 'transaction-ineligible'],
    [
      'retired Account',
      transaction(),
      linkedResource({ account: accountResource({ active: false }) }),
      'account-inactive',
    ],
    ['zero Transaction capacity', transaction(), linkedResource({ remainingCapacity: 0 }), 'transaction-capacity'],
    [
      'negative Account headroom',
      transaction(),
      linkedResource({ account: accountResource({ availableHeadroom: -0.01 }) }),
      'account-headroom',
    ],
  ] as const)(
    'keeps history readable but explains why creation is unavailable for %s',
    async (_case, source, linked, reason) => {
      const loaded = store.load(source);
      linkedRequest().flush(linked);
      goalsRequest().flush([goalResource()]);
      await loaded;

      const state = store.state();
      expect(state.status).toBe('ready');
      if (state.status !== 'ready') {
        return;
      }
      expect(state.context.snapshot.linkedContributions).toHaveLength(2);
      expect(state.context.availability).toMatchObject({
        available: false,
        reason,
      });
      expect(state.context.availability.explanation).not.toBe('');
      expect(store.canCreate()).toBe(false);
    },
  );

  it('represents no eligible Goals separately from an initial error and recovers on retry', async () => {
    const first = store.load(transaction());
    linkedRequest().flush(linkedResource());
    goalsRequest().flush([goalResource({ status: 'Completed' }), goalResource({ id: 3, status: 'Abandoned' })]);
    await first;

    expect(store.state()).toMatchObject({
      status: 'ready',
      context: {
        goals: [],
        availability: { available: false, reason: 'no-active-goals' },
      },
    });

    const failed = store.load(transaction());
    goalsRequest().flush([goalResource()]);
    linkedRequest().flush(null, { status: 500, statusText: 'Server Error' });
    await failed;
    expect(store.state()).toEqual({ status: 'initial-error' });

    const retried = store.retry();
    linkedRequest().flush(linkedResource());
    goalsRequest().flush([goalResource()]);
    await retried;
    expect(store.state().status).toBe('ready');
  });

  it('preserves readable context after a failed refresh and blocks creation until recovery', async () => {
    const loaded = store.load(transaction());
    linkedRequest().flush(linkedResource());
    goalsRequest().flush([goalResource()]);
    await loaded;
    const failedRefresh = store.refresh();
    expect(store.state()).toMatchObject({ status: 'refreshing' });
    goalsRequest().flush([goalResource()]);
    linkedRequest().flush(null, { status: 503, statusText: 'Unavailable' });
    await failedRefresh;

    expect(store.state()).toMatchObject({
      status: 'refresh-failed',
      history: {
        source: transaction(),
        account: { id: 7, name: 'BPI Savings' },
        linkedContributions: [{ id: 91 }, { id: 92 }],
      },
    });
    expect(store.state()).not.toHaveProperty('context.snapshot.account.currentBalance');
    expect(store.canCreate()).toBe(false);

    const recovered = store.refresh();
    linkedRequest().flush(linkedResource({ remainingCapacity: 100 }));
    goalsRequest().flush([goalResource()]);
    await recovered;
    expect(store.state().status).toBe('ready');
    expect(store.canCreate()).toBe(true);
  });

  function linkedRequest() {
    return http.expectOne(`${BASE_URL}/api/transactions/42/linked-contributions`);
  }

  function goalsRequest() {
    return http.expectOne(`${BASE_URL}/api/goals`);
  }
});

function transaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 42,
    amount: 500,
    direction: 'income',
    accountId: 7,
    transferToAccountId: null,
    date: new Date(2026, 8, 15, 9),
    categoryId: 2,
    generated: false,
    description: 'Salary',
    tags: [],
    ...overrides,
  };
}

function accountResource(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 7,
    name: 'BPI Savings',
    currentBalance: 1000,
    earmarkedTotal: 350,
    availableHeadroom: 650,
    active: true,
    ...overrides,
  };
}

function linkedResource(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    transactionId: 42,
    transactionAmount: 500,
    linkedTotal: 300,
    remainingCapacity: 200,
    account: accountResource(),
    linkedContributions: [
      contributionResource({ id: 91, goalId: 2, goalName: 'Emergency' }),
      contributionResource({ id: 92, goalId: 3, goalName: 'Done' }),
    ],
    ...overrides,
  };
}

function contributionResource(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 91,
    goalId: 2,
    goalName: 'Emergency',
    accountId: 7,
    transactionId: 42,
    amount: 150,
    contributionDate: '2026-09-15',
    note: null,
    ...overrides,
  };
}

function goalResource(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 2,
    name: 'Emergency',
    targetAmount: 5000,
    targetDate: null,
    status: 'Active',
    currentAmount: 1000,
    ...overrides,
  };
}
