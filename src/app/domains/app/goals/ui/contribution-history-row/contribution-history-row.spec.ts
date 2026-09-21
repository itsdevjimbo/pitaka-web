import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS, provideNativeDateAdapter } from '@angular/material/core';
import { provideIcons } from '@/app/core/icons';
import { formatPeso } from '@/app/core/money';
import { GoalContributionWithAccountName } from '../../data/contributions/contribution-account-name';
import { ContributionHistoryRow } from './contribution-history-row';

const CONTRIBUTION: GoalContributionWithAccountName = {
  id: 1,
  goalId: 3,
  accountId: 8,
  transactionId: null,
  amount: 1200,
  contributionDate: new Date(2026, 8, 12),
  note: 'First earmark',
  accountName: 'Everyday cash',
  source: { kind: 'ordinary' },
};

describe('ContributionHistoryRow', () => {
  function setup(
    contribution: GoalContributionWithAccountName = CONTRIBUTION,
  ): ComponentFixture<ContributionHistoryRow> {
    TestBed.configureTestingModule({
      imports: [ContributionHistoryRow],
      providers: [
        provideIcons(),
        provideNativeDateAdapter(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });

    const fixture = TestBed.createComponent(ContributionHistoryRow);
    fixture.componentRef.setInput('contribution', contribution);
    fixture.detectChanges();
    return fixture;
  }

  it('shows the Contribution details and row actions', () => {
    const element = setup().nativeElement as HTMLElement;

    expect(element.textContent).toContain(formatPeso(1200));
    expect(element.textContent).toContain('12 Sep 2026 · Everyday cash');
    expect(element.textContent).toContain('First earmark');
    expect(element.querySelector('[aria-label="Contribution actions"]')).not.toBeNull();
  });

  it('names an unresolved Account and omits an absent note', () => {
    const element = setup({ ...CONTRIBUTION, accountName: '', note: null }).nativeElement as HTMLElement;

    expect(element.textContent).toContain('Unknown account');
    expect(element.textContent).not.toContain('First earmark');
  });
});
