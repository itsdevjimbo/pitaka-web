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
import { Budget, BUDGET_NAME_MAX, Period } from '../data/budget';
import { startOfCurrentPeriod } from '../data/budget-calendar';
import { BudgetsService } from '../data/budgets.service';
import { NewBudgetForm } from './new-budget-form';

type Model = {
  name: string;
  amountLimit: number | null;
  period: Period | '';
  startDate: Date | null;
  categoryId: number | null;
};

/** The slice of the component the tests reach into. */
type NewBudgetInternals = {
  model: WritableSignal<Model>;
  budgetForm: {
    name: FieldTree<string>;
    amountLimit: FieldTree<number | null>;
    period: FieldTree<Period | ''>;
    startDate: FieldTree<Date | null>;
    categoryId: FieldTree<number | null>;
  };
  categoryOptions: () => Category[];
  startDateEdited: WritableSignal<boolean>;
  errorMessage: () => string | null;
  created: OutputEmitterRef<Budget>;
  cancelled: OutputEmitterRef<void>;
  save(event: Event): void;
  cancel(): void;
  onStartDateEdited(): void;
};

const COULD_NOT_CREATE =
  'Something went wrong creating your budget. Please try again.';

const CATEGORIES: Category[] = [
  { id: 1, name: 'Groceries', kind: 'expense' },
  { id: 2, name: 'Salary', kind: 'income' },
  { id: 3, name: 'Rent', kind: 'expense' },
];

const CREATED: Budget = {
  id: 12,
  name: 'Groceries',
  amountLimit: 20000,
  period: 'monthly',
  startDate: new Date(2026, 7, 1),
  endDate: null,
  categoryId: 1,
};

describe('NewBudgetForm', () => {
  // The self-filling start date is computed from `new Date()`; pin a zone so the
  // expected calendar day is stable regardless of where the runner sits.
  const pinTimezone = withPinnedTimezone();
  beforeEach(() => pinTimezone('America/New_York'));

  function setup(
    create: BudgetsService['create'],
    list: CategoriesService['list'] = () => of(CATEGORIES)
  ) {
    TestBed.configureTestingModule({
      imports: [NewBudgetForm],
      providers: [
        provideIcons(),
        provideNativeDateAdapter(),
        { provide: BudgetsService, useValue: { create } },
        { provide: CategoriesService, useValue: { list } },
      ],
    });

    const fixture = TestBed.createComponent(NewBudgetForm);
    const cmp = fixture.componentInstance as unknown as NewBudgetInternals;
    fixture.detectChanges();
    return { fixture, cmp };
  }

  async function submitAndSettle(
    fixture: { whenStable: () => Promise<unknown> },
    cmp: NewBudgetInternals
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

  /**
   * A complete, valid model — the common starting point for the happy paths and
   * the error paths. The start date is set explicitly, so `startDateEdited` is
   * flipped too: that is the honest state ("the person filled the whole form")
   * and it stops the Period-driven self-fill from churning the model underneath
   * a test that is watching the banner.
   */
  function fill(cmp: NewBudgetInternals, over: Partial<Model> = {}) {
    cmp.startDateEdited.set(true);
    cmp.model.set({
      name: 'Groceries',
      amountLimit: 20000,
      period: 'monthly',
      startDate: new Date(2026, 7, 1),
      categoryId: null,
      ...over,
    });
  }

  it('blocks a submission with no name and never calls the service', async () => {
    const create = vi.fn();
    const { fixture, cmp } = setup(
      create as unknown as BudgetsService['create']
    );

    fill(cmp, { name: '' });
    await submitAndSettle(fixture, cmp);

    expect(messagesOn(cmp.budgetForm.name)).toContain('You must enter a name');
    expect(create).not.toHaveBeenCalled();
  });

  it('blocks a submission with no amount and never calls the service', async () => {
    const create = vi.fn();
    const { fixture, cmp } = setup(
      create as unknown as BudgetsService['create']
    );

    fill(cmp, { amountLimit: null });
    await submitAndSettle(fixture, cmp);

    expect(messagesOn(cmp.budgetForm.amountLimit)).toContain(
      'You must enter an amount'
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('blocks a submission with an amount below the minimum ceiling', async () => {
    const create = vi.fn();
    const { fixture, cmp } = setup(
      create as unknown as BudgetsService['create']
    );

    fill(cmp, { amountLimit: 0 });
    await submitAndSettle(fixture, cmp);

    expect(messagesOn(cmp.budgetForm.amountLimit)).toContain(
      'The amount must be at least 0.01'
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses a name over the maximum length', async () => {
    const create = vi.fn();
    const { fixture, cmp } = setup(
      create as unknown as BudgetsService['create']
    );

    fill(cmp, { name: 'x'.repeat(BUDGET_NAME_MAX + 1) });
    await submitAndSettle(fixture, cmp);

    expect(messagesOn(cmp.budgetForm.name)).toContain(
      `The name must be ${BUDGET_NAME_MAX} characters or fewer`
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('blocks a submission with no period chosen and never calls the service', async () => {
    const create = vi.fn();
    const { fixture, cmp } = setup(
      create as unknown as BudgetsService['create']
    );

    fill(cmp, { period: '', startDate: new Date(2026, 7, 1) });
    await submitAndSettle(fixture, cmp);

    expect(messagesOn(cmp.budgetForm.period)).toContain(
      'You must choose a period'
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('sends the trimmed name, amount, period, start date and Category, and emits the created Budget', async () => {
    const create = vi.fn((_budget) => of(CREATED));
    const { fixture, cmp } = setup(
      create as unknown as BudgetsService['create']
    );
    const emitted: Budget[] = [];
    cmp.created.subscribe((budget) => emitted.push(budget));

    fill(cmp, { name: '  Groceries  ', categoryId: 3 });
    await submitAndSettle(fixture, cmp);

    expect(create).toHaveBeenCalledWith({
      name: 'Groceries',
      amountLimit: 20000,
      period: 'monthly',
      startDate: new Date(2026, 7, 1),
      categoryId: 3,
    });
    expect(emitted).toEqual([CREATED]);
    expect(cmp.errorMessage()).toBeNull();
  });

  it('defaults the Category to "All spending" — a null categoryId is sent, not blocked', async () => {
    const create = vi.fn((_budget) => of({ ...CREATED, categoryId: null }));
    const { fixture, cmp } = setup(
      create as unknown as BudgetsService['create']
    );

    // Never touch the Category field.
    fill(cmp, { categoryId: null });
    await submitAndSettle(fixture, cmp);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ categoryId: null })
    );
    expect(messagesOn(cmp.budgetForm.categoryId)).toEqual([]);
  });

  it('lists expense Categories only in the picker', () => {
    const { cmp } = setup(vi.fn());

    expect(cmp.categoryOptions().map((c) => c.id)).toEqual([1, 3]);
  });

  it('fills the start date from the Period once one is chosen, and re-fills when it changes', async () => {
    const { fixture, cmp } = setup(vi.fn());

    expect(cmp.model().startDate).toBeNull();

    cmp.model.update((m) => ({ ...m, period: 'monthly' }));
    await fixture.whenStable();

    expect(cmp.model().startDate).toEqual(
      startOfCurrentPeriod('monthly', new Date())
    );

    cmp.model.update((m) => ({ ...m, period: 'weekly' }));
    await fixture.whenStable();

    expect(cmp.model().startDate).toEqual(
      startOfCurrentPeriod('weekly', new Date())
    );
  });

  it('stops following the Period once the person edits the start date', async () => {
    const { fixture, cmp } = setup(vi.fn());

    cmp.model.update((m) => ({ ...m, period: 'monthly' }));
    await fixture.whenStable();

    // The person picks their own start date.
    cmp.onStartDateEdited();
    const chosen = new Date(2026, 0, 15);
    cmp.model.update((m) => ({ ...m, startDate: chosen }));
    await fixture.whenStable();

    // A later Period change must not overwrite it.
    cmp.model.update((m) => ({ ...m, period: 'yearly' }));
    await fixture.whenStable();

    expect(cmp.model().startDate).toEqual(chosen);
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

    fill(cmp);
    await submitAndSettle(fixture, cmp);

    expect(messagesOn(cmp.budgetForm.name)).toContain(
      'A budget with this name already exists.'
    );
    expect(cmp.errorMessage()).toBeNull();
  });

  it('shows the generic banner for a failure it cannot pin to a field', async () => {
    const { fixture, cmp } = setup(() => throwError(() => new Error('offline')));

    fill(cmp);
    await submitAndSettle(fixture, cmp);

    expect(cmp.errorMessage()).toBe(COULD_NOT_CREATE);
    expect(cmp.budgetForm.name().errors()).toEqual([]);
  });

  it('sends exactly one request when submitted twice in a row', async () => {
    const inFlight = new Subject<Budget>();
    const create = vi.fn(() => inFlight.asObservable());
    const { fixture, cmp } = setup(
      create as unknown as BudgetsService['create']
    );

    fill(cmp);
    cmp.save(new Event('submit'));
    cmp.save(new Event('submit'));
    await fixture.whenStable();

    expect(create).toHaveBeenCalledTimes(1);
  });

  it('emits cancelled without touching the service', () => {
    const create = vi.fn();
    const { cmp } = setup(create as unknown as BudgetsService['create']);
    const emitted: unknown[] = [];
    cmp.cancelled.subscribe(() => emitted.push('cancelled'));

    cmp.cancel();

    expect(emitted).toEqual(['cancelled']);
    expect(create).not.toHaveBeenCalled();
  });
});
