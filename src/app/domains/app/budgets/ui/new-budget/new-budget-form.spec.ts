import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNativeDateAdapter } from '@angular/material/core';
import { of, Subject, throwError } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { provideIcons } from '@/app/core/icons';
import { CategoriesService, Category } from '@/app/domains/app/categories';
import { withOverlayContainer } from '@/testing/overlay';
import { withPinnedTimezone } from '@/testing/timezone';
import { Budget, BUDGET_NAME_MAX } from '../../data/budget';
import { BudgetsService } from '../../data/budgets.service';
import { NewBudgetForm } from './new-budget-form';

const COULD_NOT_CREATE = 'Something went wrong creating your budget. Please try again.';
const CATEGORIES: Category[] = [
  { id: 1, name: 'Groceries', kind: 'expense', isActive: true, isDefault: false },
  { id: 2, name: 'Salary', kind: 'income', isActive: true, isDefault: false },
  { id: 3, name: 'Rent', kind: 'expense', isActive: true, isDefault: false },
];
const DINING_RETIRED: Category = {
  id: 7,
  name: 'Dining out',
  kind: 'expense',
  isActive: false,
  isDefault: false,
};
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
  const overlay = withOverlayContainer();
  const pinTimezone = withPinnedTimezone();
  beforeEach(() => pinTimezone('America/New_York'));
  const allCategories = vi.fn(() => of([...CATEGORIES, DINING_RETIRED]));

  function setup(create: BudgetsService['create'], list: CategoriesService['list'] = () => of(CATEGORIES)) {
    allCategories.mockClear();
    TestBed.configureTestingModule({
      imports: [NewBudgetForm],
      providers: [
        provideIcons(),
        provideNativeDateAdapter(),
        { provide: BudgetsService, useValue: { create } },
        { provide: CategoriesService, useValue: { list, all: allCategories } },
      ],
    });
    const fixture = TestBed.createComponent(NewBudgetForm);
    fixture.detectChanges();
    return fixture;
  }

  async function settle(fixture: ComponentFixture<NewBudgetForm>) {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function enter(fixture: ComponentFixture<NewBudgetForm>, selector: string, value: string) {
    const input = fixture.nativeElement.querySelector(selector) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  async function pick(fixture: ComponentFixture<NewBudgetForm>, index: number, label: string) {
    (fixture.nativeElement.querySelectorAll('mat-select')[index] as HTMLElement).click();
    await settle(fixture);
    const option = Array.from(overlay().querySelectorAll<HTMLElement>('mat-option')).find(
      (candidate) => candidate.textContent?.trim() === label,
    );
    if (!option) {
      throw new Error(`No option labelled "${label}"`);
    }
    option.click();
    await settle(fixture);
  }

  async function fill(
    fixture: ComponentFixture<NewBudgetForm>,
    values: { name?: string; amount?: string; period?: string; category?: string } = {},
  ) {
    enter(fixture, '#budget-name', values.name ?? 'Groceries');
    enter(fixture, '#budget-amount', values.amount ?? '20000');
    if (values.period !== '') {
      await pick(fixture, 0, values.period ?? 'Monthly');
    }
    enter(fixture, '#budget-start-date', '8/1/2026');
    if (values.category) {
      await pick(fixture, 1, values.category);
    }
  }

  async function submit(fixture: ComponentFixture<NewBudgetForm>) {
    (fixture.nativeElement.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle(fixture);
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const text = (fixture: ComponentFixture<NewBudgetForm>) => (fixture.nativeElement as HTMLElement).textContent ?? '';

  it.each([
    { values: { name: '' }, message: 'You must enter a name' },
    { values: { amount: '' }, message: 'You must enter an amount' },
    { values: { amount: '0' }, message: 'The amount must be at least 0.01' },
    {
      values: { name: 'x'.repeat(BUDGET_NAME_MAX + 1) },
      message: `The name must be ${BUDGET_NAME_MAX} characters or fewer`,
    },
    { values: { period: '' }, message: 'You must choose a period' },
  ])('blocks invalid input: $message', async ({ values, message }) => {
    const create = vi.fn();
    const fixture = setup(create as unknown as BudgetsService['create']);
    await fill(fixture, values);
    await submit(fixture);
    expect(text(fixture)).toContain(message);
    expect(create).not.toHaveBeenCalled();
  });

  it('sends the trimmed fields and emits the created Budget', async () => {
    const create = vi.fn(() => of(CREATED));
    const fixture = setup(create as unknown as BudgetsService['create']);
    const emitted: Budget[] = [];
    fixture.componentInstance.created.subscribe((budget) => emitted.push(budget));
    await fill(fixture, { name: '  Groceries  ', category: 'Rent' });
    await submit(fixture);
    expect(create).toHaveBeenCalledWith({
      name: 'Groceries',
      amountLimit: 20000,
      period: 'monthly',
      startDate: new Date(2026, 7, 1),
      categoryId: 3,
    });
    expect(emitted).toEqual([CREATED]);
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
  });

  it('defaults the Category to All spending', async () => {
    const create = vi.fn(() => of({ ...CREATED, categoryId: null }));
    const fixture = setup(create as unknown as BudgetsService['create']);
    await fill(fixture);
    await submit(fixture);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ categoryId: null }));
  });

  it('lists active expense Categories only in the picker', async () => {
    const list = vi.fn(() => of(CATEGORIES));
    const fixture = setup(vi.fn(), list);
    await pick(fixture, 0, 'Monthly');
    (fixture.nativeElement.querySelectorAll('mat-select')[1] as HTMLElement).click();
    await settle(fixture);
    const panel = Array.from(overlay().querySelectorAll<HTMLElement>('.mat-mdc-select-panel')).at(-1)!;
    const options = Array.from(panel.querySelectorAll('mat-option')).map((option) => option.textContent?.trim());
    expect(options).toEqual(['All spending', 'Groceries', 'Rent']);
    expect(list).toHaveBeenCalled();
    expect(allCategories).not.toHaveBeenCalled();
  });

  it('fills the start date from the Period and refills it when the Period changes', async () => {
    const fixture = setup(vi.fn());
    const date = fixture.nativeElement.querySelector('#budget-start-date') as HTMLInputElement;
    expect(date.value).toBe('');
    await pick(fixture, 0, 'Monthly');
    const monthly = date.value;
    expect(monthly).not.toBe('');
    await pick(fixture, 0, 'Weekly');
    expect(date.value).not.toBe(monthly);
  });

  it('stops following the Period once the person edits the start date', async () => {
    const fixture = setup(vi.fn());
    await pick(fixture, 0, 'Monthly');
    enter(fixture, '#budget-start-date', '1/15/2026');
    await pick(fixture, 0, 'Yearly');
    expect((fixture.nativeElement.querySelector('#budget-start-date') as HTMLInputElement).value).toBe('1/15/2026');
  });

  it('binds a duplicate-name conflict onto the name control', async () => {
    const fixture = setup(() =>
      throwError(
        () =>
          new ApiError('A budget with this name already exists.', 409, {
            name: ['A budget with this name already exists.'],
          }),
      ),
    );
    await fill(fixture);
    await submit(fixture);
    expect(text(fixture)).toContain('A budget with this name already exists.');
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
  });

  it('shows the generic banner for an unattributed failure', async () => {
    const fixture = setup(() => throwError(() => new Error('offline')));
    await fill(fixture);
    await submit(fixture);
    expect(text(fixture)).toContain(COULD_NOT_CREATE);
    expect(text(fixture)).not.toContain('You must enter a name');
  });

  it('sends exactly one request when submitted twice in a row', async () => {
    const inFlight = new Subject<Budget>();
    const create = vi.fn(() => inFlight.asObservable());
    const fixture = setup(create as unknown as BudgetsService['create']);
    await fill(fixture);
    const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit'));
    form.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('releases pending and explains an uncertain create without replaying it', async () => {
    const inFlight = new Subject<Budget>();
    const create = vi.fn(() => inFlight.asObservable());
    const fixture = setup(create as unknown as BudgetsService['create']);
    const pending: boolean[] = [];
    fixture.componentInstance.pendingChange.subscribe((value) => pending.push(value));
    await fill(fixture);

    vi.useFakeTimers();
    try {
      (fixture.nativeElement.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
      await Promise.resolve();
      expect(pending).toEqual([true]);

      await vi.advanceTimersByTimeAsync(15_000);
      fixture.detectChanges();

      expect(text(fixture)).toContain('couldn’t confirm whether this Budget was created');
      expect(pending).toEqual([true, false]);
      expect(create).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('emits cancelled without touching the service', () => {
    const create = vi.fn();
    const fixture = setup(create as unknown as BudgetsService['create']);
    const emitted: unknown[] = [];
    fixture.componentInstance.cancelled.subscribe(() => emitted.push('cancelled'));
    const cancel = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Cancel',
    );
    if (!cancel) {
      throw new Error('No Cancel button');
    }
    cancel.click();
    expect(emitted).toEqual(['cancelled']);
    expect(create).not.toHaveBeenCalled();
  });
});
