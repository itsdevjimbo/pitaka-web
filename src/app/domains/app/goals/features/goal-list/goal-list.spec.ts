import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { provideRouter } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { provideIcons } from '@/app/core/icons';
import { formatPeso } from '@/app/core/money';
import { Goal } from '../../data/goal';
import { GoalsService } from '../../data/goals.service';
import GoalList from './goal-list';

const DENTAL: Goal = {
  id: 1,
  name: 'Dental work',
  targetAmount: 30000,
  targetDate: new Date(2026, 2, 1),
  status: 'Active',
  currentAmount: 18000,
};
const HOLIDAY: Goal = {
  id: 2,
  name: 'Holiday',
  targetAmount: 10000,
  targetDate: null,
  status: 'Active',
  currentAmount: 12000,
};
const EMERGENCY: Goal = {
  id: 3,
  name: 'Emergency fund',
  targetAmount: 20000,
  targetDate: new Date(2026, 8, 13),
  status: 'Active',
  currentAmount: 20000,
};
const CAR: Goal = {
  id: 4,
  name: 'Car',
  targetAmount: 50000,
  targetDate: new Date(2025, 11, 1),
  status: 'Completed',
  currentAmount: 50000,
};
const CAMERA: Goal = {
  id: 5,
  name: 'Camera',
  targetAmount: 40000,
  targetDate: new Date(2025, 11, 1),
  status: 'Abandoned',
  currentAmount: 5000,
};

describe('GoalList', () => {
  function setup(list: GoalsService['list']) {
    TestBed.configureTestingModule({
      imports: [GoalList],
      providers: [
        provideIcons(),
        provideRouter([]),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        { provide: GoalsService, useValue: { list } },
      ],
    });
    const fixture = TestBed.createComponent(GoalList);
    fixture.detectChanges();
    return { fixture, text: () => (fixture.nativeElement as HTMLElement).textContent ?? '' };
  }

  async function settle(fixture: ComponentFixture<GoalList>) {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function clickButton(fixture: ComponentFixture<GoalList>, label: string) {
    const button = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')).find((element) =>
      (element.textContent ?? '').includes(label),
    );
    if (!button) {
      throw new Error(`No button labelled "${label}"`);
    }
    button.click();
    fixture.detectChanges();
  }

  it('shows loading, then keeps Active, Completed and Abandoned sections visible', async () => {
    const pending = new Subject<Goal[]>();
    const { fixture, text } = setup(() => pending.asObservable());
    expect(text()).toContain('Loading your goals…');

    pending.next([CAR]);
    pending.complete();
    await settle(fixture);

    expect(text()).toContain('Active');
    expect(text()).toContain('No active Goals.');
    expect(text()).toContain('Completed');
    expect(text()).toContain('Car');
    expect(text()).toContain('Abandoned');
    expect(text()).toContain('No abandoned Goals.');
  });

  it('orders active Goals by target date then name, with undated Goals last', () => {
    const { text } = setup(() => of([HOLIDAY, DENTAL, EMERGENCY]));
    const body = text();
    expect(body.indexOf('Dental work')).toBeLessThan(body.indexOf('Emergency fund'));
    expect(body.indexOf('Emergency fund')).toBeLessThan(body.indexOf('Holiday'));
  });

  it('renders exact funding facts, percentages, badges, and an independent overdue warning', () => {
    const { fixture, text } = setup(() => of([DENTAL, HOLIDAY, EMERGENCY, CAR, CAMERA]));
    const body = text();
    expect(body).toContain(formatPeso(18000));
    expect(body).toContain(formatPeso(30000));
    expect(body).toContain(`${formatPeso(12000 - 10000)} excess`);
    expect(body).toContain('Over target');
    expect(body).toContain('In progress');
    expect(body).toContain('Target reached');
    expect(body).toContain('1 Mar 2026');
    expect(body).toContain('Target overdue');
    expect(body).toContain('%');
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('[data-goal-progress]').length).toBe(5);
  });

  it('renders the approved Goal cards with separate amounts and a Contributions action', () => {
    const { fixture, text } = setup(() => of([DENTAL, HOLIDAY]));
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelectorAll('[data-goal-card]')).toHaveLength(2);
    expect(text()).toContain('Contributed');
    expect(text()).toContain('Target');
    expect(text()).toContain('60% funded');
    expect(text()).toContain(`${formatPeso(12000)} to go`);

    const contributionLinks = Array.from(element.querySelectorAll<HTMLAnchorElement>('a')).filter((link) =>
      link.textContent?.includes('View Contributions'),
    );
    expect(contributionLinks).toHaveLength(2);
    expect(contributionLinks[0]?.getAttribute('href')).toBe('/app/goals/1');
  });

  it('uses an explanatory New goal card only when no Goals exist', () => {
    const { text } = setup(() => of([]));
    expect(text()).toContain('Start your first Goal');
    expect(text()).toContain('A Goal helps you build');
    expect(text()).not.toContain('No active Goals.');
  });

  it('renders a retryable list error', () => {
    const { text } = setup(() => throwError(() => new ApiError('Goals unavailable', 500)));
    expect(text()).toContain('Goals unavailable');
    expect(text()).toContain('Retry');
  });

  it('keeps loaded funding visible and gates writes when refresh fails, then Retry recovers', async () => {
    const list = vi
      .fn<GoalsService['list']>()
      .mockReturnValueOnce(of([DENTAL]))
      .mockReturnValueOnce(throwError(() => new ApiError('Unavailable', 500)))
      .mockReturnValueOnce(of([HOLIDAY]));
    const { fixture, text } = setup(list);

    clickButton(fixture, 'Refresh');
    await settle(fixture);

    expect(text()).toContain('Dental work');
    expect(text()).toContain('Couldn’t refresh. These figures may be out of date');
    expect(text()).toContain('Funding-based completion is unavailable until refreshed');

    clickButton(fixture, 'Retry');
    await settle(fixture);

    expect(text()).toContain('Holiday');
    expect(text()).not.toContain('Couldn’t refresh. These figures may be out of date');
  });

  it('keeps the newest refresh when an older Goal read resolves later', async () => {
    const older = new Subject<Goal[]>();
    const newer = new Subject<Goal[]>();
    const list = vi
      .fn<GoalsService['list']>()
      .mockReturnValueOnce(of([DENTAL]))
      .mockReturnValueOnce(older.asObservable())
      .mockReturnValueOnce(newer.asObservable());
    const { fixture, text } = setup(list);

    clickButton(fixture, 'Refresh');
    clickButton(fixture, 'Refresh');
    newer.next([HOLIDAY]);
    newer.complete();
    await settle(fixture);
    older.next([DENTAL]);
    older.complete();
    await settle(fixture);

    expect(text()).toContain('Holiday');
    expect(text()).not.toContain('Dental work');
  });
});
