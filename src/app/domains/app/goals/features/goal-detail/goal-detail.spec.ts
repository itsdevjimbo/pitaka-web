import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS, provideNativeDateAdapter } from '@angular/material/core';
import { provideRouter } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { provideIcons } from '@/app/core/icons';
import { formatPeso } from '@/app/core/money';
import { Account, AccountsService } from '@/app/domains/app/accounts';
import { Transaction, TransactionsService } from '@/app/domains/app/transactions';
import { withOverlayContainer } from '@/testing/overlay';
import { GoalContribution } from '../../data/contributions/goal-contribution';
import { GoalContributionsService } from '../../data/contributions/goal-contributions.service';
import { Goal } from '../../data/goal';
import { GoalsService } from '../../data/goals.service';
import GoalDetail from './goal-detail';

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
  const overlay = withOverlayContainer();
  function setup(
    over: {
      get?: GoalsService['get'];
      list?: GoalContributionsService['list'];
      accounts?: AccountsService['all'];
      transactions?: TransactionsService['list'];
      linked?: TransactionsService['linkedContributions'];
      allContributions?: GoalContributionsService['all'];
      deleteContribution?: GoalContributionsService['delete'];
      setStatus?: GoalsService['setStatus'];
      id?: string;
    } = {},
  ) {
    const get = over.get ?? (() => of(GOAL));
    const list = over.list ?? (() => of<GoalContribution[]>([]));
    const accounts = over.accounts ?? (() => of([ACCOUNT]));
    const transactions = over.transactions ?? (() => of<Transaction[]>([]));
    const linked = over.linked ?? (() => of({} as never));
    const allContributions = over.allContributions ?? (() => of<GoalContribution[]>([]));
    const deleteContribution = over.deleteContribution ?? (() => of(undefined));
    const setStatus = over.setStatus ?? (() => of(GOAL));

    TestBed.configureTestingModule({
      imports: [GoalDetail],
      providers: [
        provideIcons(),
        provideNativeDateAdapter(),
        provideRouter([]),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        { provide: GoalsService, useValue: { get, setStatus } },
        { provide: GoalContributionsService, useValue: { list, all: allContributions, delete: deleteContribution } },
        { provide: AccountsService, useValue: { all: accounts } },
        { provide: TransactionsService, useValue: { list: transactions, linkedContributions: linked } },
      ],
    });

    const fixture = TestBed.createComponent(GoalDetail);
    fixture.componentRef.setInput('id', over.id ?? '3');
    fixture.detectChanges();
    return {
      fixture,
      text: () => (fixture.nativeElement as HTMLElement).textContent ?? '',
    };
  }

  async function settle(fixture: ComponentFixture<GoalDetail>) {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function openGoalMenu(fixture: ComponentFixture<GoalDetail>) {
    const action = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      '[aria-label="Goal actions"]',
    );
    if (!action) {
      throw new Error('No Goal actions button');
    }
    action.click();
    await settle(fixture);
  }

  function goalMenuButton(label: string): HTMLButtonElement {
    const button = Array.from(overlay().querySelectorAll<HTMLButtonElement>('button')).find(
      (candidate) => candidate.textContent?.trim() === label,
    );
    if (!button) {
      throw new Error(`No ${label} Goal menu item`);
    }
    return button;
  }

  async function askToDeleteContribution(fixture: ComponentFixture<GoalDetail>) {
    const action = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      '[aria-label="Contribution actions"]',
    );
    if (!action) {
      throw new Error('No Contribution actions button');
    }
    action.click();
    await settle(fixture);
    const menuDelete = Array.from(overlay().querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Delete contribution',
    );
    if (!menuDelete) {
      throw new Error('No Contribution Delete menu item');
    }
    menuDelete.click();
    await settle(fixture);
  }

  async function confirmContributionDelete(fixture: ComponentFixture<GoalDetail>) {
    const dialog = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('[role="alertdialog"]');
    const confirm = Array.from(dialog?.querySelectorAll('button') ?? []).find(
      (button) => button.textContent?.trim() === 'Delete',
    );
    if (!confirm) {
      throw new Error('No Contribution delete confirmation');
    }
    confirm.click();
    await settle(fixture);
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
    expect(body).toContain(formatPeso(18000));
    expect(body).toContain(formatPeso(30000));
    expect(body).toContain('1 Mar 2026');
    expect(body).toContain('%');
    expect(body).toContain('In progress');
    expect(body).toContain('Target overdue');
    expect(body).toContain('Everyday cash');
    expect(body).toContain('Payday');
    expect((fixture.nativeElement as HTMLElement).querySelector('[aria-label="Goal actions"]')).not.toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('[aria-label="Contribution actions"]').length).toBe(
      3,
    );
    expect(body.indexOf(formatPeso(900))).toBeLessThan(body.indexOf(formatPeso(800)));
    expect(body.indexOf(formatPeso(800))).toBeLessThan(body.indexOf(formatPeso(500)));
  });

  it('keeps editing and eligible completion in the Goal actions menu', async () => {
    const { fixture } = setup({ get: () => of({ ...GOAL, currentAmount: GOAL.targetAmount }) });
    const header = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('[data-goal-page-header]');
    if (!header) {
      throw new Error('No Goal page header');
    }

    expect(header.textContent).not.toContain('Edit goal');
    expect(header.textContent).not.toContain('Mark complete');

    await openGoalMenu(fixture);

    expect(goalMenuButton('Edit goal')).toBeTruthy();
    expect(goalMenuButton('Mark complete')).toBeTruthy();
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

  it('shows a neutral empty history for a Completed Goal', () => {
    const { text } = setup({ get: () => of({ ...GOAL, status: 'Completed' }) });
    expect(text()).toContain('No Contributions');
    expect(text()).not.toContain('Add contribution');
  });

  it.each(['Completed', 'Abandoned'] as const)(
    'keeps linked history deletable for an %s Goal and retired Account, then refreshes its source capacity',
    async (status) => {
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
      const { fixture, text } = setup({
        get: () => of({ ...GOAL, status }),
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
      expect(text()).toContain(status);
      await askToDeleteContribution(fixture);
      await confirmContributionDelete(fixture);

      expect(remove).toHaveBeenCalledWith(item.id);
      expect(linked).toHaveBeenCalledWith(42);
      expect(text()).toContain('No Contributions');
      expect(text()).toContain(status);
    },
  );

  it('keeps an ordinary Contribution visible and pending until 204, then refreshes Goal progress and Account headroom', async () => {
    const item = contribution();
    const list = vi
      .fn()
      .mockReturnValueOnce(of([item]))
      .mockReturnValueOnce(of([]));
    const pending = new Subject<void>();
    const remove = vi.fn(() => pending.asObservable());
    const accounts = vi.fn(() => of([ACCOUNT]));
    const allContributions = vi.fn(() => of([contribution({ id: 2, amount: 51000 })]));
    const { fixture, text } = setup({
      list,
      accounts,
      allContributions,
      deleteContribution: remove,
    });

    await askToDeleteContribution(fixture);
    const confirm = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('[role="alertdialog"]')!;
    Array.from(confirm.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Delete')!
      .click();
    fixture.detectChanges();
    expect(text()).toContain('Deleting…');
    expect(text()).toContain(formatPeso(item.amount));

    pending.next();
    pending.complete();
    await settle(fixture);

    expect(remove).toHaveBeenCalledWith(item.id);
    expect(text()).toContain('No Contributions yet');
    expect(text()).toContain('Contribution deleted.');
    expect(accounts).toHaveBeenCalledTimes(2);
    expect(allContributions).toHaveBeenCalledOnce();
    expect(text()).toContain(`${formatPeso(-1000)} remains available in ${ACCOUNT.name}`);
    expect((fixture.nativeElement as HTMLElement).ownerDocument.activeElement?.id).toBe('contributions-heading');
  });

  it('treats an initial deletion 404 as stale history and refreshes the ordinary row away', async () => {
    const item = contribution();
    const list = vi
      .fn()
      .mockReturnValueOnce(of([item]))
      .mockReturnValueOnce(of([]));
    const { fixture, text } = setup({
      list,
      deleteContribution: () => throwError(() => new ApiError('Missing', 404)),
    });

    await askToDeleteContribution(fixture);
    await confirmContributionDelete(fixture);

    expect(text()).toContain('No Contributions yet');
  });

  it('checks current facts after an ambiguous delete without replaying the write', async () => {
    const item = contribution();
    const list = vi
      .fn()
      .mockReturnValueOnce(of([item]))
      .mockReturnValueOnce(of([]));
    const remove = vi.fn(() => throwError(() => new ApiError('The request timed out.', 504)));
    const { fixture, text } = setup({ list, deleteContribution: remove });

    await askToDeleteContribution(fixture);
    await confirmContributionDelete(fixture);

    expect(text()).toContain(formatPeso(item.amount));
    expect(text()).toContain('The request timed out.');

    const retry = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Try again',
    );
    retry?.click();
    fixture.detectChanges();

    expect(remove).toHaveBeenCalledOnce();
    expect(list).toHaveBeenCalledTimes(2);
    expect(text()).toContain('No Contributions yet');
  });

  it('gates funding-dependent actions after a failed reread and restores them after Retry', async () => {
    const item = contribution();
    const reached = { ...GOAL, currentAmount: GOAL.targetAmount };
    const get = vi
      .fn<GoalsService['get']>()
      .mockReturnValueOnce(of(reached))
      .mockReturnValueOnce(throwError(() => new ApiError('Unavailable', 500)))
      .mockReturnValueOnce(of(reached));
    const list = vi
      .fn<GoalContributionsService['list']>()
      .mockReturnValueOnce(of([item]))
      .mockReturnValueOnce(of([]))
      .mockReturnValueOnce(of([]));
    const { fixture, text } = setup({ get, list });

    await askToDeleteContribution(fixture);
    await confirmContributionDelete(fixture);

    expect(text()).toContain('Saved, but couldn’t refresh');
    await openGoalMenu(fixture);
    expect(goalMenuButton('Mark complete').disabled).toBe(true);
    const staleAdd = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button'),
    ).find((button) => button.textContent?.includes('Add contribution'));
    expect(staleAdd?.disabled).toBe(true);

    Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.includes('Retry'))
      ?.click();
    await settle(fixture);

    expect(text()).not.toContain('Saved, but couldn’t refresh');
    expect(goalMenuButton('Mark complete').disabled).toBe(false);
    const freshAdd = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button'),
    ).find((button) => button.textContent?.includes('Add contribution'));
    expect(freshAdd?.disabled).toBe(false);
  });

  it('replaces a Goal that becomes unavailable during refresh with a return to Goals', async () => {
    const reached = { ...GOAL, currentAmount: GOAL.targetAmount };
    const get = vi
      .fn<GoalsService['get']>()
      .mockReturnValueOnce(of(reached))
      .mockReturnValueOnce(throwError(() => new ApiError('This Goal is no longer available.', 404)));
    const { fixture, text } = setup({ get, setStatus: () => of({ ...reached, status: 'Completed' }) });
    await openGoalMenu(fixture);

    goalMenuButton('Mark complete').click();
    await settle(fixture);

    expect(text()).toContain('This Goal is no longer available.');
    expect(text()).toContain('Back to goals');
    expect(text()).not.toContain('Edit goal');
  });

  it('prevents duplicate lifecycle submissions while a status write is pending', async () => {
    const pending = new Subject<Goal>();
    const setStatus = vi.fn(() => pending.asObservable());
    const { fixture } = setup({ get: () => of({ ...GOAL, currentAmount: GOAL.targetAmount }), setStatus });
    await openGoalMenu(fixture);

    goalMenuButton('Mark complete').click();
    fixture.detectChanges();
    const action = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      '[aria-label="Goal actions"]',
    );
    action?.click();
    await settle(fixture);

    expect(setStatus).toHaveBeenCalledOnce();
    expect(action?.disabled).toBe(true);
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

  it('keeps the latest Contribution refresh when an older detail refresh resolves later', async () => {
    const older = new Subject<Goal>();
    const newer = new Subject<Goal>();
    const get = vi
      .fn<GoalsService['get']>()
      .mockReturnValueOnce(of(GOAL))
      .mockReturnValueOnce(older.asObservable())
      .mockReturnValueOnce(newer.asObservable());
    const { fixture, text } = setup({ get });
    await settle(fixture);

    // The UI deliberately hides ordinary refresh; direct coordinator access proves a superseded read cannot win.
    const refresh = Reflect.get(fixture.componentInstance, 'refresh') as () => void;
    const refreshContributionFacts = Reflect.get(fixture.componentInstance, 'refreshContributionFacts') as () => void;
    refresh.call(fixture.componentInstance);
    refreshContributionFacts.call(fixture.componentInstance);

    newer.next({ ...GOAL, name: 'Fresh details' });
    newer.complete();
    await settle(fixture);
    older.next({ ...GOAL, name: 'Stale details' });
    older.complete();
    await settle(fixture);

    expect(text()).toContain('Fresh details');
    expect(text()).not.toContain('Stale details');
  });
});
