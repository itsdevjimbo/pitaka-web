import { describe, expect, it } from 'vitest';
import { withAccountNames } from './contribution-account-name';

describe('withAccountNames', () => {
  it('adds Account names from the fresh Account read without changing Contribution facts', () => {
    expect(
      withAccountNames(
        [
          {
            id: 4,
            goalId: 3,
            accountId: 2,
            transactionId: null,
            amount: 400,
            contributionDate: new Date(2026, 8, 13),
            note: null,
          },
        ],
        [
          {
            id: 2,
            name: 'Everyday cash',
            type: 'Cash',
            currentBalance: 500,
            isActive: true,
          },
        ]
      )
    ).toEqual([
      {
        id: 4,
        goalId: 3,
        accountId: 2,
        transactionId: null,
        amount: 400,
        contributionDate: new Date(2026, 8, 13),
        note: null,
        accountName: 'Everyday cash',
      },
    ]);
  });
});
