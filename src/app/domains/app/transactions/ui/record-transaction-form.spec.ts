import { OutputEmitterRef, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FieldTree } from '@angular/forms/signals';
import { provideNativeDateAdapter } from '@angular/material/core';
import { of, Subject, throwError } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { provideIcons } from '@/app/core/icons';
import { CategoriesService } from '@/app/domains/app/categories/categories.service';
import { Category } from '@/app/domains/app/categories/category';
import {
  Transaction,
  TransactionDirection,
  TransferDestinationAccount,
} from '../data/transaction';
import { TransactionsService } from '../data/transactions.service';
import { RecordTransactionForm } from './record-transaction-form';

type Model = {
  direction: TransactionDirection;
  amount: number | null;
  date: Date | null;
  time: Date | null;
  categoryId: number | null;
  transferToAccountId: number | null;
};

/** The slice of the component the tests reach into. */
type RecordFormInternals = {
  model: WritableSignal<Model>;
  recordForm: {
    amount: FieldTree<number>;
    date: FieldTree<Date | null>;
    time: FieldTree<Date | null>;
    categoryId: FieldTree<number | null>;
    transferToAccountId: FieldTree<number | null>;
  };
  categoryOptions: () => Category[];
  destinationOptions: () => TransferDestinationAccount[];
  errorMessage: () => string | null;
  recorded: OutputEmitterRef<Transaction>;
  cancelled: OutputEmitterRef<void>;
  save(event: Event): void;
  cancel(): void;
};

const COULD_NOT_RECORD =
  'Something went wrong recording this transaction. Please try again.';

const CATEGORIES: Category[] = [
  { id: 1, name: 'Groceries', kind: 'expense' },
  { id: 2, name: 'Salary', kind: 'income' },
  { id: 3, name: 'Rent', kind: 'expense' },
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

/**
 * The Account pool the screen hands the form. Id 3 is the one in view — it must
 * never be offered as a Transfer destination — id 5 is retired, and ids 4 and 6
 * are the two the destination picker should actually show.
 */
const ACCOUNTS: TransferDestinationAccount[] = [
  { id: 3, name: 'Everyday cash', isActive: true },
  { id: 4, name: 'Savings', isActive: true },
  { id: 5, name: 'Old wallet', isActive: false },
  { id: 6, name: 'Joint account', isActive: true },
];

/** A day at midnight and a time-of-day, as the two pickers hand them over. */
const DAY = new Date(2026, 7, 29);
const AT_1405 = new Date(2000, 0, 1, 14, 5);
/** What the form should send once it folds `DAY` and `AT_1405` together. */
const COMBINED = new Date(2026, 7, 29, 14, 5, 0, 0);

describe('RecordTransactionForm', () => {
  function setup(
    record: TransactionsService['record'],
    list: CategoriesService['list'] = () => of(CATEGORIES),
    accounts: TransferDestinationAccount[] = ACCOUNTS
  ) {
    TestBed.configureTestingModule({
      imports: [RecordTransactionForm],
      providers: [
        provideIcons(),
        provideNativeDateAdapter(),
        { provide: TransactionsService, useValue: { record } },
        { provide: CategoriesService, useValue: { list } },
      ],
    });

    const fixture = TestBed.createComponent(RecordTransactionForm);
    fixture.componentRef.setInput('accountId', 3);
    fixture.componentRef.setInput('accounts', accounts);
    const cmp = fixture.componentInstance as unknown as RecordFormInternals;
    fixture.detectChanges();
    return { fixture, cmp };
  }

  async function submitAndSettle(
    fixture: { whenStable: () => Promise<unknown> },
    cmp: RecordFormInternals
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

  function fill(cmp: RecordFormInternals, over: Partial<Model> = {}) {
    cmp.model.set({
      direction: 'expense',
      amount: 120.5,
      date: DAY,
      time: AT_1405,
      categoryId: 1,
      transferToAccountId: null,
      ...over,
    });
  }

  it('offers only Categories of the chosen direction, and re-filters when it changes', async () => {
    const { fixture, cmp } = setup(vi.fn());

    expect(cmp.categoryOptions().map((c) => c.id)).toEqual([1, 3]);

    cmp.model.update((m) => ({ ...m, direction: 'income' }));
    await fixture.whenStable();

    expect(cmp.categoryOptions().map((c) => c.id)).toEqual([2]);
  });

  it('drops a Category left over from the previous direction', async () => {
    const { fixture, cmp } = setup(vi.fn());

    fill(cmp, { direction: 'expense', categoryId: 1 });
    await fixture.whenStable();
    cmp.model.update((m) => ({ ...m, direction: 'income' }));
    await fixture.whenStable();

    expect(cmp.model().categoryId).toBeNull();
  });

  it('records an expense: a positive amount, its Category, and the day and time folded into one moment', async () => {
    const record = vi.fn((_tx) => of(RECORDED));
    const { fixture, cmp } = setup(
      record as unknown as TransactionsService['record']
    );
    const emitted: Transaction[] = [];
    cmp.recorded.subscribe((tx) => emitted.push(tx));

    fill(cmp, { direction: 'expense', amount: 120.5, categoryId: 1 });
    await submitAndSettle(fixture, cmp);

    expect(record).toHaveBeenCalledWith({
      accountId: 3,
      direction: 'expense',
      amount: 120.5,
      date: COMBINED,
      categoryId: 1,
      transferToAccountId: null,
    });
    expect(emitted).toEqual([RECORDED]);
    expect(cmp.errorMessage()).toBeNull();
  });

  it('records an income against the same endpoint, differing only by direction and Category', async () => {
    const record = vi.fn((_tx) => of({ ...RECORDED, direction: 'income' }));
    const { fixture, cmp } = setup(
      record as unknown as TransactionsService['record']
    );

    fill(cmp, { direction: 'income', amount: 5000, categoryId: 2 });
    await submitAndSettle(fixture, cmp);

    expect(record).toHaveBeenCalledWith({
      accountId: 3,
      direction: 'income',
      amount: 5000,
      date: COMBINED,
      categoryId: 2,
      transferToAccountId: null,
    });
  });

  it('never reaches the service with the amount left blank', async () => {
    const record = vi.fn();
    const { fixture, cmp } = setup(
      record as unknown as TransactionsService['record']
    );

    fill(cmp, { amount: null });
    await submitAndSettle(fixture, cmp);

    expect(messagesOn(cmp.recordForm.amount)).toContain(
      'Enter an amount greater than zero'
    );
    expect(record).not.toHaveBeenCalled();
  });

  it('never reaches the service for an amount of zero', async () => {
    const record = vi.fn();
    const { fixture, cmp } = setup(
      record as unknown as TransactionsService['record']
    );

    fill(cmp, { amount: 0 });
    await submitAndSettle(fixture, cmp);

    expect(messagesOn(cmp.recordForm.amount)).toContain(
      'Enter an amount greater than zero'
    );
    expect(record).not.toHaveBeenCalled();
  });

  it('never reaches the service for a negative amount — the sign is the direction’s', async () => {
    const record = vi.fn();
    const { fixture, cmp } = setup(
      record as unknown as TransactionsService['record']
    );

    fill(cmp, { amount: -120.5 });
    await submitAndSettle(fixture, cmp);

    expect(messagesOn(cmp.recordForm.amount)).toContain(
      'Enter an amount greater than zero'
    );
    expect(record).not.toHaveBeenCalled();
  });

  it('never reaches the service with no Category chosen', async () => {
    const record = vi.fn();
    const { fixture, cmp } = setup(
      record as unknown as TransactionsService['record']
    );

    fill(cmp, { categoryId: null });
    await submitAndSettle(fixture, cmp);

    expect(messagesOn(cmp.recordForm.categoryId)).toContain('Choose a category');
    expect(record).not.toHaveBeenCalled();
  });

  it('never reaches the service with the date cleared', async () => {
    const record = vi.fn();
    const { fixture, cmp } = setup(
      record as unknown as TransactionsService['record']
    );

    fill(cmp, { date: null });
    await submitAndSettle(fixture, cmp);

    expect(messagesOn(cmp.recordForm.date)).toContain('Choose a date');
    expect(record).not.toHaveBeenCalled();
  });

  it('never reaches the service with the time cleared — an omitted time is not midnight', async () => {
    const record = vi.fn();
    const { fixture, cmp } = setup(
      record as unknown as TransactionsService['record']
    );

    fill(cmp, { time: null });
    await submitAndSettle(fixture, cmp);

    expect(messagesOn(cmp.recordForm.time)).toContain('Choose a time');
    expect(record).not.toHaveBeenCalled();
  });

  it('sends exactly one request when submitted twice in a row', async () => {
    const inFlight = new Subject<Transaction>();
    const record = vi.fn(() => inFlight.asObservable());
    const { fixture, cmp } = setup(
      record as unknown as TransactionsService['record']
    );

    fill(cmp);
    cmp.save(new Event('submit'));
    cmp.save(new Event('submit'));
    await fixture.whenStable();

    expect(record).toHaveBeenCalledTimes(1);
  });

  it('shows a bodyless rejection as one form-level line that blames no field', async () => {
    const { fixture, cmp } = setup(() =>
      throwError(() => new ApiError('We could not record that just now.', 400, {}))
    );

    fill(cmp);
    await submitAndSettle(fixture, cmp);

    expect(cmp.errorMessage()).toBe('We could not record that just now.');
    expect(cmp.recordForm.amount().errors()).toEqual([]);
    expect(cmp.recordForm.categoryId().errors()).toEqual([]);
    expect(cmp.recordForm.date().errors()).toEqual([]);
  });

  it('falls back to the generic banner when the failure is not an ApiError', async () => {
    const { fixture, cmp } = setup(() => throwError(() => new Error('offline')));

    fill(cmp);
    await submitAndSettle(fixture, cmp);

    expect(cmp.errorMessage()).toBe(COULD_NOT_RECORD);
  });

  it('marks the field for a rejection the API can attribute', async () => {
    const { fixture, cmp } = setup(() =>
      throwError(
        () =>
          new ApiError('Please correct the highlighted field.', 400, {
            amount: ['That is more than this account holds.'],
          })
      )
    );

    fill(cmp);
    await submitAndSettle(fixture, cmp);

    expect(messagesOn(cmp.recordForm.amount)).toContain(
      'That is more than this account holds.'
    );
    expect(cmp.errorMessage()).toBeNull();
  });

  describe('transfer', () => {
    it('offers every active Account except the one in view, and no retired one', () => {
      const { cmp } = setup(vi.fn());

      cmp.model.update((m) => ({ ...m, direction: 'transfer' }));

      expect(cmp.destinationOptions().map((a) => a.id)).toEqual([4, 6]);
    });

    it('does not ask for a Category, and does ask for a destination', async () => {
      const record = vi.fn();
      const { fixture, cmp } = setup(
        record as unknown as TransactionsService['record']
      );

      fill(cmp, {
        direction: 'transfer',
        categoryId: null,
        transferToAccountId: null,
      });
      await submitAndSettle(fixture, cmp);

      // A missing Category is not what stops this submission…
      expect(messagesOn(cmp.recordForm.categoryId)).toEqual([]);
      // …a missing destination is.
      expect(messagesOn(cmp.recordForm.transferToAccountId)).toContain(
        'Choose a destination account'
      );
      expect(record).not.toHaveBeenCalled();
    });

    it('records a Transfer: a destination Account and a null Category', async () => {
      const record = vi.fn((_tx) => of({ ...RECORDED, direction: 'transfer' }));
      const { fixture, cmp } = setup(
        record as unknown as TransactionsService['record']
      );

      fill(cmp, {
        direction: 'transfer',
        amount: 750,
        categoryId: null,
        transferToAccountId: 4,
      });
      await submitAndSettle(fixture, cmp);

      expect(record).toHaveBeenCalledWith({
        accountId: 3,
        direction: 'transfer',
        amount: 750,
        date: COMBINED,
        categoryId: null,
        transferToAccountId: 4,
      });
    });

    it('sends a null Category even if one was chosen before the switch to Transfer', async () => {
      const record = vi.fn((_tx) => of({ ...RECORDED, direction: 'transfer' }));
      const { fixture, cmp } = setup(
        record as unknown as TransactionsService['record']
      );

      // A Category picked as an expense, then the direction flipped.
      fill(cmp, { direction: 'expense', categoryId: 1 });
      await fixture.whenStable();
      cmp.model.update((m) => ({
        ...m,
        direction: 'transfer',
        transferToAccountId: 6,
      }));
      await submitAndSettle(fixture, cmp);

      expect(record).toHaveBeenCalledWith(
        expect.objectContaining({ categoryId: null, transferToAccountId: 6 })
      );
    });

    it('drops a destination left over from a switch back to an expense', async () => {
      const { fixture, cmp } = setup(vi.fn());

      fill(cmp, { direction: 'transfer', transferToAccountId: 4 });
      await fixture.whenStable();
      cmp.model.update((m) => ({ ...m, direction: 'expense' }));
      await fixture.whenStable();

      expect(cmp.model().transferToAccountId).toBeNull();
    });
  });

  it('emits cancelled without touching the service', () => {
    const record = vi.fn();
    const { cmp } = setup(record as unknown as TransactionsService['record']);
    const emitted: unknown[] = [];
    cmp.cancelled.subscribe(() => emitted.push('cancelled'));

    cmp.cancel();

    expect(emitted).toEqual(['cancelled']);
    expect(record).not.toHaveBeenCalled();
  });
});
