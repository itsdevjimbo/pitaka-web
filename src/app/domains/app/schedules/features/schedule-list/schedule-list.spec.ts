import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { provideIcons } from '@/app/core/icons';
import { Account, AccountsService } from '@/app/domains/app/accounts';
import { CategoriesService, Category } from '@/app/domains/app/categories';
import { Schedule } from '../../data/schedule';
import { SchedulesService } from '../../data/schedules.service';
import ScheduleList from './schedule-list';

const ACCOUNTS: Account[] = [
  { id: 1, name: 'BPI Savings', type: 'Bank', currentBalance: 0, isActive: true },
  { id: 2, name: 'Old GCash', type: 'Wallet', currentBalance: 0, isActive: false },
];
const CATEGORIES: Category[] = [
  { id: 10, name: 'Salary', kind: 'income', isActive: true, isDefault: false },
  { id: 11, name: 'Housing', kind: 'expense', isActive: false, isDefault: false },
];

function schedule(over: Partial<Schedule>): Schedule {
  return {
    id: 1,
    accountId: 1,
    categoryId: 10,
    name: 'Salary',
    direction: 'income',
    amount: 82000,
    frequency: 'monthly',
    firstGeneration: new Date(2026, 0, 15),
    lastGeneration: null,
    nextGeneration: new Date(2026, 9, 15),
    status: 'active',
    generatedTransactionCount: 14,
    canDelete: false,
    ...over,
  };
}

const ALL: Schedule[] = [
  schedule({ id: 1, name: 'Later salary', nextGeneration: new Date(2026, 9, 15) }),
  schedule({ id: 2, name: 'Sooner salary', nextGeneration: new Date(2026, 8, 15) }),
  schedule({ id: 3, name: 'Gym', status: 'paused', direction: 'expense', amount: 2200 }),
  schedule({ id: 4, name: 'Retainer', status: 'completed', generatedTransactionCount: 12 }),
  schedule({ id: 5, name: 'Old plan', status: 'cancelled', generatedTransactionCount: 4 }),
];

describe('ScheduleList', () => {
  function setup(list: SchedulesService['list']) {
    TestBed.configureTestingModule({
      imports: [ScheduleList],
      providers: [
        provideRouter([]),
        provideIcons(),
        { provide: SchedulesService, useValue: { list } },
        { provide: AccountsService, useValue: { all: () => of(ACCOUNTS) } },
        { provide: CategoriesService, useValue: { all: () => of(CATEGORIES) } },
      ],
    });
    const fixture = TestBed.createComponent(ScheduleList);
    fixture.detectChanges();
    return {
      fixture,
      text: () => (fixture.nativeElement as HTMLElement).textContent ?? '',
    };
  }

  function click(fixture: ComponentFixture<ScheduleList>, label: string) {
    const button = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')).find((candidate) =>
      (candidate.textContent ?? '').includes(label),
    );
    if (!button) throw new Error(`No button labelled "${label}"`);
    button.click();
    fixture.detectChanges();
  }

  it('renders skeleton cards while the initial collections are loading', () => {
    const pending = new Subject<Schedule[]>();
    const { fixture, text } = setup(() => pending);

    expect(text()).toContain('Loading Schedules');
    expect(fixture.nativeElement.querySelectorAll('[data-schedule-skeleton]').length).toBe(3);
  });

  it('shows Active Schedules by next generation with their card facts', () => {
    const { text } = setup(() => of(ALL));

    expect(text().indexOf('Sooner salary')).toBeLessThan(text().indexOf('Later salary'));
    expect(text()).toContain('Next generation: 15 Sep 2026');
    expect(text()).toContain('Income');
    expect(text()).toContain('₱82,000.00');
    expect(text()).toContain('Monthly');
    expect(text()).toContain('BPI Savings');
    expect(text()).toContain('Salary');
    expect(text()).toContain('14 surviving generated Transactions');
  });

  it('switches among Upcoming, Paused, and Past with truthful lifecycle timing', () => {
    const { fixture, text } = setup(() => of(ALL));

    click(fixture, 'Paused');
    expect(text()).toContain('Gym');
    expect(text()).toContain('Generation paused');
    expect(text()).not.toContain('Next generation:');

    click(fixture, 'Past');
    expect(text()).toContain('Retainer');
    expect(text()).toContain('Completed');
    expect(text()).toContain('Old plan');
    expect(text()).toContain('Cancelled');
    expect(text()).not.toContain('Next generation:');
  });

  it('warns about a retired Account and labels a retired Category', () => {
    const retired = schedule({ accountId: 2, categoryId: 11, direction: 'expense' });
    const { text } = setup(() => of([retired]));

    expect(text()).toContain('Old GCash');
    expect(text()).toContain('Housing');
    expect(text()).toContain('Retired');
    expect(text()).toContain('This Account is retired. Generation is blocked.');
    expect(text()).toContain('Reactivating the Account resumes generation and may create one overdue Transaction.');
    expect(text()).not.toContain('Next generation:');
  });

  it('shows the initial failure wording and retries', () => {
    const attempts = new BehaviorSubject(0);
    const list = vi.fn(() => {
      const attempt = attempts.value;
      attempts.next(attempt + 1);
      return attempt === 0 ? throwError(() => new ApiError('Offline', 0)) : of(ALL);
    });
    const { fixture, text } = setup(list);

    expect(text()).toContain('Schedules couldn’t be loaded');
    click(fixture, 'Retry');
    expect(text()).toContain('Sooner salary');
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('retains cards after a refresh failure and clears stale state after recovery', () => {
    const list = vi
      .fn()
      .mockReturnValueOnce(of(ALL))
      .mockReturnValueOnce(throwError(() => new ApiError('Offline', 0)))
      .mockReturnValueOnce(of([ALL[1]]));
    const { fixture, text } = setup(list as SchedulesService['list']);

    click(fixture, 'Refresh');
    expect(text()).toContain('Sooner salary');
    expect(text()).toContain('Schedules couldn’t be refreshed. Shown information may be out of date.');

    click(fixture, 'Retry');
    expect(text()).toContain('Sooner salary');
    expect(text()).not.toContain('may be out of date');
  });

  it.each([
    ['Paused', 'No paused Schedules'],
    ['Past', 'No past Schedules'],
  ])('shows the %s view empty state while retaining navigation', (view, message) => {
    const { fixture, text } = setup(() => of([ALL[0]]));

    click(fixture, view);
    expect(text()).toContain(message);
    expect(text()).toContain('Upcoming');
    expect(text()).toContain('Paused');
    expect(text()).toContain('Past');
  });

  it('shows the all-empty state without dead create or history controls', () => {
    const { fixture, text } = setup(() => of([]));

    expect(text()).toContain('No Schedules yet');
    expect(fixture.nativeElement.querySelector('a')).toBeNull();
    expect(text()).not.toContain('Create Schedule');
    expect(text()).not.toContain('New Schedule');
  });
});
