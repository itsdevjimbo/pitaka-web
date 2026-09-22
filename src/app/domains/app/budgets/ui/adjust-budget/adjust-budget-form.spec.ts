import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNativeDateAdapter } from '@angular/material/core';
import { of, Subject, throwError } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { provideIcons } from '@/app/core/icons';
import { CategoriesService, Category } from '@/app/domains/app/categories';
import { withOverlayContainer } from '@/testing/overlay';
import { withPinnedTimezone } from '@/testing/timezone';
import { AdjustBudget, Budget, BUDGET_NAME_MAX } from '../../data/budget';
import { BudgetsService } from '../../data/budgets.service';
import { AdjustBudgetForm } from './adjust-budget-form';

const COULD_NOT_ADJUST = 'Something went wrong adjusting your budget. Please try again.';
const CATEGORIES: Category[] = [
  { id: 1, name: 'Groceries', kind: 'expense', isActive: true, isDefault: false },
  { id: 2, name: 'Salary', kind: 'income', isActive: true, isDefault: false },
  { id: 3, name: 'Rent', kind: 'expense', isActive: true, isDefault: false },
];
const HOLIDAYS_RETIRED: Category = {
  id: 9,
  name: 'Holidays',
  kind: 'expense',
  isActive: false,
  isDefault: false,
};
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
  const overlay = withOverlayContainer();
  const pinTimezone = withPinnedTimezone();
  beforeEach(() => pinTimezone('America/New_York'));

  function setup(
    adjust: BudgetsService['adjust'],
    budget: Budget = BUDGET,
    list: CategoriesService['list'] = () => of(CATEGORIES),
    all: CategoriesService['all'] = () => of([...CATEGORIES, HOLIDAYS_RETIRED]),
  ) {
    TestBed.configureTestingModule({
      imports: [AdjustBudgetForm],
      providers: [
        provideIcons(),
        provideNativeDateAdapter(),
        { provide: BudgetsService, useValue: { adjust } },
        { provide: CategoriesService, useValue: { list, all } },
      ],
    });
    const fixture = TestBed.createComponent(AdjustBudgetForm);
    fixture.componentRef.setInput('budget', budget);
    fixture.detectChanges();
    return fixture;
  }

  async function settle(fixture: ComponentFixture<AdjustBudgetForm>) {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function enter(fixture: ComponentFixture<AdjustBudgetForm>, selector: string, value: string) {
    const input = fixture.nativeElement.querySelector(selector) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  async function pick(fixture: ComponentFixture<AdjustBudgetForm>, index: number, label: string) {
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

  async function categoryOptions(fixture: ComponentFixture<AdjustBudgetForm>) {
    (fixture.nativeElement.querySelectorAll('mat-select')[1] as HTMLElement).click();
    await settle(fixture);
    const panel = Array.from(overlay().querySelectorAll<HTMLElement>('.mat-mdc-select-panel')).at(-1)!;
    return Array.from(panel.querySelectorAll('mat-option')).map((option) => option.textContent?.trim() ?? '');
  }

  async function selectedLabel(fixture: ComponentFixture<AdjustBudgetForm>, index: number) {
    (fixture.nativeElement.querySelectorAll('mat-select')[index] as HTMLElement).click();
    await settle(fixture);
    const panel = Array.from(overlay().querySelectorAll<HTMLElement>('.mat-mdc-select-panel')).at(-1)!;
    const selected = panel.querySelector<HTMLElement>('mat-option[aria-selected="true"]');
    const label = selected?.textContent?.trim() ?? '';
    selected?.click();
    await settle(fixture);
    return label;
  }

  async function submit(fixture: ComponentFixture<AdjustBudgetForm>) {
    (fixture.nativeElement.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle(fixture);
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const text = (fixture: ComponentFixture<AdjustBudgetForm>) =>
    (fixture.nativeElement as HTMLElement).textContent ?? '';

  it('prefills every rendered control from the Budget', async () => {
    const fixture = setup(vi.fn());
    expect((fixture.nativeElement.querySelector('#budget-name') as HTMLInputElement).value).toBe('Groceries');
    expect((fixture.nativeElement.querySelector('#budget-amount') as HTMLInputElement).value).toBe('20000');
    expect((fixture.nativeElement.querySelector('#budget-start-date') as HTMLInputElement).value).toContain('2026');
    expect(await selectedLabel(fixture, 0)).toBe('Monthly');
    expect(await selectedLabel(fixture, 1)).toBe('Groceries');
  });

  it.each([
    { selector: '#budget-name', value: '', message: 'You must enter a name' },
    { selector: '#budget-amount', value: '', message: 'You must enter an amount' },
    { selector: '#budget-amount', value: '0', message: 'The amount must be at least 0.01' },
    {
      selector: '#budget-name',
      value: 'x'.repeat(BUDGET_NAME_MAX + 1),
      message: `The name must be ${BUDGET_NAME_MAX} characters or fewer`,
    },
  ])('blocks invalid input: $message', async (item) => {
    const adjust = vi.fn();
    const fixture = setup(adjust as unknown as BudgetsService['adjust']);
    enter(fixture, item.selector, item.value);
    await submit(fixture);
    expect(text(fixture)).toContain(item.message);
    expect(adjust).not.toHaveBeenCalled();
  });

  it('sends the complete replacement and emits the adjusted Budget', async () => {
    const adjust = vi.fn(() => of(ADJUSTED));
    const fixture = setup(adjust as unknown as BudgetsService['adjust']);
    const emitted: Budget[] = [];
    fixture.componentInstance.adjusted.subscribe((budget) => emitted.push(budget));
    enter(fixture, '#budget-name', '  Groceries  ');
    enter(fixture, '#budget-amount', '25000');
    await pick(fixture, 0, 'Weekly');
    enter(fixture, '#budget-start-date', '9/1/2026');
    await pick(fixture, 1, 'Rent');
    await submit(fixture);
    expect(adjust).toHaveBeenCalledWith(12, {
      name: 'Groceries',
      amountLimit: 25000,
      period: 'weekly',
      startDate: new Date(2026, 8, 1),
      endDate: null,
      categoryId: 3,
    } satisfies AdjustBudget);
    expect(emitted).toEqual([ADJUSTED]);
  });

  it('carries a non-null endDate through untouched', async () => {
    const withEnd: Budget = { ...BUDGET, endDate: new Date(2026, 11, 31) };
    const adjust = vi.fn(() => of(withEnd));
    const fixture = setup(adjust as unknown as BudgetsService['adjust'], withEnd);
    enter(fixture, '#budget-amount', '30000');
    await submit(fixture);
    expect(adjust).toHaveBeenCalledWith(12, expect.objectContaining({ endDate: withEnd.endDate }));
  });

  it('moves a Budget to watch all spending', async () => {
    const adjust = vi.fn(() => of({ ...BUDGET, categoryId: null }));
    const fixture = setup(adjust as unknown as BudgetsService['adjust']);
    await pick(fixture, 1, 'All spending');
    await submit(fixture);
    expect(adjust).toHaveBeenCalledWith(12, expect.objectContaining({ categoryId: null }));
  });

  it('offers active expense Categories and keeps only the saved exceptional Category', async () => {
    let fixture = setup(vi.fn());
    expect(await categoryOptions(fixture)).toEqual(['All spending', 'Groceries', 'Rent']);

    TestBed.resetTestingModule();
    fixture = setup(vi.fn(), { ...BUDGET, categoryId: 2 });
    expect(await categoryOptions(fixture)).toEqual(['All spending', 'Groceries', 'Rent', 'Salary']);

    TestBed.resetTestingModule();
    fixture = setup(vi.fn(), { ...BUDGET, categoryId: 9 });
    expect(await categoryOptions(fixture)).toEqual(['All spending', 'Groceries', 'Rent', 'Holidays · Retired']);
  });

  it('drops a saved exceptional Category once the selection moves off it', async () => {
    const fixture = setup(vi.fn(), { ...BUDGET, categoryId: 9 });
    await pick(fixture, 1, 'Rent');
    expect(await categoryOptions(fixture)).toEqual(['All spending', 'Groceries', 'Rent']);
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
    enter(fixture, '#budget-name', 'Rent');
    await submit(fixture);
    expect(text(fixture)).toContain('A budget with this name already exists.');
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
  });

  it('shows the generic banner for an unattributed failure', async () => {
    const fixture = setup(() => throwError(() => new Error('offline')));
    enter(fixture, '#budget-amount', '21000');
    await submit(fixture);
    expect(text(fixture)).toContain(COULD_NOT_ADJUST);
    expect(text(fixture)).not.toContain('You must enter a name');
  });

  it('sends exactly one request when submitted twice in a row', async () => {
    const inFlight = new Subject<Budget>();
    const adjust = vi.fn(() => inFlight.asObservable());
    const fixture = setup(adjust as unknown as BudgetsService['adjust']);
    enter(fixture, '#budget-amount', '21000');
    const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit'));
    form.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    expect(adjust).toHaveBeenCalledTimes(1);
  });

  it('releases pending and explains an uncertain adjustment without replaying it', async () => {
    const inFlight = new Subject<Budget>();
    const adjust = vi.fn(() => inFlight.asObservable());
    const fixture = setup(adjust as unknown as BudgetsService['adjust']);
    const pending: boolean[] = [];
    fixture.componentInstance.pendingChange.subscribe((value) => pending.push(value));
    enter(fixture, '#budget-amount', '21000');

    vi.useFakeTimers();
    try {
      (fixture.nativeElement.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
      await Promise.resolve();
      expect(pending).toEqual([true]);

      await vi.advanceTimersByTimeAsync(15_000);
      fixture.detectChanges();

      expect(text(fixture)).toContain('couldn’t confirm whether these changes were saved');
      expect(pending).toEqual([true, false]);
      expect(adjust).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('emits cancelled without touching the service', () => {
    const adjust = vi.fn();
    const fixture = setup(adjust as unknown as BudgetsService['adjust']);
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
    expect(adjust).not.toHaveBeenCalled();
  });
});
