import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS, provideNativeDateAdapter } from '@angular/material/core';
import { of, Subject } from 'rxjs';
import { provideIcons } from '@/app/core/icons';
import { AccountsService } from '@/app/domains/app/accounts';
import { GoalContributionWithAccountName } from '../../data/contributions/contribution-account-name';
import { GoalContributionsService } from '../../data/contributions/goal-contributions.service';
import { Goal } from '../../data/goal';
import { ContributionForm } from './contribution-form';

const GOAL: Goal = {
  id: 3,
  name: 'Dental work',
  targetAmount: 30000,
  targetDate: null,
  status: 'Active',
  currentAmount: 1200,
};

const CONTRIBUTION: GoalContributionWithAccountName = {
  id: 9,
  goalId: 3,
  accountId: 8,
  transactionId: 42,
  amount: 1200,
  contributionDate: new Date(2026, 8, 12),
  note: 'Original',
  accountName: 'Everyday cash',
  source: { kind: 'linked', transactionId: 42, transaction: null },
};

describe('ContributionForm', () => {
  function setupExisting(update: GoalContributionsService['update']) {
    TestBed.configureTestingModule({
      imports: [ContributionForm],
      providers: [
        provideIcons(),
        provideNativeDateAdapter(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        { provide: AccountsService, useValue: { all: () => of([]) } },
        { provide: GoalContributionsService, useValue: { all: () => of([]), update } },
      ],
    });
    const fixture = TestBed.createComponent(ContributionForm);
    fixture.componentRef.setInput('goal', GOAL);
    fixture.componentRef.setInput('contribution', CONTRIBUTION);
    fixture.detectChanges();
    return fixture;
  }

  it.each([
    ['ordinary', { ...CONTRIBUTION, transactionId: null, source: { kind: 'ordinary' as const } }],
    ['linked', CONTRIBUTION],
  ])('shows an existing %s date as settled and sends only the corrected note', async (_kind, contribution) => {
    const update = vi.fn<GoalContributionsService['update']>(() => of({ ...contribution, note: 'Revised' }));
    TestBed.configureTestingModule({
      imports: [ContributionForm],
      providers: [
        provideIcons(),
        provideNativeDateAdapter(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        { provide: AccountsService, useValue: { all: () => of([]) } },
        {
          provide: GoalContributionsService,
          useValue: { all: () => of([]), update },
        },
      ],
    });
    const fixture = TestBed.createComponent(ContributionForm);
    fixture.componentRef.setInput('goal', GOAL);
    fixture.componentRef.setInput('contribution', contribution);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.textContent).toContain('Dated 12 Sep 2026');
    expect(host.textContent).toContain('delete this Contribution and add another');
    expect(host.textContent).not.toContain('Contribution date');
    expect(host.querySelectorAll('input').length).toBe(1);

    const note = host.querySelector('input') as HTMLInputElement;
    note.value = '  Revised  ';
    note.dispatchEvent(new Event('input'));
    (host.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    await fixture.whenStable();

    expect(update).toHaveBeenCalledWith(9, { note: 'Revised' });
  });

  it('releases a timed-out save and tells the person to refresh instead of retrying the Contribution', async () => {
    const inFlight = new Subject<GoalContributionWithAccountName>();
    const update = vi.fn<GoalContributionsService['update']>(() => inFlight.asObservable());
    const fixture = setupExisting(update);
    const pending: boolean[] = [];
    fixture.componentInstance.pendingChange.subscribe((value) => pending.push(value));
    const note = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    note.value = 'Revised';
    note.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    vi.useFakeTimers();
    try {
      (fixture.nativeElement.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
      await Promise.resolve();
      expect(pending).toEqual([true]);

      await vi.advanceTimersByTimeAsync(15_000);
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).toContain('couldn’t confirm whether this Contribution was saved');
      expect(pending).toEqual([true, false]);
      expect(update).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
