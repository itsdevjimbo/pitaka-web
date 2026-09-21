import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS, provideNativeDateAdapter } from '@angular/material/core';
import { NEVER, of, Subject, throwError } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { provideIcons } from '@/app/core/icons';
import { CategoriesService, Category } from '@/app/domains/app/categories';
import { Tag, TagsService } from '@/app/domains/app/tags';
import { pressEscape, withOverlayContainer } from '@/testing/overlay';
import { Transaction, TransferDestinationAccount } from '../../data/transaction';
import { TransactionsService } from '../../data/transactions.service';
import { RecordTransactionForm } from './record-transaction-form';

const COULD_NOT_RECORD = 'Something went wrong recording this transaction. Please try again.';
const KNOWN_TAGS: Tag[] = [
  { id: 9, name: 'treats' },
  { id: 4, name: 'holiday' },
];
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
const DESTINATIONS: TransferDestinationAccount[] = [
  { id: 4, name: 'Savings' },
  { id: 6, name: 'Joint account' },
];
const RECORDED: Transaction = {
  id: 99,
  amount: 120.5,
  direction: 'expense',
  accountId: 3,
  transferToAccountId: null,
  date: new Date(2026, 7, 29, 14, 5),
  categoryId: 1,
  generated: false,
  description: null,
  tags: [],
};

describe('RecordTransactionForm', () => {
  const overlay = withOverlayContainer();
  const allCategories = vi.fn(() => of([...CATEGORIES, DINING_RETIRED]));

  function setup(
    record: TransactionsService['record'],
    list: CategoriesService['list'] = () => of(CATEGORIES),
    destinations: TransferDestinationAccount[] = DESTINATIONS,
    tagsAll: TagsService['all'] = () => of(KNOWN_TAGS),
  ) {
    allCategories.mockClear();
    TestBed.configureTestingModule({
      imports: [RecordTransactionForm],
      providers: [
        provideIcons(),
        provideNativeDateAdapter(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        { provide: TransactionsService, useValue: { record } },
        { provide: CategoriesService, useValue: { list, all: allCategories } },
        { provide: TagsService, useValue: { all: tagsAll } },
      ],
    });
    const fixture = TestBed.createComponent(RecordTransactionForm);
    fixture.componentRef.setInput('fromAccountId', 3);
    fixture.componentRef.setInput('destinations', destinations);
    fixture.detectChanges();
    return fixture;
  }

  async function settle(fixture: ComponentFixture<RecordTransactionForm>) {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function enter(fixture: ComponentFixture<RecordTransactionForm>, selector: string, value: string) {
    const input = fixture.nativeElement.querySelector(selector) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
  }

  async function chooseDirection(fixture: ComponentFixture<RecordTransactionForm>, label: string) {
    const toggle = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('mat-button-toggle')).find(
      (candidate) => candidate.textContent?.trim() === label,
    );
    if (!toggle) {
      throw new Error(`No Direction toggle labelled "${label}"`);
    }
    (toggle.querySelector('button') ?? toggle).dispatchEvent(new Event('click', { bubbles: true }));
    await settle(fixture);
  }

  async function options(fixture: ComponentFixture<RecordTransactionForm>) {
    (fixture.nativeElement.querySelector('mat-select') as HTMLElement).click();
    await settle(fixture);
    const panel = Array.from(overlay().querySelectorAll<HTMLElement>('.mat-mdc-select-panel')).at(-1)!;
    return Array.from(panel.querySelectorAll<HTMLElement>('mat-option'));
  }

  async function pick(fixture: ComponentFixture<RecordTransactionForm>, label: string) {
    const option = (await options(fixture)).find(
      (candidate) => candidate.textContent?.replace(/\s+/g, ' ').trim() === label,
    );
    if (!option) {
      throw new Error(`No option labelled "${label}"`);
    }
    option.click();
    await settle(fixture);
  }

  async function fillExpense(fixture: ComponentFixture<RecordTransactionForm>) {
    enter(fixture, '#transaction-amount', '120.5');
    enter(fixture, '#transaction-date', '8/29/2026');
    enter(fixture, '#transaction-time', '2:05 PM');
    await pick(fixture, 'Groceries');
  }

  async function submit(fixture: ComponentFixture<RecordTransactionForm>) {
    (fixture.nativeElement.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle(fixture);
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function text(fixture: ComponentFixture<RecordTransactionForm>) {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  it('offers only active Categories of the chosen direction and re-filters', async () => {
    const fixture = setup(vi.fn());
    expect((await options(fixture)).map((option) => option.textContent?.trim())).toEqual(['Groceries', 'Rent']);
    pressEscape();
    await settle(fixture);
    await chooseDirection(fixture, 'Income');
    expect((await options(fixture)).map((option) => option.textContent?.trim())).toEqual(['Salary']);
    expect(allCategories).not.toHaveBeenCalled();
  });

  it('drops a Category left over from the previous direction', async () => {
    const record = vi.fn(() => of(RECORDED));
    const fixture = setup(record as unknown as TransactionsService['record']);
    await fillExpense(fixture);
    await chooseDirection(fixture, 'Income');
    enter(fixture, '#transaction-date', '8/29/2026');
    enter(fixture, '#transaction-time', '2:05 PM');
    await submit(fixture);
    expect(record).not.toHaveBeenCalled();
    expect(text(fixture)).toContain('Choose a category');
  });

  it('records an expense with its Category and folded local moment', async () => {
    const record = vi.fn(() => of(RECORDED));
    const fixture = setup(record as unknown as TransactionsService['record']);
    const emitted: Transaction[] = [];
    fixture.componentInstance.recorded.subscribe((transaction) => emitted.push(transaction));
    await fillExpense(fixture);
    await submit(fixture);
    expect(record).toHaveBeenCalledWith({
      accountId: 3,
      amount: 120.5,
      direction: 'expense',
      date: new Date(2026, 7, 29, 14, 5),
      categoryId: 1,
      transferToAccountId: null,
      tagIds: [],
    });
    expect(emitted).toEqual([RECORDED]);
  });

  it('still records when Tag options fail to load', async () => {
    const record = vi.fn(() => of(RECORDED));
    const fixture = setup(record as unknown as TransactionsService['record'], undefined, undefined, () =>
      throwError(() => new Error('offline')),
    );
    await fillExpense(fixture);
    await submit(fixture);
    expect(record).toHaveBeenCalledOnce();
    expect((fixture.nativeElement.querySelector('tags-tag-field input') as HTMLInputElement).disabled).toBe(true);
  });

  it('folds chosen Tag chips into tagIds', async () => {
    const record = vi.fn(() => of(RECORDED));
    const fixture = setup(record as unknown as TransactionsService['record']);
    await fillExpense(fixture);
    const tag = fixture.nativeElement.querySelector('tags-tag-field input') as HTMLInputElement;
    tag.value = 'treats';
    tag.dispatchEvent(new Event('input'));
    tag.dispatchEvent(new Event('focusin'));
    await settle(fixture);
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
    Object.defineProperty(event, 'keyCode', { get: () => 13 });
    tag.dispatchEvent(event);
    await settle(fixture);
    await submit(fixture);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ accountId: 3, tagIds: [9] }));
  });

  it('records income with its income Category', async () => {
    const record = vi.fn(() => of({ ...RECORDED, direction: 'income', categoryId: 2 }));
    const fixture = setup(record as unknown as TransactionsService['record']);
    await chooseDirection(fixture, 'Income');
    enter(fixture, '#transaction-amount', '120.5');
    enter(fixture, '#transaction-date', '8/29/2026');
    enter(fixture, '#transaction-time', '2:05 PM');
    await pick(fixture, 'Salary');
    await submit(fixture);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ accountId: 3, direction: 'income', categoryId: 2 }));
  });

  it.each([
    ['', 'Enter an amount'],
    ['0', 'Enter an amount greater than zero'],
    ['-1', 'Enter an amount greater than zero'],
  ])('blocks invalid amount %s', async (amount, message) => {
    const record = vi.fn();
    const fixture = setup(record as unknown as TransactionsService['record']);
    enter(fixture, '#transaction-amount', amount);
    await submit(fixture);
    expect(record).not.toHaveBeenCalled();
    expect(text(fixture)).toContain(message);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled,
    ).toBe(false);
    expect(document.activeElement).toBe(fixture.nativeElement.querySelector('#transaction-amount'));
  });

  it('reports edits and an in-flight financial write to the dialog shell', async () => {
    const pending = new Subject<Transaction>();
    const fixture = setup(() => pending);
    const dirty: boolean[] = [];
    const saving: boolean[] = [];
    fixture.componentInstance.dirtyChange.subscribe((value) => dirty.push(value));
    fixture.componentInstance.pendingChange.subscribe((value) => saving.push(value));

    await fillExpense(fixture);
    (fixture.nativeElement.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    expect(dirty).toContain(true);
    expect(saving).toEqual([true]);

    pending.next(RECORDED);
    pending.complete();
    await fixture.whenStable();

    expect(saving).toEqual([true, false]);
  });

  it('releases the busy state after an uncertain timeout without retrying', async () => {
    vi.useFakeTimers();
    try {
      const record = vi.fn(() => NEVER);
      const fixture = setup(record as unknown as TransactionsService['record']);
      await fillExpense(fixture);
      const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;
      form.dispatchEvent(new Event('submit'));
      fixture.detectChanges();
      expect(
        (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled,
      ).toBe(true);

      await vi.advanceTimersByTimeAsync(15_000);
      await Promise.resolve();
      fixture.detectChanges();

      expect(record).toHaveBeenCalledOnce();
      expect(text(fixture)).toContain('couldn’t confirm whether this transaction was recorded');
      expect(
        (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled,
      ).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ['#transaction-date', 'Choose a date'],
    ['#transaction-time', 'Choose a time'],
  ])('blocks a cleared required moment field', async (selector, message) => {
    const record = vi.fn();
    const fixture = setup(record as unknown as TransactionsService['record']);
    await fillExpense(fixture);
    enter(fixture, selector, '');
    await submit(fixture);
    expect(record).not.toHaveBeenCalled();
    expect(text(fixture)).toContain(message);
  });

  it('sends exactly one request while a record is in flight', async () => {
    const pending = new Subject<Transaction>();
    const record = vi.fn(() => pending.asObservable());
    const fixture = setup(record as unknown as TransactionsService['record']);
    await fillExpense(fixture);
    const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit'));
    form.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    expect(record).toHaveBeenCalledTimes(1);
  });

  it('shows unattributed and field-attributed server failures in the right place', async () => {
    let fixture = setup(() => throwError(() => new ApiError('We could not record that just now.', 400)));
    await fillExpense(fixture);
    await submit(fixture);
    expect(text(fixture)).toContain('We could not record that just now.');

    TestBed.resetTestingModule();
    fixture = setup(() => throwError(() => new Error('offline')));
    await fillExpense(fixture);
    await submit(fixture);
    expect(text(fixture)).toContain(COULD_NOT_RECORD);

    TestBed.resetTestingModule();
    fixture = setup(() =>
      throwError(() => new ApiError('Invalid', 400, { amount: ['That amount is not available.'] })),
    );
    await fillExpense(fixture);
    await submit(fixture);
    expect(text(fixture)).toContain('That amount is not available.');
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
  });

  it('requires a destination, but not a Category, for a Transfer', async () => {
    const record = vi.fn();
    const fixture = setup(record as unknown as TransactionsService['record']);
    await chooseDirection(fixture, 'Transfer');
    enter(fixture, '#transaction-amount', '120.5');
    enter(fixture, '#transaction-date', '8/29/2026');
    enter(fixture, '#transaction-time', '2:05 PM');
    await submit(fixture);
    expect(record).not.toHaveBeenCalled();
    expect(text(fixture)).toContain('Choose a destination account');
    expect(text(fixture)).not.toContain('Choose a category');
  });

  it('records a Transfer with a destination and clears a previously chosen Category', async () => {
    const transfer = { ...RECORDED, direction: 'transfer' as const, categoryId: null, transferToAccountId: 4 };
    const record = vi.fn(() => of(transfer));
    const fixture = setup(record as unknown as TransactionsService['record']);
    await fillExpense(fixture);
    await chooseDirection(fixture, 'Transfer');
    expect((await options(fixture)).map((option) => option.textContent?.trim())).toEqual(['Savings', 'Joint account']);
    pressEscape();
    await settle(fixture);
    await pick(fixture, 'Savings');
    await submit(fixture);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 3,
        direction: 'transfer',
        categoryId: null,
        transferToAccountId: 4,
      }),
    );
    expect(text(fixture)).not.toContain('Category');
  });

  it('drops a destination when switching back from Transfer', async () => {
    const record = vi.fn();
    const fixture = setup(record as unknown as TransactionsService['record']);
    await chooseDirection(fixture, 'Transfer');
    await pick(fixture, 'Savings');
    await chooseDirection(fixture, 'Expense');
    enter(fixture, '#transaction-amount', '120.5');
    enter(fixture, '#transaction-date', '8/29/2026');
    enter(fixture, '#transaction-time', '2:05 PM');
    await pick(fixture, 'Groceries');
    await submit(fixture);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ accountId: 3, transferToAccountId: null }));
  });

  it('emits cancelled without touching the service', () => {
    const record = vi.fn();
    const fixture = setup(record as unknown as TransactionsService['record']);
    const emitted: unknown[] = [];
    fixture.componentInstance.cancelled.subscribe(() => emitted.push('cancelled'));
    const cancel = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Cancel',
    )!;
    cancel.click();
    expect(emitted).toEqual(['cancelled']);
    expect(record).not.toHaveBeenCalled();
  });
});
