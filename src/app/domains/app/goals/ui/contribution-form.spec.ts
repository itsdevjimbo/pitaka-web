import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS, provideNativeDateAdapter } from '@angular/material/core';
import { of } from 'rxjs';
import { provideIcons } from '@/app/core/icons';
import { AccountsService } from '@/app/domains/app/accounts';
import { GoalContributionWithAccountName } from '../data/contribution-account-name';
import { Goal } from '../data/goal';
import { GoalContributionsService } from '../data/goal-contributions.service';
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
  it.each([
    ['ordinary', { ...CONTRIBUTION, transactionId: null, source: { kind: 'ordinary' as const } }],
    ['linked', CONTRIBUTION],
  ])('shows an existing %s date as settled and sends only the corrected note', async (_kind, contribution) => {
    const update = vi.fn(() => of({ ...contribution, note: 'Revised' }));
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
});
