import { OutputEmitterRef, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FieldTree } from '@angular/forms/signals';
import { provideNativeDateAdapter } from '@angular/material/core';
import { of, Subject, throwError } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { provideIcons } from '@/app/core/icons';
import { CategoriesService } from '@/app/domains/app/categories/categories.service';
import { Category } from '@/app/domains/app/categories/category';
import { withPinnedTimezone } from '@/testing/timezone';
import { AdjustBudget, Budget, BUDGET_NAME_MAX, Period } from '../data/budget';
import { BudgetsService } from '../data/budgets.service';
import { AdjustBudgetForm } from './adjust-budget-form';

type Model = {
  name: string;
  amountLimit: number | null;
  period: Period;
  startDate: Date | null;
  categoryId: number | null;
};

/** The slice of the component the tests reach into. */
type AdjustBudgetInternals = {
  model: WritableSignal<Model>;
  budgetForm: {
    name: FieldTree<string>;
    amountLimit: FieldTree<number | null>;
    period: FieldTree<Period>;
    startDate: FieldTree<Date | null>;
    categoryId: FieldTree<number | null>;
  };
  categoryOptions: () => Category[];
  errorMessage: () => string | null;
  adjusted: OutputEmitterRef<Budget>;
  cancelled: OutputEmitterRef<void>;
  save(event: Event): void;
  cancel(): void;
};

const COULD_NOT_ADJUST =
  'Something went wrong adjusting your budget. Please try again.';

const CATEGORIES: Category[] = [
  { id: 1, name: 'Groceries', kind: 'expense', isActive: true },
  { id: 2, name: 'Salary', kind: 'income', isActive: true },
  { id: 3, name: 'Rent', kind: 'expense', isActive: true },
];

/** The Budget under the form: a live monthly Groceries Budget on Category 1. */
const BUDGET: Budget = {
  id: 12,
  name: 'Groceries',
  amountLimit: 20000,
  period: 'monthly',
  startDate: new Date(2026, 7, 1),
  endDate: null,
  categoryId: 1,
};

const ADJUSTED: Budget = { ...BUDGET, amountLimit: 25000 };

describe('AdjustBudgetForm', () => {
  // Dates are compared as calendar days; pin a negative-offset zone so a
  // `DateOnly` never parses to the day before.
  const pinTimezone = withPinnedTimezone();
  beforeEach(() => pinTimezone('America/New_York'));

  function setup(
    adjust: BudgetsService['adjust'],
    budget: Budget = BUDGET,
    list: CategoriesService['list'] = () => of(CATEGORIES)
  ) {
    TestBed.configureTestingModule({
      imports: [AdjustBudgetForm],
      providers: [
        provideIcons(),
        provideNativeDateAdapter(),
        { provide: BudgetsService, useValue: { adjust } },
        { provide: CategoriesService, useValue: { list } },
      ],
    });

    const fixture = TestBed.createComponent(AdjustBudgetForm);
    fixture.componentRef.setInput('budget', budget);
    const cmp = fixture.componentInstance as unknown as AdjustBudgetInternals;
    fixture.detectChanges();
    return { fixture, cmp };
  }

  async function submitAndSettle(
    fixture: { whenStable: () => Promise<unknown> },
    cmp: AdjustBudgetInternals
  ) {
    cmp.save(new Event('submit'));
    await fixture.whenStable();
    await fixture.whenStable();
  }

  function messagesOn(field: FieldTree<unknown>) {
    return field()
      .errors()
      .map((error) => error.message);
  }

  it('prefills every control from the Budget', () => {
    const { cmp } = setup(vi.fn());

    expect(cmp.model()).toEqual({
      name: BUDGET.name,
      amountLimit: BUDGET.amountLimit,
      period: BUDGET.period,
      startDate: BUDGET.startDate,
      categoryId: BUDGET.categoryId,
    });
  });

  it('blocks a submission once the name is cleared and never calls the service', async () => {
    const adjust = vi.fn();
    const { fixture, cmp } = setup(
      adjust as unknown as BudgetsService['adjust']
    );

    cmp.model.update((m) => ({ ...m, name: '' }));
    await submitAndSettle(fixture, cmp);

    expect(messagesOn(cmp.budgetForm.name)).toContain('You must enter a name');
    expect(adjust).not.toHaveBeenCalled();
  });

  it('blocks a submission once the amount is cleared', async () => {
    const adjust = vi.fn();
    const { fixture, cmp } = setup(
      adjust as unknown as BudgetsService['adjust']
    );

    cmp.model.update((m) => ({ ...m, amountLimit: null }));
    await submitAndSettle(fixture, cmp);

    expect(messagesOn(cmp.budgetForm.amountLimit)).toContain(
      'You must enter an amount'
    );
    expect(adjust).not.toHaveBeenCalled();
  });

  it('blocks a submission with an amount below the minimum ceiling', async () => {
    const adjust = vi.fn();
    const { fixture, cmp } = setup(
      adjust as unknown as BudgetsService['adjust']
    );

    cmp.model.update((m) => ({ ...m, amountLimit: 0 }));
    await submitAndSettle(fixture, cmp);

    expect(messagesOn(cmp.budgetForm.amountLimit)).toContain(
      'The amount must be at least 0.01'
    );
    expect(adjust).not.toHaveBeenCalled();
  });

  it('refuses a name over the maximum length', async () => {
    const adjust = vi.fn();
    const { fixture, cmp } = setup(
      adjust as unknown as BudgetsService['adjust']
    );

    cmp.model.update((m) => ({ ...m, name: 'x'.repeat(BUDGET_NAME_MAX + 1) }));
    await submitAndSettle(fixture, cmp);

    expect(messagesOn(cmp.budgetForm.name)).toContain(
      `The name must be ${BUDGET_NAME_MAX} characters or fewer`
    );
    expect(adjust).not.toHaveBeenCalled();
  });

  it('sends the whole set — trimmed name, every field, endDate carried through — and emits the adjusted Budget', async () => {
    const adjust = vi.fn((_id, _budget) => of(ADJUSTED));
    const { fixture, cmp } = setup(
      adjust as unknown as BudgetsService['adjust']
    );
    const emitted: Budget[] = [];
    cmp.adjusted.subscribe((budget) => emitted.push(budget));

    cmp.model.update((m) => ({
      ...m,
      name: '  Groceries  ',
      amountLimit: 25000,
      period: 'weekly',
      startDate: new Date(2026, 8, 1),
      categoryId: 3,
    }));
    await submitAndSettle(fixture, cmp);

    expect(adjust).toHaveBeenCalledWith(12, {
      name: 'Groceries',
      amountLimit: 25000,
      period: 'weekly',
      startDate: new Date(2026, 8, 1),
      endDate: null,
      categoryId: 3,
    } satisfies AdjustBudget);
    expect(emitted).toEqual([ADJUSTED]);
    expect(cmp.errorMessage()).toBeNull();
  });

  it('carries a non-null endDate through untouched — the full-replacement PUT keeps it', async () => {
    const withEnd: Budget = { ...BUDGET, endDate: new Date(2026, 11, 31) };
    const adjust = vi.fn((_id, _budget) => of(withEnd));
    const { fixture, cmp } = setup(
      adjust as unknown as BudgetsService['adjust'],
      withEnd
    );

    cmp.model.update((m) => ({ ...m, amountLimit: 30000 }));
    await submitAndSettle(fixture, cmp);

    expect(adjust).toHaveBeenCalledWith(
      12,
      expect.objectContaining({ endDate: withEnd.endDate })
    );
  });

  it('moves a Budget to watch all spending — a null categoryId is sent', async () => {
    const adjust = vi.fn((_id, _budget) => of({ ...BUDGET, categoryId: null }));
    const { fixture, cmp } = setup(
      adjust as unknown as BudgetsService['adjust']
    );

    cmp.model.update((m) => ({ ...m, categoryId: null }));
    await submitAndSettle(fixture, cmp);

    expect(adjust).toHaveBeenCalledWith(
      12,
      expect.objectContaining({ categoryId: null })
    );
  });

  it('lists expense Categories only in the picker', () => {
    const { cmp } = setup(vi.fn());

    expect(cmp.categoryOptions().map((c) => c.id)).toEqual([1, 3]);
  });

  it('keeps the Budget’s current Category in the picker even when it is not an expense one', () => {
    const onIncome: Budget = { ...BUDGET, categoryId: 2 };
    const { cmp } = setup(vi.fn(), onIncome);

    expect(cmp.categoryOptions().map((c) => c.id)).toEqual([1, 3, 2]);
  });

  it('binds a duplicate-name conflict onto the name control and leaves the banner empty', async () => {
    const { fixture, cmp } = setup(() =>
      throwError(
        () =>
          new ApiError('A budget with this name already exists.', 409, {
            name: ['A budget with this name already exists.'],
          })
      )
    );

    cmp.model.update((m) => ({ ...m, name: 'Rent' }));
    await submitAndSettle(fixture, cmp);

    expect(messagesOn(cmp.budgetForm.name)).toContain(
      'A budget with this name already exists.'
    );
    expect(cmp.errorMessage()).toBeNull();
  });

  it('shows the generic banner for a failure it cannot pin to a field', async () => {
    const { fixture, cmp } = setup(() => throwError(() => new Error('offline')));

    cmp.model.update((m) => ({ ...m, amountLimit: 21000 }));
    await submitAndSettle(fixture, cmp);

    expect(cmp.errorMessage()).toBe(COULD_NOT_ADJUST);
    expect(cmp.budgetForm.name().errors()).toEqual([]);
  });

  it('sends exactly one request when submitted twice in a row', async () => {
    const inFlight = new Subject<Budget>();
    const adjust = vi.fn(() => inFlight.asObservable());
    const { fixture, cmp } = setup(
      adjust as unknown as BudgetsService['adjust']
    );

    cmp.model.update((m) => ({ ...m, amountLimit: 21000 }));
    cmp.save(new Event('submit'));
    cmp.save(new Event('submit'));
    await fixture.whenStable();

    expect(adjust).toHaveBeenCalledTimes(1);
  });

  it('emits cancelled without touching the service', () => {
    const adjust = vi.fn();
    const { cmp } = setup(adjust as unknown as BudgetsService['adjust']);
    const emitted: unknown[] = [];
    cmp.cancelled.subscribe(() => emitted.push('cancelled'));

    cmp.cancel();

    expect(emitted).toEqual(['cancelled']);
    expect(adjust).not.toHaveBeenCalled();
  });
});
