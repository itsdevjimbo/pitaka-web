import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL, errorInterceptor } from '@/app/core/api';
import { TEST_API_BASE_URL as BASE_URL } from '@/testing/api-base-url';
import { TransactionsService } from './transactions.service';

describe('authoritative Linked Contribution reads', () => {
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

  it('maps the complete authoritative wire response without clamping signed facts or collapsing history', async () => {
    const result = firstValueFrom(service.linkedContributions(42));
    const request = http.expectOne(`${BASE_URL}/api/transactions/42/linked-contributions`);
    expect(request.request.method).toBe('GET');
    request.flush({
      transactionId: 42,
      transactionAmount: 500,
      linkedTotal: 650,
      remainingCapacity: -150,
      account: {
        id: 7,
        name: 'BPI Savings',
        currentBalance: 400,
        earmarkedTotal: 525,
        availableHeadroom: -125,
        active: false,
      },
      linkedContributions: [
        contribution({ id: 91, goalName: 'Emergency fund' }),
        contribution({ id: 92, goalName: 'Emergency fund', amount: 250 }),
        contribution({
          id: 93,
          goalId: 18,
          goalName: 'Completed holiday',
          amount: 100,
        }),
      ],
    });

    await expect(result).resolves.toEqual({
      transactionId: 42,
      transactionAmount: 500,
      linkedTotal: 650,
      remainingCapacity: -150,
      account: {
        id: 7,
        name: 'BPI Savings',
        currentBalance: 400,
        earmarkedTotal: 525,
        availableHeadroom: -125,
        active: false,
      },
      linkedContributions: [
        mappedContribution({ id: 91, goalName: 'Emergency fund' }),
        mappedContribution({ id: 92, goalName: 'Emergency fund', amount: 250 }),
        mappedContribution({
          id: 93,
          goalId: 18,
          goalName: 'Completed holiday',
          amount: 100,
        }),
      ],
    });
  });
});

function contribution(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 91,
    goalId: 12,
    goalName: 'Emergency fund',
    accountId: 7,
    transactionId: 42,
    amount: 300,
    contributionDate: '2026-09-15',
    note: null,
    ...overrides,
  };
}

function mappedContribution(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    ...contribution(overrides),
    contributionDate: new Date(2026, 8, 15),
  };
}
