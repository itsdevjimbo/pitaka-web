import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS, provideNativeDateAdapter } from '@angular/material/core';
import { MatSelectHarness } from '@angular/material/select/testing';
import { of, Subject, throwError } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { provideIcons } from '@/app/core/icons';
import { Account, AccountsService } from '@/app/domains/app/accounts';
import { GoalContributionWithAccountName } from '../../data/contributions/contribution-account-name';
import { GoalContributionsService } from '../../data/contributions/goal-contributions.service';
import { Goal } from '../../data/goal';
import { GoalContributionUnavailableError } from '../../data/goal-errors';
import { ContributionForm } from './contribution-form';

const GOAL: Goal = {
  id: 3,
  name: 'Dental work',
  targetAmount: 30000,
  targetDate: null,
  status: 'Active',
  currentAmount: 1200,
};

const ACCOUNT: Account = {
  id: 8,
  name: 'Everyday cash',
  type: 'Cash',
  currentBalance: 500,
  isActive: true,
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
  async function setupNew(create: GoalContributionsService['create']) {
    TestBed.configureTestingModule({
      imports: [ContributionForm],
      providers: [
        provideIcons(),
        provideNativeDateAdapter(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        { provide: AccountsService, useValue: { all: () => of([ACCOUNT]) } },
        { provide: GoalContributionsService, useValue: { all: () => of([]), create } },
      ],
    });
    const fixture = TestBed.createComponent(ContributionForm);
    fixture.componentRef.setInput('goal', GOAL);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

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

  it.each([403, 404])('reports an unavailable existing Contribution after a %s write failure', async (status) => {
    const update = vi.fn<GoalContributionsService['update']>(() =>
      throwError(() => new GoalContributionUnavailableError(new ApiError('Unavailable', status))),
    );
    const fixture = setupExisting(update);
    const unavailable: string[] = [];
    fixture.componentInstance.unavailable.subscribe((reason) => unavailable.push(reason));
    const note = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    note.value = 'Revised';
    note.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    await fixture.whenStable();

    expect(update).toHaveBeenCalledWith(9, { note: 'Revised' });
    expect(unavailable).toEqual(['missing']);
    expect(fixture.nativeElement.textContent).not.toContain('Unavailable');
  });

  it('keeps a create form open and its values after a body-reference 404', async () => {
    const create = vi.fn<GoalContributionsService['create']>(() =>
      throwError(() => new ApiError("We couldn't find that. It may have been deleted, or it may not be yours.", 404)),
    );
    const fixture = await setupNew(create);
    const host = fixture.nativeElement as HTMLElement;
    const unavailable: string[] = [];
    fixture.componentInstance.unavailable.subscribe((reason) => unavailable.push(reason));

    const account = await TestbedHarnessEnvironment.loader(fixture).getHarness(MatSelectHarness);
    await account.open();
    await (await account.getOptions())[0].click();
    const amount = host.querySelector<HTMLInputElement>('input[type="number"]');
    const inputs = host.querySelectorAll<HTMLInputElement>('input');
    const note = inputs.item(inputs.length - 1);
    if (!amount || !note) {
      throw new Error('Expected the Contribution amount and note fields');
    }
    amount.value = '100';
    amount.dispatchEvent(new Event('input'));
    note.value = 'Keep this draft';
    note.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    (host.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(create).toHaveBeenCalledOnce();
    expect(unavailable).toEqual([]);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("We couldn't find that.");
    expect(amount.value).toBe('100');
    expect(note.value).toBe('Keep this draft');
  });
});
