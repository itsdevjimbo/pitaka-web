import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL, errorInterceptor } from '@/app/core/api';
import { TEST_API_BASE_URL as BASE_URL } from '@/testing/api-base-url';
import { TransactionsService } from '../transactions.service';
import {
  TransactionSplitIdempotencyMismatchError,
  TransactionSplitRefusalError,
  TransactionSplitValidationError,
} from './transaction-split';

describe('Transaction split write adapter', () => {
  let service: TransactionsService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: BASE_URL },
      ],
    });
    service = TestBed.inject(TransactionsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('posts the exact ordered semantic payload with its supplied idempotency key', async () => {
    const payload = {
      transactionId: 42,
      contributionDate: '2026-09-20',
      contributions: [
        { goalId: 12, amount: 125.5, note: '  Keep spaces  ', acknowledgeTargetOverrun: false },
        { goalId: 9, amount: 10, note: '', acknowledgeTargetOverrun: true },
      ],
    } as const;
    const result = firstValueFrom(service.splitLinkedContributions(payload, '74287c99-1f5c-49b7-9d24-81e884c634a0'));

    const request = http.expectOne(`${BASE_URL}/api/transactions/42/linked-contributions`);
    expect(request.request.method).toBe('POST');
    expect(request.request.headers.get('Idempotency-Key')).toBe('74287c99-1f5c-49b7-9d24-81e884c634a0');
    expect(request.request.body).toEqual({
      contributionDate: '2026-09-20',
      contributions: [
        { goalId: 12, amount: 125.5, note: '  Keep spaces  ', acknowledgeTargetOverrun: false },
        { goalId: 9, amount: 10, note: '', acknowledgeTargetOverrun: true },
      ],
    });
    request.flush(successResource());

    await expect(result).resolves.toMatchObject({
      transactionId: 42,
      contributions: [
        { id: 101, goalId: 12, contributionDate: new Date(2026, 8, 20), note: '  Keep spaces  ' },
        { id: 102, goalId: 9, contributionDate: new Date(2026, 8, 20), note: '' },
      ],
    });
  });

  it('translates structured refusal reasons and every returned failure', async () => {
    const result = firstValueFrom(
      service.splitLinkedContributions(
        { transactionId: 42, contributionDate: '2026-09-20', contributions: [] },
        '74287c99-1f5c-49b7-9d24-81e884c634a0',
      ),
    );
    http.expectOne(`${BASE_URL}/api/transactions/42/linked-contributions`).flush(
      {
        detail: 'Server wording is not the contract.',
        reason: 'split_rejected',
        created: false,
        failures: [
          { reason: 'goal_inactive', rowIndex: 0, goalId: 12, goalName: 'Holiday', currentState: 'Completed' },
          { reason: 'account_headroom_exceeded', accountId: 7, availableHeadroom: 25 },
        ],
      },
      { status: 409, statusText: 'Conflict' },
    );

    const error = await result.catch((value: unknown) => value);
    expect(error).toBeInstanceOf(TransactionSplitRefusalError);
    expect(error).toMatchObject({
      failures: [
        { reason: 'goal_inactive', rowIndex: 0, goalId: 12, goalName: 'Holiday' },
        { reason: 'account_headroom_exceeded' },
      ],
    });
  });

  it('translates indexed validation paths for the split form', async () => {
    const result = firstValueFrom(
      service.splitLinkedContributions(
        { transactionId: 42, contributionDate: '', contributions: [] },
        '74287c99-1f5c-49b7-9d24-81e884c634a0',
      ),
    );
    http.expectOne(`${BASE_URL}/api/transactions/42/linked-contributions`).flush(
      {
        errors: {
          ContributionDate: ['Choose a valid date.'],
          'Contributions[1].Amount': ['Use a positive cent-precise amount.'],
        },
      },
      { status: 400, statusText: 'Bad Request' },
    );

    const error = await result.catch((value: unknown) => value);
    expect(error).toBeInstanceOf(TransactionSplitValidationError);
    expect(error).toMatchObject({
      fieldErrors: {
        contributionDate: ['Choose a valid date.'],
        'contributions[1].amount': ['Use a positive cent-precise amount.'],
      },
    });
  });

  it('translates idempotency mismatch without treating it as an atomic refusal', async () => {
    const result = firstValueFrom(
      service.splitLinkedContributions(
        { transactionId: 42, contributionDate: '2026-09-20', contributions: [] },
        '74287c99-1f5c-49b7-9d24-81e884c634a0',
      ),
    );
    http
      .expectOne(`${BASE_URL}/api/transactions/42/linked-contributions`)
      .flush({ reason: 'idempotency_mismatch' }, { status: 409, statusText: 'Conflict' });

    const error = await result.catch((value: unknown) => value);
    expect(error).toBeInstanceOf(TransactionSplitIdempotencyMismatchError);
    expect(error).not.toBeInstanceOf(TransactionSplitRefusalError);
  });
});

function successResource() {
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
    contributions: [
      {
        id: 101,
        goalId: 12,
        accountId: 7,
        transactionId: 42,
        amount: 125.5,
        contributionDate: '2026-09-20',
        note: '  Keep spaces  ',
      },
      {
        id: 102,
        goalId: 9,
        accountId: 7,
        transactionId: 42,
        amount: 10,
        contributionDate: '2026-09-20',
        note: '',
      },
    ],
  };
}
