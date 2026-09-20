import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Schedule } from '../../data/schedule';
import { ScheduleRow, ScheduleRowData } from './schedule-row';

const SCHEDULE: Schedule = {
  id: 1,
  accountId: 2,
  categoryId: 3,
  name: 'Rent',
  direction: 'expense',
  amount: 18000,
  description: null,
  frequency: 'monthly',
  firstGeneration: new Date(2026, 0, 5),
  lastGeneration: null,
  nextGeneration: new Date(2026, 9, 5),
  status: 'active',
  generatedTransactionCount: 1,
  canDelete: false,
};

describe('ScheduleRow', () => {
  function setup(overrides: Partial<ScheduleRowData> = {}): ComponentFixture<ScheduleRow> {
    TestBed.configureTestingModule({ imports: [ScheduleRow] });
    const fixture = TestBed.createComponent(ScheduleRow);
    fixture.componentRef.setInput('row', {
      schedule: SCHEDULE,
      accountName: 'Everyday cash',
      accountRetired: false,
      categoryName: 'Housing',
      categoryRetired: false,
      ...overrides,
    } satisfies ScheduleRowData);
    fixture.detectChanges();
    return fixture;
  }

  it('shows the lifecycle, filing, frequency, amount, and history facts', () => {
    const text = (setup().nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('Next generation: 5 Oct 2026');
    expect(text).toContain('Rent');
    expect(text).toContain('Expense');
    expect(text).toContain('₱18,000.00');
    expect(text).toContain('Monthly');
    expect(text).toContain('Everyday cash · Housing');
    expect(text).toContain('1 surviving generated Transaction');
  });

  it('explains why an active Schedule filed to a retired Account is blocked', () => {
    const text = (setup({ accountRetired: true }).nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('Generation blocked');
    expect(text).toContain('This Account is retired. Generation is blocked.');
    expect(text).toContain('Reactivating the Account resumes generation and may create one overdue Transaction.');
    expect(text).not.toContain('Next generation:');
  });

  it('marks a retired Category without treating it as a generation block', () => {
    const text = (setup({ categoryRetired: true }).nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('Retired');
    expect(text).toContain('Next generation: 5 Oct 2026');
    expect(text).not.toContain('Generation blocked');
  });
});
