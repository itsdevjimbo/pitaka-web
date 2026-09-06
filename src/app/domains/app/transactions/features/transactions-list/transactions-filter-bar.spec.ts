import { ModelSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  MATERIAL_ANIMATIONS,
  provideNativeDateAdapter,
} from '@angular/material/core';
import { provideIcons } from '@/app/core/icons';
import { withOverlayContainer } from '@/testing/overlay';
import { TransactionCriteria } from '../../data/transaction';
import {
  FilterAccountOption,
  FilterCategoryOption,
  TransactionsFilterBar,
} from './transactions-filter-bar';

/** The slice of the component the tests drive — the same controls the template calls. */
type FilterBarInternals = {
  criteria: ModelSignal<TransactionCriteria>;
  activeCount: () => number;
  setDirection(value: string | null): void;
  setAccount(value: number | null): void;
  setCategory(value: number | null): void;
  setDateFrom(value: Date | null): void;
  setDateTo(value: Date | null): void;
  clear(): void;
};

const ACCOUNTS: FilterAccountOption[] = [
  { id: 3, name: 'Everyday cash', retired: false },
  { id: 9, name: 'Old wallet', retired: true },
];

const CATEGORIES: FilterCategoryOption[] = [
  { id: 1, name: 'Groceries' },
  { id: 2, name: 'Salary' },
];

describe('TransactionsFilterBar', () => {
  const overlay = withOverlayContainer();

  function setup(criteria: TransactionCriteria = {}) {
    TestBed.configureTestingModule({
      imports: [TransactionsFilterBar],
      providers: [
        provideIcons(),
        provideNativeDateAdapter(),
        {
          provide: MATERIAL_ANIMATIONS,
          useValue: { animationsDisabled: true },
        },
      ],
    });

    const fixture = TestBed.createComponent(TransactionsFilterBar);
    fixture.componentRef.setInput('accounts', ACCOUNTS);
    fixture.componentRef.setInput('categories', CATEGORIES);
    fixture.componentRef.setInput('criteria', criteria);
    fixture.detectChanges();

    const cmp = fixture.componentInstance as unknown as FilterBarInternals;
    const emitted: TransactionCriteria[] = [];
    cmp.criteria.subscribe((next) => emitted.push(next));

    /** Open one select by its aria-label and read the option labels from the overlay. */
    async function optionsOf(ariaLabel: string) {
      const trigger = (
        fixture.nativeElement as HTMLElement
      ).querySelector<HTMLElement>(`mat-select[aria-label="${ariaLabel}"]`);
      trigger!.click();
      fixture.detectChanges();
      await fixture.whenStable();
      return Array.from(overlay().querySelectorAll('mat-option')).map((o) =>
        (o.textContent ?? '').replace(/\s+/g, ' ').trim()
      );
    }

    return {
      fixture,
      cmp,
      emitted,
      optionsOf,
      text: () => (fixture.nativeElement as HTMLElement).textContent ?? '',
    };
  }

  it('offers an Account option per Account, retired ones marked', async () => {
    const { optionsOf } = setup();

    expect(await optionsOf('Filter by account')).toEqual([
      'Any account',
      'Everyday cash',
      'Old wallet · Retired',
    ]);
  });

  it('offers a flat Category option per Category', async () => {
    const { optionsOf } = setup();

    expect(await optionsOf('Filter by category')).toEqual([
      'Any category',
      'Groceries',
      'Salary',
    ]);
  });

  it('offers every direction plus an "Any" reset', async () => {
    const { optionsOf } = setup();

    expect(await optionsOf('Filter by direction')).toEqual([
      'Any direction',
      'Income',
      'Expense',
      'Transfer',
    ]);
  });

  it('folds a chosen direction into the criteria', () => {
    const { cmp, emitted } = setup();

    cmp.setDirection('expense');

    expect(emitted.at(-1)).toEqual({ direction: 'expense' });
  });

  it('combines the three axes, each independently', () => {
    const { cmp, emitted } = setup();

    cmp.setDirection('expense');
    cmp.setAccount(3);
    cmp.setCategory(1);

    expect(emitted.at(-1)).toEqual({
      direction: 'expense',
      accountId: 3,
      categoryId: 1,
    });
  });

  it('drops an axis key entirely when it is set back to "Any", never emitting undefined', () => {
    const { cmp, emitted } = setup({ direction: 'expense', accountId: 3 });

    cmp.setAccount(null);

    const last = emitted.at(-1)!;
    expect(last).toEqual({ direction: 'expense' });
    expect('accountId' in last).toBe(false);
  });

  describe('the date range (#65)', () => {
    it('folds a picked start and end into the criteria as the chosen calendar days', () => {
      const { cmp, emitted } = setup();

      cmp.setDateFrom(new Date(2026, 8, 1));
      cmp.setDateTo(new Date(2026, 8, 30));

      expect(emitted.at(-1)).toEqual({
        from: new Date(2026, 8, 1),
        to: new Date(2026, 8, 30),
      });
    });

    it('keeps each end independently optional', () => {
      const { cmp, emitted } = setup();

      cmp.setDateFrom(new Date(2026, 8, 1));

      expect(emitted.at(-1)).toEqual({ from: new Date(2026, 8, 1) });
      expect('to' in emitted.at(-1)!).toBe(false);
    });

    it('drops an end key entirely when it is cleared, never emitting undefined', () => {
      const { cmp, emitted } = setup({
        from: new Date(2026, 8, 1),
        to: new Date(2026, 8, 30),
      });

      cmp.setDateFrom(null);

      const last = emitted.at(-1)!;
      expect(last).toEqual({ to: new Date(2026, 8, 30) });
      expect('from' in last).toBe(false);
    });

    it('combines with the single-value axes', () => {
      const { cmp, emitted } = setup({ direction: 'expense', accountId: 3 });

      cmp.setDateFrom(new Date(2026, 8, 1));
      cmp.setDateTo(new Date(2026, 8, 30));

      expect(emitted.at(-1)).toEqual({
        direction: 'expense',
        accountId: 3,
        from: new Date(2026, 8, 1),
        to: new Date(2026, 8, 30),
      });
    });

    it('counts as a single active filter however many ends are set', () => {
      const { fixture, cmp } = setup();

      fixture.componentRef.setInput('criteria', { from: new Date(2026, 8, 1) });
      fixture.detectChanges();
      expect(cmp.activeCount()).toBe(1);

      fixture.componentRef.setInput('criteria', {
        from: new Date(2026, 8, 1),
        to: new Date(2026, 8, 30),
      });
      fixture.detectChanges();
      expect(cmp.activeCount()).toBe(1);
    });
  });

  it('clears every axis in one action', () => {
    const { cmp, emitted } = setup({
      direction: 'income',
      accountId: 9,
      categoryId: 2,
      from: new Date(2026, 8, 1),
      to: new Date(2026, 8, 30),
    });

    cmp.clear();

    expect(emitted.at(-1)).toEqual({});
  });

  it('summarises how many filters are active, and hides the summary when none are', () => {
    const { fixture, cmp, text } = setup();
    expect(text()).not.toContain('active');
    expect(text()).not.toContain('Clear filters');

    fixture.componentRef.setInput('criteria', { direction: 'expense' });
    fixture.detectChanges();
    expect(cmp.activeCount()).toBe(1);
    expect(text()).toContain('1 filter active');
    expect(text()).toContain('Clear filters');

    fixture.componentRef.setInput('criteria', {
      direction: 'expense',
      categoryId: 1,
      from: new Date(2026, 8, 1),
      to: new Date(2026, 8, 30),
    });
    fixture.detectChanges();
    // Two single-value axes plus the date range, counted once — three, not four.
    expect(text()).toContain('3 filters active');
  });

  it('reflects incoming criteria in the controls without re-emitting', () => {
    const { emitted } = setup({ accountId: 3 });

    // Binding a value in is not an edit — nothing goes back out.
    expect(emitted).toEqual([]);
  });
});
