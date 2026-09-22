import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { provideRouter } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { provideIcons } from '@/app/core/icons';
import { formatPeso } from '@/app/core/money';
import { withOverlayContainer } from '@/testing/overlay';
import { GoalContributionsService } from '../../data/contributions/goal-contributions.service';
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
  const overlay = withOverlayContainer();
  function setup(
    list: GoalsService['list'],
    over: {
      deleteGoal?: GoalsService['delete'];
      listContributions?: GoalContributionsService['list'];
    } = {},
  ) {
    TestBed.configureTestingModule({
      imports: [GoalList],
      providers: [
        provideIcons(),
        provideRouter([]),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        { provide: GoalsService, useValue: { list, delete: over.deleteGoal ?? (() => of(undefined)) } },
        {
          provide: GoalContributionsService,
          useValue: { list: over.listContributions ?? (() => of([])) },
        },
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

  it('shows loading, then selects one lifecycle collection at a time', async () => {
    const pending = new Subject<Goal[]>();
    const { fixture, text } = setup(() => pending.asObservable());
    expect(text()).toContain('Loading your goals…');

    pending.next([DENTAL, CAR, CAMERA]);
    pending.complete();
    await settle(fixture);

    const lifecycleButtons = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
        '[aria-label="Goal lifecycle"] button',
      ),
    );
    expect(lifecycleButtons.map((button) => button.textContent?.trim())).toEqual(['Active', 'Completed', 'Abandoned']);
    expect(lifecycleButtons.map((button) => button.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false']);
    expect(text()).toContain('1 Goal shown');
    expect(text()).toContain('Dental work');
    expect(text()).not.toContain('Car');
    expect(text()).not.toContain('Camera');

    lifecycleButtons[1]?.click();
    await settle(fixture);

    expect(lifecycleButtons.map((button) => button.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false']);
    expect(text()).toContain('Car');
    expect(text()).not.toContain('Dental work');
    expect(text()).not.toContain('Camera');

    lifecycleButtons[2]?.focus();
    lifecycleButtons[2]?.click();
    await settle(fixture);

    expect(lifecycleButtons.map((button) => button.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true']);
    expect(text()).toContain('Camera');
    expect(text()).not.toContain('Car');
    expect((fixture.nativeElement as HTMLElement).ownerDocument.activeElement).toBe(lifecycleButtons[2]);
  });

  it('shows the selected lifecycle empty state and preserves the selection across refresh', async () => {
    const list = vi.fn<GoalsService['list']>().mockReturnValue(of([DENTAL]));
    const { fixture, text } = setup(list);

    clickButton(fixture, 'Completed');
    await settle(fixture);

    expect(text()).toContain('0 Goals shown');
    expect(text()).toContain('No completed Goals yet.');
    expect(text()).not.toContain('Dental work');

    clickButton(fixture, 'Refresh');
    await settle(fixture);

    const completed = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
        '[aria-label="Goal lifecycle"] button',
      ),
    ).find((button) => button.textContent?.trim() === 'Completed');
    expect(completed?.getAttribute('aria-pressed')).toBe('true');
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
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('[data-goal-progress]').length).toBe(3);
  });

  it('renders the approved full-width continuous Goal ledger with separate amounts and a Contributions action', () => {
    const { fixture, text } = setup(() => of([DENTAL, HOLIDAY]));
    const element = fixture.nativeElement as HTMLElement;
    const ledger = element.querySelector<HTMLElement>('[data-goal-ledger]');

    expect(ledger).not.toBeNull();
    expect(ledger?.querySelectorAll(':scope > li')).toHaveLength(2);
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

  it('keeps loaded funding visible and gates completion when refresh fails, then Retry recovers', async () => {
    const list = vi
      .fn<GoalsService['list']>()
      .mockReturnValueOnce(of([EMERGENCY]))
      .mockReturnValueOnce(throwError(() => new ApiError('Unavailable', 500)))
      .mockReturnValueOnce(of([EMERGENCY]));
    const { fixture, text } = setup(list);

    clickButton(fixture, 'Refresh');
    await settle(fixture);

    expect(text()).toContain('Emergency fund');
    expect(text()).toContain('Couldn’t refresh. These figures may be out of date');
    expect(text()).toContain('Funding-based completion is unavailable until refreshed');

    const actions = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      '[aria-label="Actions for Emergency fund"]',
    );
    actions?.click();
    await settle(fixture);
    const staleComplete = Array.from(overlay().querySelectorAll<HTMLButtonElement>('button')).find((button) =>
      button.textContent?.includes('Mark complete'),
    );
    expect(staleComplete?.disabled).toBe(true);
    actions?.click();
    await settle(fixture);

    clickButton(fixture, 'Retry');
    await settle(fixture);

    expect(text()).not.toContain('Couldn’t refresh. These figures may be out of date');
    actions?.click();
    await settle(fixture);
    const freshComplete = Array.from(overlay().querySelectorAll<HTMLButtonElement>('button')).find((button) =>
      button.textContent?.includes('Mark complete'),
    );
    expect(freshComplete?.disabled).toBe(false);
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

  it('announces deletion and moves focus to the next Goal card', async () => {
    const list = vi
      .fn<GoalsService['list']>()
      .mockReturnValueOnce(of([DENTAL, HOLIDAY]))
      .mockReturnValueOnce(of([HOLIDAY]));
    const deleteGoal = vi.fn(() => of(undefined));
    const { fixture, text } = setup(list, { deleteGoal });
    const actions = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      '[aria-label="Actions for Dental work"]',
    );
    actions?.click();
    await settle(fixture);
    const menuDelete = Array.from(overlay().querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.trim() === 'Delete',
    );
    menuDelete?.click();
    await settle(fixture);
    const confirmation = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('[role="alertdialog"]');
    const confirmDelete = Array.from(confirmation?.querySelectorAll<HTMLButtonElement>('button') ?? []).find(
      (button) => button.textContent?.trim() === 'Delete',
    );
    confirmDelete?.click();
    await settle(fixture);

    expect(deleteGoal).toHaveBeenCalledWith(DENTAL.id);
    expect(text()).toContain('Goal deleted.');
    expect((fixture.nativeElement as HTMLElement).ownerDocument.activeElement?.textContent).toContain('Holiday');
  });
});
