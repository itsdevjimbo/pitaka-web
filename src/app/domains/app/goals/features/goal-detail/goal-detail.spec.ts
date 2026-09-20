import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS, provideNativeDateAdapter } from '@angular/material/core';
import { provideRouter } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { provideIcons } from '@/app/core/icons';
import { formatPeso } from '@/app/core/money';
import { Account, AccountsService } from '@/app/domains/app/accounts';
import { Transaction, TransactionsService } from '@/app/domains/app/transactions';
import {
  Goal,
  GoalContribution,
  GoalContributionsService,
  GoalContributionWithAccountName,
  GoalsService,
} from '../../index';
import GoalDetail from './goal-detail';

type GoalDetailInternals = {
  history(): readonly GoalContributionWithAccountName[] | null;
  deletingContributionId(): number | null;
  askContributionDelete(contribution: GoalContributionWithAccountName): void;
  confirmContributionDelete(): void;
};

const GOAL: Goal = {
  id: 3,
  name: 'Dental work',
  targetAmount: 30000,
  targetDate: new Date(2026, 2, 1),
  status: 'Active',
  currentAmount: 18000,
};

const ACCOUNT: Account = {
  id: 8,
  name: 'Everyday cash',
  type: 'Cash',
  currentBalance: 50000,
  isActive: true,
};

function contribution(over: Partial<GoalContribution> = {}): GoalContribution {
  return {
    id: 1,
    goalId: 3,
    accountId: 8,
    transactionId: null,
    amount: 1200,
    contributionDate: new Date(2026, 8, 12),
    note: null,
    ...over,
  };
}

describe('GoalDetail', () => {
  function setup(
    over: {
      get?: GoalsService['get'];
      list?: GoalContributionsService['list'];
      accounts?: AccountsService['all'];
      transactions?: TransactionsService['list'];
      linked?: TransactionsService['linkedContributions'];
      deleteContribution?: GoalContributionsService['delete'];
      id?: string;
    } = {},
  ) {
    const get = over.get ?? (() => of(GOAL));
    const list = over.list ?? (() => of<GoalContribution[]>([]));
    const accounts = over.accounts ?? (() => of([ACCOUNT]));
    const transactions = over.transactions ?? (() => of<Transaction[]>([]));
    const linked = over.linked ?? (() => of({} as never));
    const deleteContribution = over.deleteContribution ?? (() => of(undefined));

    TestBed.configureTestingModule({
      imports: [GoalDetail],
      providers: [
        provideIcons(),
        provideNativeDateAdapter(),
        provideRouter([]),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        { provide: GoalsService, useValue: { get } },
        { provide: GoalContributionsService, useValue: { list, delete: deleteContribution } },
        { provide: AccountsService, useValue: { all: accounts } },
        { provide: TransactionsService, useValue: { list: transactions, linkedContributions: linked } },
      ],
    });

    const fixture = TestBed.createComponent(GoalDetail);
    fixture.componentRef.setInput('id', over.id ?? '3');
    fixture.detectChanges();
    return {
      fixture,
      cmp: fixture.componentInstance as unknown as GoalDetailInternals,
      text: () => (fixture.nativeElement as HTMLElement).textContent ?? '',
    };
  }

  async function settle(fixture: ComponentFixture<GoalDetail>) {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('shows first-entry loading until the Goal, history, and Accounts are fresh', async () => {
    const pending = new Subject<GoalContribution[]>();
    const { fixture, text } = setup({ list: () => pending.asObservable() });

    expect(text()).toContain('Loading contributions…');
    pending.next([contribution({ note: 'First deposit' })]);
    pending.complete();
    await settle(fixture);
    expect(text()).toContain('First deposit');
  });

  it('repeats the Goal facts and shows newest-first history with Account names and notes', () => {
    const { fixture, text } = setup({
      list: () =>
        of([
          contribution({ id: 4, amount: 500, contributionDate: new Date(2026, 8, 12) }),
          contribution({ id: 8, amount: 900, contributionDate: new Date(2026, 8, 13), note: 'Payday' }),
          contribution({ id: 7, amount: 800, contributionDate: new Date(2026, 8, 13) }),
        ]),
    });

    const body = text();
    expect(body).toContain('Dental work');
    expect(body).toContain(`${formatPeso(18000)} of ${formatPeso(30000)}`);
    expect(body).toContain('By 1 Mar 2026');
    expect(body).not.toContain('%');
    expect(body).toContain('Everyday cash');
    expect(body).toContain('Payday');
    expect((fixture.nativeElement as HTMLElement).querySelector('[aria-label="Goal actions"]')).not.toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('[aria-label="Contribution actions"]').length).toBe(
      3,
    );
    expect(body.indexOf(formatPeso(900))).toBeLessThan(body.indexOf(formatPeso(800)));
    expect(body.indexOf(formatPeso(800))).toBeLessThan(body.indexOf(formatPeso(500)));
  });

  it('identifies a Linked Contribution by its source income Transaction and Account', () => {
    const source: Transaction = {
      id: 42,
      amount: 5000,
      direction: 'income',
      accountId: 8,
      transferToAccountId: null,
      date: new Date(2026, 8, 10, 9),
      categoryId: 2,
      generated: false,
      description: 'September salary',
      tags: [],
    };
    const { text } = setup({
      list: () => of([contribution({ transactionId: 42 })]),
      transactions: () => of([source]),
    });

    expect(text()).toContain('Linked from September salary');
    expect(text()).toContain('10 Sep 2026');
    expect(text()).toContain('Everyday cash');
  });

  it('uses the Add contribution invitation only for an empty active Goal', () => {
    const { text } = setup();
    expect(text()).toContain('No Contributions yet');
    expect(text()).toContain('Add the first Contribution');
    expect(text()).toContain('Add contribution');
  });

  it('shows a neutral empty history for a finished Goal', () => {
    const { text } = setup({ get: () => of({ ...GOAL, status: 'Completed' }) });
    expect(text()).toContain('No Contributions');
    expect(text()).not.toContain('Add contribution');
  });

  it('keeps linked history deletable for a Completed Goal and retired Account, then refreshes its source capacity', () => {
    const item = contribution({ transactionId: 42 });
    const list = vi
      .fn()
      .mockReturnValueOnce(of([item]))
      .mockReturnValueOnce(of([]));
    const remove = vi.fn(() => of(undefined));
    const linked = vi.fn(() =>
      of({
        transactionId: 42,
        transactionAmount: 1200,
        linkedTotal: 0,
        remainingCapacity: 1200,
        account: {
          id: 8,
          name: 'Everyday cash',
          currentBalance: 50000,
          earmarkedTotal: 0,
          availableHeadroom: 50000,
          active: false,
        },
        linkedContributions: [],
      }),
    );
    const { fixture, cmp, text } = setup({
      get: () => of({ ...GOAL, status: 'Completed' }),
      list,
      accounts: () => of([{ ...ACCOUNT, isActive: false }]),
      transactions: () =>
        of([
          {
            id: 42,
            amount: 1200,
            direction: 'income',
            accountId: 8,
            transferToAccountId: null,
            date: new Date(2026, 8, 10),
            categoryId: 2,
            generated: false,
            description: 'Salary',
            tags: [],
          },
        ]),
      linked: linked as unknown as TransactionsService['linkedContributions'],
      deleteContribution: remove,
    });

    expect(text()).toContain('Linked from Salary');
    expect(text()).toContain('Completed');
    const displayed = cmp.history()![0];
    cmp.askContributionDelete(displayed);
    cmp.confirmContributionDelete();
    fixture.detectChanges();

    expect(remove).toHaveBeenCalledWith(item.id);
    expect(linked).toHaveBeenCalledWith(42);
    expect(cmp.history()).toEqual([]);
    expect(text()).toContain('Completed');
  });

  it('keeps an ordinary Contribution visible and pending until 204, then refreshes Goal progress and Account headroom', () => {
    const item = contribution();
    const list = vi
      .fn()
      .mockReturnValueOnce(of([item]))
      .mockReturnValueOnce(of([]));
    const pending = new Subject<void>();
    const remove = vi.fn(() => pending.asObservable());
    const accounts = vi.fn(() => of([ACCOUNT]));
    const { fixture, cmp } = setup({
      list,
      accounts,
      deleteContribution: remove,
    });

    cmp.askContributionDelete(cmp.history()![0]);
    cmp.confirmContributionDelete();
    fixture.detectChanges();
    expect(cmp.deletingContributionId()).toBe(item.id);
    expect(cmp.history()).toHaveLength(1);

    pending.next();
    pending.complete();
    fixture.detectChanges();

    expect(remove).toHaveBeenCalledWith(item.id);
    expect(cmp.deletingContributionId()).toBeNull();
    expect(cmp.history()).toEqual([]);
    expect(accounts).toHaveBeenCalledTimes(2);
  });

  it('treats an initial deletion 404 as stale history and refreshes the ordinary row away', () => {
    const item = contribution();
    const list = vi
      .fn()
      .mockReturnValueOnce(of([item]))
      .mockReturnValueOnce(of([]));
    const { fixture, cmp } = setup({
      list,
      deleteContribution: () => throwError(() => new ApiError('Missing', 404)),
    });

    cmp.askContributionDelete(cmp.history()![0]);
    cmp.confirmContributionDelete();
    fixture.detectChanges();

    expect(cmp.history()).toEqual([]);
  });

  it('short-circuits an invalid id to not-found without making requests', () => {
    const get = vi.fn(() => of(GOAL));
    const list = vi.fn(() => of<GoalContribution[]>([]));
    const accounts = vi.fn(() => of([ACCOUNT]));
    const { text } = setup({ get, list, accounts, id: '0' });
    expect(get).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
    expect(accounts).not.toHaveBeenCalled();
    expect(text()).toContain('Back to goals');
  });

  it('offers retry for a failed read but points a missing Goal back to Goals', () => {
    const failed = setup({ get: () => throwError(() => new ApiError('Unavailable', 500)) });
    expect(failed.text()).toContain('Unavailable');
    expect(failed.text()).toContain('Try again');

    TestBed.resetTestingModule();
    const missing = setup({ get: () => throwError(() => new ApiError('Gone', 404)) });
    expect(missing.text()).toContain('Gone');
    expect(missing.text()).toContain('Back to goals');
    expect(missing.text()).not.toContain('Try again');
  });
});
