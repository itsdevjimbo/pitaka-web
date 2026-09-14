import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  MATERIAL_ANIMATIONS,
  provideNativeDateAdapter,
} from '@angular/material/core';
import { provideRouter } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { provideIcons } from '@/app/core/icons';
import { formatPeso } from '@/app/core/money';
import { Account, AccountsService } from '@/app/domains/app/accounts';
import {
  Goal,
  GoalContribution,
  GoalContributionsService,
  GoalsService,
} from '../../index';
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
  function setup(over: {
    get?: GoalsService['get'];
    list?: GoalContributionsService['list'];
    accounts?: AccountsService['all'];
    id?: string;
  } = {}) {
    const get = over.get ?? (() => of(GOAL));
    const list = over.list ?? (() => of<GoalContribution[]>([]));
    const accounts = over.accounts ?? (() => of([ACCOUNT]));

    TestBed.configureTestingModule({
      imports: [GoalDetail],
      providers: [
        provideIcons(),
        provideNativeDateAdapter(),
        provideRouter([]),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        { provide: GoalsService, useValue: { get } },
        { provide: GoalContributionsService, useValue: { list } },
        { provide: AccountsService, useValue: { all: accounts } },
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
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('[aria-label="Contribution actions"]').length).toBe(3);
    expect(body.indexOf(formatPeso(900))).toBeLessThan(body.indexOf(formatPeso(800)));
    expect(body.indexOf(formatPeso(800))).toBeLessThan(body.indexOf(formatPeso(500)));
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
