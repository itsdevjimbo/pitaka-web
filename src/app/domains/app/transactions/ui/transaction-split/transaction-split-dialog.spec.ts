import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { NEVER, of, Subject, throwError } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { provideIcons } from '@/app/core/icons';
import { GoalContributionsService, GoalsService } from '@/app/domains/app/goals';
import {
  TransactionSplitIdempotencyMismatchError,
  TransactionSplitRefusalError,
  TransactionSplitResult,
  TransactionSplitValidationError,
} from '../../data/linked-contributions/transaction-split';
import { Transaction } from '../../data/transaction';
import { TransactionsService } from '../../data/transactions.service';
import { TransactionSplitContextStore } from './transaction-split-context';
import { TransactionSplitDialog } from './transaction-split-dialog';
import { TRANSACTION_SPLIT_IDEMPOTENCY_KEY, TransactionSplitRecoveryStore } from './transaction-split-recovery';

const SOURCE: Transaction = {
  id: 42,
  amount: 500,
  direction: 'income',
  accountId: 7,
  transferToAccountId: null,
  date: new Date(2026, 8, 15, 9),
  categoryId: 2,
  generated: true,
  description: 'Salary',
  tags: [],
};

const SNAPSHOT = {
  transactionId: 42,
  transactionAmount: 500,
  linkedTotal: 100,
  remainingCapacity: 400,
  account: {
    id: 7,
    name: 'BPI Savings',
    currentBalance: 1_000,
    earmarkedTotal: 200,
    availableHeadroom: 800,
    active: true,
  },
  linkedContributions: [],
};

const GOALS = [
  { id: 12, name: 'Holiday', targetAmount: 200, targetDate: null, status: 'Active' as const, currentAmount: 150 },
  { id: 9, name: 'Emergency', targetAmount: 1_000, targetDate: null, status: 'Active' as const, currentAmount: 250 },
];

describe('TransactionSplitDialog', () => {
  let fixture: ComponentFixture<TransactionSplitDialog>;
  let split: ReturnType<typeof vi.fn>;
  let dialogRef: { close: ReturnType<typeof vi.fn>; keydownEvents: () => typeof NEVER };

  function setup(
    overrides: {
      snapshot?: typeof SNAPSHOT;
      split?: TransactionsService['splitLinkedContributions'];
      linkedContributions?: TransactionsService['linkedContributions'];
      goals?: GoalsService['list'];
    } = {},
  ) {
    split = vi.fn(
      overrides.split ??
        (() =>
          of({
            ...SNAPSHOT,
            contributions: [],
          } satisfies TransactionSplitResult)),
    );
    dialogRef = { close: vi.fn(), keydownEvents: () => NEVER };
    const snapshot = overrides.snapshot ?? SNAPSHOT;
    const keys = ['74287c99-1f5c-49b7-9d24-81e884c634a0', '2c159351-a5b0-4930-9f19-f1446a8d9231'];

    TestBed.configureTestingModule({
      imports: [TransactionSplitDialog],
      providers: [
        provideIcons(),
        TransactionSplitContextStore,
        TransactionSplitRecoveryStore,
        { provide: MAT_DIALOG_DATA, useValue: { transaction: SOURCE } },
        { provide: MatDialogRef, useValue: dialogRef },
        {
          provide: TransactionsService,
          useValue: {
            linkedContributions: overrides.linkedContributions ?? (() => of(snapshot)),
            splitLinkedContributions: split,
          },
        },
        { provide: GoalsService, useValue: { list: overrides.goals ?? (() => of(GOALS)) } },
        { provide: GoalContributionsService, useValue: { list: () => of([]) } },
        { provide: TRANSACTION_SPLIT_IDEMPOTENCY_KEY, useValue: () => keys.shift()! },
      ],
    });
    fixture = TestBed.createComponent(TransactionSplitDialog);
    fixture.detectChanges();
  }

  async function settle() {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function text() {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  function control<T extends HTMLElement>(selector: string): T {
    const element = (fixture.nativeElement as HTMLElement).querySelector<T>(selector);
    if (!element) {
      throw new Error(`Expected ${selector}`);
    }
    return element;
  }

  function button(label: string): HTMLButtonElement {
    const element = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')).find(
      (candidate) => candidate.textContent?.trim() === label,
    );
    if (!element) {
      throw new Error(`Expected button: ${label}`);
    }
    return element;
  }

  function input(selector: string, value: string) {
    const element = control<HTMLInputElement>(selector);
    element.value = value;
    element.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  it('shows fixed Transaction and Account facts with one shared date and one initial row', async () => {
    setup();
    await settle();

    expect(text()).toContain('Salary');
    expect(text()).toContain('BPI Savings');
    expect(text()).toContain('₱500.00');
    expect(text()).toContain('₱100.00 already linked');
    expect(text()).toContain('₱400.00 Transaction capacity');
    expect(text()).toContain('₱800.00 Account headroom');
    expect(controlAll('select[aria-label$=" Goal"]')).toHaveLength(1);
    expect(control<HTMLInputElement>('input[aria-label="Contribution date"]')).toBeTruthy();
  });

  it('keeps creation visible but disabled with the capacity explanation', async () => {
    setup({ snapshot: { ...SNAPSHOT, remainingCapacity: 0 } });
    await settle();

    expect(text()).toContain('This Transaction has no remaining capacity');
    expect(button('Create contributions').disabled).toBe(true);
  });

  it('retries an initial context failure through the rendered control', async () => {
    let reads = 0;
    setup({
      linkedContributions: () => {
        reads += 1;
        return reads === 1 ? throwError(() => new ApiError('Unavailable.', 503)) : of(SNAPSHOT);
      },
    });
    await settle();

    expect(text()).toContain('Could not load the current Transaction, Account, and Goal details');
    button('Try again').click();
    await settle();

    expect(reads).toBe(2);
    expect(text()).toContain('₱400.00 Transaction capacity');
  });

  it('rejects duplicate Goals, fractional cents, and a total beyond either capacity', async () => {
    setup({
      snapshot: { ...SNAPSHOT, remainingCapacity: 100, account: { ...SNAPSHOT.account, availableHeadroom: 75 } },
    });
    await settle();

    chooseGoal(0, '12');
    input('input[aria-label="Contribution 1 amount"]', '50.001');
    button('Add another Goal').click();
    fixture.detectChanges();
    chooseGoal(1, '12');
    input('input[aria-label="Contribution 2 amount"]', '50');
    button('Create contributions').click();
    fixture.detectChanges();

    expect(text()).toContain('Use an amount with no more than two decimal places');
    expect(text()).toContain('Choose each Goal only once');
    expect(text()).toContain('The total exceeds the Account headroom');
    expect(split).not.toHaveBeenCalled();
  });

  it('warns per row about a target overrun and requires its explicit acknowledgement', async () => {
    setup();
    await settle();

    chooseGoal(0, '12');
    input('input[aria-label="Contribution 1 amount"]', '75');

    expect(text()).toContain('This would put Holiday at ₱225.00, ₱25.00 over its target');
    expect(control<HTMLInputElement>('input[aria-label="Contribution 1 acknowledge target overrun"]').checked).toBe(
      false,
    );
    button('Create contributions').click();
    expect(split).not.toHaveBeenCalled();
  });

  it('submits one ordered request for one-row and multi-row splits and closes only after refresh', async () => {
    const pending = new Subject<TransactionSplitResult>();
    setup({ split: () => pending.asObservable() });
    await settle();

    chooseGoal(0, '12');
    input('input[aria-label="Contribution 1 amount"]', '25.50');
    input('input[aria-label="Contribution 1 note"]', '  First  ');
    button('Add another Goal').click();
    fixture.detectChanges();
    chooseGoal(1, '9');
    input('input[aria-label="Contribution 2 amount"]', '10');
    input('input[aria-label="Contribution date"]', '2026-09-20');
    button('Create contributions').click();
    await settle();

    expect(split).toHaveBeenCalledWith(
      {
        transactionId: 42,
        contributionDate: '2026-09-20',
        contributions: [
          { goalId: 12, amount: 25.5, note: '  First  ', acknowledgeTargetOverrun: false },
          { goalId: 9, amount: 10, note: '', acknowledgeTargetOverrun: false },
        ],
      },
      '74287c99-1f5c-49b7-9d24-81e884c634a0',
    );
    expect(button('Creating…').disabled).toBe(true);
    expect(control<HTMLButtonElement>('button[aria-label="Close"]').disabled).toBe(false);
    expect(button('Cancel').disabled).toBe(false);
    expect(dialogRef.close).not.toHaveBeenCalled();

    pending.next({ ...SNAPSHOT, contributions: [] });
    pending.complete();
    await settle();

    await vi.waitFor(() => expect(dialogRef.close).toHaveBeenCalledWith(true));
  });

  it('accepts an exact-capacity one-row split dated before the source Transaction', async () => {
    setup();
    await settle();

    chooseGoal(0, '9');
    input('input[aria-label="Contribution 1 amount"]', '400');
    input('input[aria-label="Contribution date"]', '2026-09-01');
    button('Create contributions').click();

    await vi.waitFor(() => expect(dialogRef.close).toHaveBeenCalledWith(true));
    expect(split).toHaveBeenCalledWith(
      {
        transactionId: 42,
        contributionDate: '2026-09-01',
        contributions: [{ goalId: 9, amount: 400, note: '', acknowledgeTargetOverrun: false }],
      },
      '74287c99-1f5c-49b7-9d24-81e884c634a0',
    );
  });

  it('accepts valid cent amounts that are not exact binary floating-point products', async () => {
    setup();
    await settle();

    chooseGoal(0, '9');
    input('input[aria-label="Contribution 1 amount"]', '1.15');
    button('Create contributions').click();

    await vi.waitFor(() => expect(dialogRef.close).toHaveBeenCalledWith(true));
    expect(split).toHaveBeenCalledWith(
      expect.objectContaining({ contributions: [expect.objectContaining({ amount: 1.15 })] }),
      expect.any(String),
    );
  });

  it('freezes and retains an uncertain attempt until Retry safely resolves the same key and payload', async () => {
    let attempts = 0;
    setup({
      split: () => {
        attempts += 1;
        return attempts === 1
          ? throwError(() => new ApiError('Unknown outcome.', 503, {}, { reason: 'operation_outcome_unknown' }))
          : of({ ...SNAPSHOT, contributions: [] });
      },
    });
    await settle();
    chooseGoal(0, '9');
    input('input[aria-label="Contribution 1 amount"]', '10');
    button('Create contributions').click();
    await settle();

    expect(text()).toContain("We couldn't confirm whether the contribution was created");
    expect(control<HTMLInputElement>('input[aria-label="Contribution 1 amount"]').matches(':disabled')).toBe(true);
    expect(control<HTMLButtonElement>('button[aria-label="Close"]').disabled).toBe(false);
    expect(button('Cancel').disabled).toBe(false);
    const [originalPayload, originalKey] = split.mock.calls[0];

    button('Retry safely').click();
    await vi.waitFor(() => expect(dialogRef.close).toHaveBeenCalledWith(true));
    expect(split).toHaveBeenNthCalledWith(2, originalPayload, originalKey);
  });

  it('explicitly replaces a fresh idempotency-key collision without changing the payload', async () => {
    let attempts = 0;
    setup({
      split: () => {
        attempts += 1;
        return attempts === 1
          ? throwError(() => new TransactionSplitIdempotencyMismatchError())
          : of({ ...SNAPSHOT, contributions: [] });
      },
    });
    await settle();
    chooseGoal(0, '9');
    input('input[aria-label="Contribution 1 amount"]', '10');
    button('Create contributions').click();
    await settle();

    expect(text()).toContain('This new recovery key was already used');
    const [originalPayload, originalKey] = split.mock.calls[0];
    button('Try with a new key').click();

    await vi.waitFor(() => expect(dialogRef.close).toHaveBeenCalledWith(true));
    expect(split).toHaveBeenCalledTimes(2);
    expect(split.mock.calls[1][0]).toEqual(originalPayload);
    expect(split.mock.calls[1][1]).not.toBe(originalKey);
  });

  it('maps indexed validation and definitive row failures without claiming rollback for uncertain outcomes', async () => {
    setup({
      split: () =>
        throwError(
          () =>
            new TransactionSplitValidationError({
              'contributions[0].amount': ['Use a positive cent-precise amount.'],
              contributionDate: ['Choose a valid date.'],
              contributions: ['Goal indexes 0 and 1 are duplicates.'],
            }),
        ),
    });
    await settle();
    chooseGoal(0, '12');
    input('input[aria-label="Contribution 1 amount"]', '25');
    button('Create contributions').click();
    await settle();

    expect(text()).toContain('Use a positive cent-precise amount.');
    expect(text()).toContain('Choose a valid date.');
    expect(text()).toContain('Goal indexes 0 and 1 are duplicates.');
    expect(text()).not.toContain('Nothing was created');
  });

  it('retries a failed authoritative refresh after a definitive refusal', async () => {
    let reads = 0;
    setup({
      linkedContributions: () => {
        reads += 1;
        return reads === 2 ? throwError(() => new ApiError('Unavailable.', 503)) : of(SNAPSHOT);
      },
      split: () => throwError(() => new TransactionSplitRefusalError([{ reason: 'account_headroom_exceeded' }])),
    });
    await settle();
    chooseGoal(0, '9');
    input('input[aria-label="Contribution 1 amount"]', '10');
    button('Create contributions').click();
    await settle();

    expect(text()).toContain('The latest capacity could not be loaded');
    button('Try refresh again').click();
    await settle();

    expect(reads).toBe(3);
    expect(text()).toContain('₱400.00 Transaction capacity');
  });

  it('does not resubmit a Goal that became inactive after a definitive refusal', async () => {
    let goalReads = 0;
    setup({
      goals: () => of(goalReads++ === 0 ? GOALS : [GOALS[1]]),
      split: () =>
        throwError(
          () =>
            new TransactionSplitRefusalError([
              { reason: 'goal_inactive', rowIndex: 0, goalId: 12, goalName: 'Holiday' },
            ]),
        ),
    });
    await settle();
    chooseGoal(0, '12');
    input('input[aria-label="Contribution 1 amount"]', '25');
    button('Create contributions').click();
    await settle();

    expect(text()).toContain('Holiday is no longer Active');
    button('Create contributions').click();

    expect(split).toHaveBeenCalledOnce();
  });

  function chooseGoal(index: number, value: string) {
    const select = control<HTMLSelectElement>(`select[aria-label="Contribution ${index + 1} Goal"]`);
    select.value = value;
    select.dispatchEvent(new Event('input'));
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  function controlAll(selector: string) {
    return Array.from((fixture.nativeElement as HTMLElement).querySelectorAll(selector));
  }
});
