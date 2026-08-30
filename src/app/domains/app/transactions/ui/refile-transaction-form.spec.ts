import { OutputEmitterRef, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FieldTree } from '@angular/forms/signals';
import { provideNativeDateAdapter } from '@angular/material/core';
import { of, Subject, throwError } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { provideIcons } from '@/app/core/icons';
import { CategoriesService } from '@/app/domains/app/categories/categories.service';
import { Category } from '@/app/domains/app/categories/category';
import { Transaction } from '../data/transaction';
import { TransactionsService } from '../data/transactions.service';
import { RefileTransactionForm } from './refile-transaction-form';

type Model = {
  date: Date | null;
  categoryId: number | null;
  description: string;
};

/** The slice of the component the tests reach into. */
type RefileFormInternals = {
  model: WritableSignal<Model>;
  refileForm: {
    date: FieldTree<Date | null>;
    categoryId: FieldTree<number | null>;
    description: FieldTree<string>;
  };
  categoryOptions: () => Category[];
  isTransfer: () => boolean;
  errorMessage: () => string | null;
  refiled: OutputEmitterRef<Transaction>;
  cancelled: OutputEmitterRef<void>;
  save(event: Event): void;
  cancel(): void;
};

const COULD_NOT_REFILE =
  'Something went wrong re-filing this transaction. Please try again.';

const CATEGORIES: Category[] = [
  { id: 1, name: 'Groceries', kind: 'expense' },
  { id: 2, name: 'Salary', kind: 'income' },
  { id: 3, name: 'Rent', kind: 'expense' },
];

/** The Transaction the row swapped from — an expense, filed, noted, and tagged. */
function existing(over: Partial<Transaction> = {}): Transaction {
  return {
    id: 42,
    amount: 120.5,
    direction: 'expense',
    accountId: 3,
    transferToAccountId: null,
    date: new Date(2026, 7, 29, 9, 30, 0),
    categoryId: 1,
    generated: false,
    description: 'Coffee',
    tags: [{ id: 9, name: 'treats' }],
    ...over,
  };
}

/** The moment the form should send when the day is left untouched: the same day, same time. */
function sameMoment(tx: Transaction): Date {
  const d = tx.date;
  return new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
    d.getHours(),
    d.getMinutes(),
    d.getSeconds(),
    0
  );
}

describe('RefileTransactionForm', () => {
  function setup(
    refile: TransactionsService['refile'],
    transaction: Transaction = existing(),
    list: CategoriesService['list'] = () => of(CATEGORIES)
  ) {
    TestBed.configureTestingModule({
      imports: [RefileTransactionForm],
      providers: [
        provideIcons(),
        provideNativeDateAdapter(),
        { provide: TransactionsService, useValue: { refile } },
        { provide: CategoriesService, useValue: { list } },
      ],
    });

    const fixture = TestBed.createComponent(RefileTransactionForm);
    fixture.componentRef.setInput('transaction', transaction);
    const cmp = fixture.componentInstance as unknown as RefileFormInternals;
    fixture.detectChanges();
    return { fixture, cmp, text: () => (fixture.nativeElement as HTMLElement).textContent ?? '' };
  }

  async function submitAndSettle(
    fixture: { whenStable: () => Promise<unknown> },
    cmp: RefileFormInternals
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

  it('opens carrying the current date, Category, and note', () => {
    const tx = existing();
    const { cmp } = setup(vi.fn(), tx);

    expect(cmp.model()).toEqual({
      date: tx.date,
      categoryId: 1,
      description: 'Coffee',
    });
  });

  it('shows the amount and direction as text, with no field for either', () => {
    const { fixture, text } = setup(vi.fn());

    expect(text()).toContain('Expense');
    expect(text()).toContain('120.50');
    // The amount and direction are settled — no control offers to change them.
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('input[type="number"]')).toBeNull();
    expect(host.querySelector('mat-button-toggle-group')).toBeNull();
  });

  it('points someone who mistyped an amount at removing and recording again', () => {
    const { text } = setup(vi.fn());

    expect(text().toLowerCase()).toContain('remove this transaction and record it again');
  });

  it('offers only expense Categories for an expense', () => {
    const { cmp } = setup(vi.fn(), existing({ direction: 'expense' }));
    expect(cmp.categoryOptions().map((c) => c.id)).toEqual([1, 3]);
  });

  it('offers only income Categories for an income', () => {
    const { cmp } = setup(
      vi.fn(),
      existing({ direction: 'income', categoryId: 2 })
    );
    expect(cmp.categoryOptions().map((c) => c.id)).toEqual([2]);
  });

  it('sends the whole mutable set when only the Category changes, so the note and Tags survive', async () => {
    const tx = existing();
    const refile = vi.fn(() => of(tx));
    const { fixture, cmp } = setup(
      refile as unknown as TransactionsService['refile'],
      tx
    );
    const emitted: Transaction[] = [];
    cmp.refiled.subscribe((t) => emitted.push(t));

    cmp.model.update((m) => ({ ...m, categoryId: 3 }));
    await submitAndSettle(fixture, cmp);

    expect(refile).toHaveBeenCalledWith(tx, {
      date: sameMoment(tx),
      categoryId: 3,
      description: 'Coffee',
      tagIds: [9],
    });
    expect(emitted).toEqual([tx]);
    expect(cmp.errorMessage()).toBeNull();
  });

  it('corrects the note alone, leaving the date and Category as they were', async () => {
    const tx = existing();
    const refile = vi.fn(() => of(tx));
    const { fixture, cmp } = setup(
      refile as unknown as TransactionsService['refile'],
      tx
    );

    cmp.model.update((m) => ({ ...m, description: '  Flat white  ' }));
    await submitAndSettle(fixture, cmp);

    expect(refile).toHaveBeenCalledWith(tx, {
      date: sameMoment(tx),
      categoryId: 1,
      description: 'Flat white',
      tagIds: [9],
    });
  });

  it('corrects the date alone, carrying the original time of day onto the new day', async () => {
    const tx = existing({ date: new Date(2026, 7, 29, 9, 30, 0) });
    const refile = vi.fn(() => of(tx));
    const { fixture, cmp } = setup(
      refile as unknown as TransactionsService['refile'],
      tx
    );

    cmp.model.update((m) => ({ ...m, date: new Date(2026, 7, 25) }));
    await submitAndSettle(fixture, cmp);

    expect(refile).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ date: new Date(2026, 7, 25, 9, 30, 0, 0) })
    );
  });

  it('folds an emptied note back to null rather than an empty string', async () => {
    const tx = existing();
    const refile = vi.fn(() => of(tx));
    const { fixture, cmp } = setup(
      refile as unknown as TransactionsService['refile'],
      tx
    );

    cmp.model.update((m) => ({ ...m, description: '' }));
    await submitAndSettle(fixture, cmp);

    expect(refile).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ description: null })
    );
  });

  it('never reaches the service with the date cleared', async () => {
    const refile = vi.fn();
    const { fixture, cmp } = setup(
      refile as unknown as TransactionsService['refile']
    );

    cmp.model.update((m) => ({ ...m, date: null }));
    await submitAndSettle(fixture, cmp);

    expect(messagesOn(cmp.refileForm.date)).toContain('Choose a date');
    expect(refile).not.toHaveBeenCalled();
  });

  it('sends exactly one request when submitted twice in a row', async () => {
    const inFlight = new Subject<Transaction>();
    const refile = vi.fn(() => inFlight.asObservable());
    const { fixture, cmp } = setup(
      refile as unknown as TransactionsService['refile']
    );

    cmp.save(new Event('submit'));
    cmp.save(new Event('submit'));
    await fixture.whenStable();

    expect(refile).toHaveBeenCalledTimes(1);
  });

  it('shows a bodyless rejection as one form-level line that blames no field', async () => {
    const { fixture, cmp } = setup(() =>
      throwError(() => new ApiError('We could not re-file that just now.', 400, {}))
    );

    await submitAndSettle(fixture, cmp);

    expect(cmp.errorMessage()).toBe('We could not re-file that just now.');
    expect(cmp.refileForm.date().errors()).toEqual([]);
    expect(cmp.refileForm.categoryId().errors()).toEqual([]);
  });

  it('falls back to the generic banner when the failure is not an ApiError', async () => {
    const { fixture, cmp } = setup(() => throwError(() => new Error('offline')));

    await submitAndSettle(fixture, cmp);

    expect(cmp.errorMessage()).toBe(COULD_NOT_REFILE);
  });

  it('marks the field for a rejection the API can attribute', async () => {
    const { fixture, cmp } = setup(() =>
      throwError(
        () =>
          new ApiError('Please correct the highlighted field.', 400, {
            categoryId: ['That category is not yours.'],
          })
      )
    );

    await submitAndSettle(fixture, cmp);

    expect(messagesOn(cmp.refileForm.categoryId)).toContain(
      'That category is not yours.'
    );
    expect(cmp.errorMessage()).toBeNull();
  });

  describe('a Transfer', () => {
    const transfer = existing({
      direction: 'transfer',
      categoryId: null,
      transferToAccountId: 9,
      description: 'Move to savings',
    });

    it('asks for no Category and reads as a Transfer', () => {
      const { fixture, cmp, text } = setup(vi.fn(), transfer);

      expect(cmp.isTransfer()).toBe(true);
      expect(text()).toContain('Transfer');
      expect(
        (fixture.nativeElement as HTMLElement).querySelector('mat-select')
      ).toBeNull();
    });

    it('re-files with a null Category and the untouched destination-side fields', async () => {
      const refile = vi.fn(() => of(transfer));
      const { fixture, cmp } = setup(
        refile as unknown as TransactionsService['refile'],
        transfer
      );

      cmp.model.update((m) => ({ ...m, description: 'Move to house fund' }));
      await submitAndSettle(fixture, cmp);

      expect(refile).toHaveBeenCalledWith(transfer, {
        date: sameMoment(transfer),
        categoryId: null,
        description: 'Move to house fund',
        tagIds: [9],
      });
    });
  });

  it('re-files a generated transaction like any other', async () => {
    const generated = existing({ generated: true, description: 'Rent' });
    const refile = vi.fn(() => of(generated));
    const { fixture, cmp } = setup(
      refile as unknown as TransactionsService['refile'],
      generated
    );

    cmp.model.update((m) => ({ ...m, categoryId: 3 }));
    await submitAndSettle(fixture, cmp);

    expect(refile).toHaveBeenCalledWith(
      generated,
      expect.objectContaining({ categoryId: 3, description: 'Rent' })
    );
  });

  it('emits cancelled without touching the service', () => {
    const refile = vi.fn();
    const { cmp } = setup(refile as unknown as TransactionsService['refile']);
    const emitted: unknown[] = [];
    cmp.cancelled.subscribe(() => emitted.push('cancelled'));

    cmp.cancel();

    expect(emitted).toEqual(['cancelled']);
    expect(refile).not.toHaveBeenCalled();
  });
});
