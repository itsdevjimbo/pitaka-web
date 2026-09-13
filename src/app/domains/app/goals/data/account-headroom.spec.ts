import { describe, expect, it } from 'vitest';
import { accountHeadroom } from './account-headroom';

describe('accountHeadroom', () => {
  it('subtracts pooled earmarks from each Account balance and clamps an over-earmarked Account to zero', () => {
    expect(
      accountHeadroom(
        [
          { id: 1, currentBalance: 100 },
          { id: 2, currentBalance: 50 },
          { id: 3, currentBalance: -25 },
        ],
        [
          { accountId: 1, amount: 30 },
          { accountId: 1, amount: 80 },
          { accountId: 2, amount: 20 },
          { accountId: 99, amount: 500 },
        ]
      )
    ).toEqual([
      { accountId: 1, availableAmount: 0 },
      { accountId: 2, availableAmount: 30 },
      { accountId: 3, availableAmount: 0 },
    ]);
  });

  it('rounds peso arithmetic so a two-decimal available amount stays exact', () => {
    expect(
      accountHeadroom(
        [{ id: 1, currentBalance: 1 }],
        [
          { accountId: 1, amount: 0.1 },
          { accountId: 1, amount: 0.2 },
        ]
      )
    ).toEqual([{ accountId: 1, availableAmount: 0.7 }]);
  });
});
