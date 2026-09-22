import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS, provideNativeDateAdapter } from '@angular/material/core';
import { NEVER, of, Subject, throwError } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { provideIcons } from '@/app/core/icons';
import { CategoriesService, Category } from '@/app/domains/app/categories';
import { TagsService } from '@/app/domains/app/tags';
import { pressEscape, withOverlayContainer } from '@/testing/overlay';
import { Transaction } from '../../data/transaction';
import { TransactionsService } from '../../data/transactions.service';
import { RefileTransactionForm } from './refile-transaction-form';

const COULD_NOT_REFILE = 'Something went wrong refiling this transaction. Please try again.';
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

function existing(over: Partial<Transaction> = {}): Transaction {
  return {
    id: 42,
    amount: 120.5,
    direction: 'expense',
    accountId: 3,
    transferToAccountId: null,
    date: new Date(2026, 7, 29, 9, 30),
    categoryId: 1,
    generated: false,
    description: 'Coffee',
    tags: [{ id: 9, name: 'treats' }],
    ...over,
  };
}

describe('RefileTransactionForm', () => {
  const overlay = withOverlayContainer();

  function setup(
    refile: TransactionsService['refile'],
    transaction: Transaction = existing(),
    list: CategoriesService['list'] = () => of(CATEGORIES),
    all: CategoriesService['all'] = () => of([...CATEGORIES, DINING_RETIRED]),
  ) {
    TestBed.configureTestingModule({
      imports: [RefileTransactionForm],
      providers: [
        provideIcons(),
        provideNativeDateAdapter(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        { provide: TransactionsService, useValue: { refile } },
        { provide: CategoriesService, useValue: { list, all } },
        { provide: TagsService, useValue: { all: () => of([]) } },
      ],
    });
    const fixture = TestBed.createComponent(RefileTransactionForm);
    fixture.componentRef.setInput('transaction', transaction);
    fixture.detectChanges();
    return fixture;
  }

  async function settle(fixture: ComponentFixture<RefileTransactionForm>) {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function enter(fixture: ComponentFixture<RefileTransactionForm>, selector: string, value: string) {
    const input = fixture.nativeElement.querySelector(selector) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  async function options(fixture: ComponentFixture<RefileTransactionForm>) {
    (fixture.nativeElement.querySelector('mat-select') as HTMLElement).click();
    await settle(fixture);
    const panel = Array.from(overlay().querySelectorAll<HTMLElement>('.mat-mdc-select-panel')).at(-1)!;
    return Array.from(panel.querySelectorAll<HTMLElement>('mat-option'));
  }

  async function pick(fixture: ComponentFixture<RefileTransactionForm>, label: string) {
    const option = (await options(fixture)).find(
      (candidate) => candidate.textContent?.replace(/\s+/g, ' ').trim() === label,
    );
    if (!option) {
      throw new Error(`No option labelled "${label}"`);
    }
    option.click();
    await settle(fixture);
  }

  async function submit(fixture: ComponentFixture<RefileTransactionForm>) {
    (fixture.nativeElement.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle(fixture);
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function text(fixture: ComponentFixture<RefileTransactionForm>) {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  it('opens carrying the current moment, Category, note, and Tags', async () => {
    const fixture = setup(vi.fn());
    expect((fixture.nativeElement.querySelector('#refile-transaction-date') as HTMLInputElement).value).toContain(
      '2026',
    );
    expect((fixture.nativeElement.querySelector('#refile-transaction-time') as HTMLInputElement).value).toContain(
      '9:30',
    );
    expect((fixture.nativeElement.querySelector('#refile-transaction-note') as HTMLInputElement).value).toBe('Coffee');
    expect(text(fixture)).toContain('treats');
    const labels = (await options(fixture)).map((option) => option.textContent?.replace(/\s+/g, ' ').trim());
    expect(labels).toContain('Groceries');
  });

  it('shows amount and direction as settled text with no destructive action', () => {
    const fixture = setup(vi.fn());
    expect(text(fixture)).toContain('Expense');
    expect(text(fixture)).toContain('₱120.50');
    expect(text(fixture)).toContain('remove this transaction and record it again');
    expect(fixture.nativeElement.querySelector('input[type="number"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('mat-button-toggle-group')).toBeNull();
    expect(
      Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')).some(
        (button) => button.textContent?.trim() === 'Remove',
      ),
    ).toBe(false);
  });

  it('offers active Categories of the Transaction direction only', async () => {
    let fixture = setup(vi.fn());
    expect((await options(fixture)).map((option) => option.textContent?.trim())).toEqual([
      'Uncategorised',
      'Groceries',
      'Rent',
    ]);

    TestBed.resetTestingModule();
    fixture = setup(vi.fn(), existing({ direction: 'income', categoryId: 2 }));
    expect((await options(fixture)).map((option) => option.textContent?.trim())).toEqual(['Uncategorised', 'Salary']);
  });

  it('keeps only this Transaction’s retired saved Category and drops it after moving away', async () => {
    const fixture = setup(vi.fn(), existing({ categoryId: 7 }));
    expect((await options(fixture)).map((option) => option.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      'Uncategorised',
      'Groceries',
      'Rent',
      'Dining out · Retired',
    ]);
    pressEscape();
    await settle(fixture);
    await pick(fixture, 'Rent');
    expect((await options(fixture)).map((option) => option.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      'Uncategorised',
      'Groceries',
      'Rent',
    ]);
  });

  it('sends the whole mutable set when the Category changes', async () => {
    const transaction = existing();
    const updated = { ...transaction, categoryId: 3 };
    const refile = vi.fn(() => of(updated));
    const fixture = setup(refile as unknown as TransactionsService['refile'], transaction);
    const emitted: Transaction[] = [];
    fixture.componentInstance.refiled.subscribe((value) => emitted.push(value));
    await pick(fixture, 'Rent');
    await submit(fixture);
    expect(refile).toHaveBeenCalledWith(transaction, {
      date: new Date(2026, 7, 29, 9, 30),
      categoryId: 3,
      description: 'Coffee',
      tagIds: [9],
    });
    expect(emitted).toEqual([updated]);
  });

  it('drops a removed Tag id from the save', async () => {
    const transaction = existing();
    const refile = vi.fn(() => of({ ...transaction, tags: [] }));
    const fixture = setup(refile as unknown as TransactionsService['refile'], transaction);
    (fixture.nativeElement.querySelector('[matChipRemove]') as HTMLButtonElement).click();
    fixture.detectChanges();
    await submit(fixture);
    expect(refile).toHaveBeenCalledWith(transaction, expect.objectContaining({ tagIds: [] }));
  });

  it('corrects the note alone and folds an emptied note to null', async () => {
    const transaction = existing();
    const refile = vi.fn(() => of(transaction));
    let fixture = setup(refile as unknown as TransactionsService['refile'], transaction);
    enter(fixture, '#refile-transaction-note', '  Flat white  ');
    await submit(fixture);
    expect(refile).toHaveBeenCalledWith(transaction, {
      date: new Date(2026, 7, 29, 9, 30),
      categoryId: 1,
      description: 'Flat white',
      tagIds: [9],
    });

    TestBed.resetTestingModule();
    refile.mockClear();
    fixture = setup(refile as unknown as TransactionsService['refile'], transaction);
    enter(fixture, '#refile-transaction-note', '');
    await submit(fixture);
    expect(refile).toHaveBeenCalledWith(transaction, expect.objectContaining({ description: null }));
  });

  it('corrects day and time independently while preserving the other half', async () => {
    const transaction = existing();
    const refile = vi.fn(() => of(transaction));
    let fixture = setup(refile as unknown as TransactionsService['refile'], transaction);
    enter(fixture, '#refile-transaction-date', '8/25/2026');
    await submit(fixture);
    expect(refile).toHaveBeenCalledWith(transaction, expect.objectContaining({ date: new Date(2026, 7, 25, 9, 30) }));

    TestBed.resetTestingModule();
    refile.mockClear();
    fixture = setup(refile as unknown as TransactionsService['refile'], transaction);
    enter(fixture, '#refile-transaction-time', '6:45 PM');
    await submit(fixture);
    expect(refile).toHaveBeenCalledWith(transaction, expect.objectContaining({ date: new Date(2026, 7, 29, 18, 45) }));
  });

  it.each([
    ['#refile-transaction-date', 'Choose a date'],
    ['#refile-transaction-time', 'Choose a time'],
  ])('blocks a cleared required moment field', async (selector, message) => {
    const refile = vi.fn();
    const fixture = setup(refile as unknown as TransactionsService['refile']);
    enter(fixture, selector, '');
    expect((fixture.nativeElement.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(false);
    await submit(fixture);
    expect(refile).not.toHaveBeenCalled();
    expect(text(fixture)).toContain(message);
    expect(document.activeElement).toBe(fixture.nativeElement.querySelector(selector));
  });

  it('sends exactly one request while a refile is in flight', async () => {
    const pending = new Subject<Transaction>();
    const refile = vi.fn(() => pending.asObservable());
    const fixture = setup(refile as unknown as TransactionsService['refile']);
    const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit'));
    form.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    expect(refile).toHaveBeenCalledTimes(1);
  });

  it('reports changed and pending state to the dialog shell', async () => {
    const pending = new Subject<Transaction>();
    const fixture = setup(() => pending);
    const dirty: boolean[] = [];
    const saving: boolean[] = [];
    fixture.componentInstance.dirtyChange.subscribe((value) => dirty.push(value));
    fixture.componentInstance.pendingChange.subscribe((value) => saving.push(value));

    enter(fixture, '#refile-transaction-note', 'Flat white');
    (fixture.nativeElement.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    expect(dirty).toContain(true);
    expect(saving).toEqual([true]);

    pending.next(existing({ description: 'Flat white' }));
    pending.complete();
    await fixture.whenStable();
    expect(saving).toEqual([true, false]);
  });

  it('releases the busy state after an uncertain timeout without retrying', async () => {
    vi.useFakeTimers();
    try {
      let attempts = 0;
      const refile: TransactionsService['refile'] = () => {
        attempts += 1;
        return NEVER;
      };
      const fixture = setup(refile);
      const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;
      form.dispatchEvent(new Event('submit'));
      fixture.detectChanges();
      expect((fixture.nativeElement.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(true);

      await vi.advanceTimersByTimeAsync(15_000);
      await Promise.resolve();
      fixture.detectChanges();

      expect(attempts).toBe(1);
      expect(text(fixture)).toContain('couldn’t confirm whether this Transaction was refiled');
      expect((fixture.nativeElement.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows unattributed and field-attributed failures in the right place', async () => {
    let fixture = setup(() => throwError(() => new ApiError('We could not refile that just now.', 400)));
    await submit(fixture);
    expect(text(fixture)).toContain('We could not refile that just now.');

    TestBed.resetTestingModule();
    fixture = setup(() => throwError(() => new Error('offline')));
    await submit(fixture);
    expect(text(fixture)).toContain(COULD_NOT_REFILE);

    TestBed.resetTestingModule();
    fixture = setup(() => throwError(() => new ApiError('Invalid', 400, { categoryId: ['Choose another category.'] })));
    await submit(fixture);
    expect(text(fixture)).toContain('Choose another category.');
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
  });

  it('refiles a Transfer without a Category', async () => {
    const transfer = existing({
      direction: 'transfer',
      categoryId: null,
      transferToAccountId: 4,
      description: 'Move to savings',
    });
    const refile = vi.fn(() => of(transfer));
    const fixture = setup(refile as unknown as TransactionsService['refile'], transfer);
    expect(text(fixture)).toContain('Transfer');
    expect(fixture.nativeElement.querySelector('mat-select')).toBeNull();
    enter(fixture, '#refile-transaction-note', 'Move to house fund');
    await submit(fixture);
    expect(refile).toHaveBeenCalledWith(transfer, {
      date: new Date(2026, 7, 29, 9, 30),
      categoryId: null,
      description: 'Move to house fund',
      tagIds: [9],
    });
  });

  it('refiles a generated Transaction like any other', async () => {
    const generated = existing({ generated: true, description: 'Rent' });
    const refile = vi.fn(() => of(generated));
    const fixture = setup(refile as unknown as TransactionsService['refile'], generated);
    await pick(fixture, 'Rent');
    await submit(fixture);
    expect(refile).toHaveBeenCalledWith(generated, expect.objectContaining({ categoryId: 3, description: 'Rent' }));
  });

  it('emits cancelled without touching the service', () => {
    const refile = vi.fn();
    const fixture = setup(refile as unknown as TransactionsService['refile']);
    const emitted: unknown[] = [];
    fixture.componentInstance.cancelled.subscribe(() => emitted.push('cancelled'));
    const cancel = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Cancel',
    )!;
    cancel.click();
    expect(emitted).toEqual(['cancelled']);
    expect(refile).not.toHaveBeenCalled();
  });
});
