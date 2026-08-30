import {
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { form, FormField, min, required, submit } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTimepickerModule } from '@angular/material/timepicker';
import { firstValueFrom } from 'rxjs';
import { partitionServerError, ServerErrorControls } from '@/app/core/forms';
import { CategoriesService } from '@/app/domains/app/categories/categories.service';
import { Category } from '@/app/domains/app/categories/category';
import {
  NewTransaction,
  Transaction,
  TransactionDirection,
  TRANSACTION_DIRECTIONS,
} from '../data/transaction';
import { TransactionsService } from '../data/transactions.service';

/** The banner line for a record that failed before it could be attributed. */
const COULD_NOT_RECORD =
  'Something went wrong recording this transaction. Please try again.';

/** Shown under the Category picker when the reference list could not be read. */
const CATEGORIES_UNAVAILABLE =
  'Categories could not be loaded, so there is nothing to file this under. Please try again.';

/**
 * The directions this form offers. Transfer follows in a later slice (#26); it
 * needs a destination-Account picker and its own field set. Expense leads —
 * it is the movement a person records most.
 */
const DIRECTION_OPTIONS: { value: TransactionDirection; label: string }[] = [
  { value: 'expense', label: TRANSACTION_DIRECTIONS.expense.label },
  { value: 'income', label: TRANSACTION_DIRECTIONS.income.label },
];

/**
 * `date` and `time` are held apart so each is its own required control — an
 * omitted time is not allowed to mean midnight (ADR 0007) — and recombined into
 * one moment on submit. Both start at "now"; `categoryId` starts unset so the
 * picker shows nothing the person did not choose.
 */
type RecordTransactionModel = {
  direction: TransactionDirection;
  amount: number;
  date: Date | null;
  time: Date | null;
  categoryId: number | null;
};

/**
 * The inline "record a Transaction" form, revealed on an Account's detail screen
 * by a signal — the same reveal-and-swap the Accounts slice uses, no dialog. It
 * owns only the form; the parent supplies the Account (there is no Account
 * field — a form that recorded into an Account you are not looking at would
 * leave you on a list without the row) and, on success, re-reads the balance
 * and list in place.
 *
 * Direction is the first control and decides the rest: an income or an expense
 * is filed under a Category, and the picker offers only Categories of that
 * direction (ADR 0010), so an expense cannot be filed under a salary. The amount
 * is entered positive — the sign is the direction's, never a minus the person
 * types. `submit()` refuses re-entry and the button disables while a request is
 * in flight, so a double-click records once. A rejection the API attributes to a
 * field marks it; a bodyless one becomes a single form-level line.
 */
@Component({
  selector: 'transactions-record-transaction-form',
  templateUrl: './record-transaction-form.html',
  imports: [
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatDatepickerModule,
    MatTimepickerModule,
    MatIconModule,
    FormField,
  ],
})
export class RecordTransactionForm {
  // Dependencies
  private service = inject(TransactionsService);
  private categoriesService = inject(CategoriesService);
  private destroyRef = inject(DestroyRef);

  // Inputs
  /** The Account the Transaction is recorded against. The form has no field for it. */
  readonly accountId = input.required<number>();

  // Outputs
  readonly recorded = output<Transaction>();
  readonly cancelled = output<void>();

  // State
  protected readonly directionOptions = DIRECTION_OPTIONS;

  /** Every Category, each with its `kind`; filtered per direction for the picker. */
  private readonly categories = signal<readonly Category[]>([]);

  /** True when the reference list failed to load — the picker has nothing to show. */
  protected readonly categoriesFailed = signal(false);
  protected readonly categoriesUnavailable = CATEGORIES_UNAVAILABLE;

  protected readonly model = signal<RecordTransactionModel>({
    direction: 'expense',
    amount: 0,
    date: new Date(),
    time: new Date(),
    categoryId: null,
  });

  /** Only the Categories matching the chosen direction (ADR 0010). */
  protected readonly categoryOptions = computed(() => {
    const direction = this.model().direction;
    return this.categories().filter((category) => category.kind === direction);
  });

  protected readonly recordForm = form(this.model, (path) => {
    min(path.amount, 0.01, {
      message: 'Enter an amount greater than zero',
    });
    required(path.date, { message: 'Choose a date' });
    required(path.time, { message: 'Choose a time' });
    required(path.categoryId, {
      message: 'Choose a category',
      // A Transfer carries none (ADR 0010); every other direction must.
      when: ({ valueOf }) => valueOf(path.direction) !== 'transfer',
    });
  });

  protected readonly submitting = signal(false);

  /** The form-level banner. Linked to the model so any edit clears a stale message. */
  protected readonly errorMessage = linkedSignal<
    RecordTransactionModel,
    string | null
  >({
    source: this.model,
    computation: () => null,
  });

  constructor() {
    this.categoriesService
      .list()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (categories) => this.categories.set(categories),
        error: () => this.categoriesFailed.set(true),
      });

    // Changing direction re-filters the picker; a Category from the old
    // direction must not ride along and file, say, an expense under a salary.
    effect(() => {
      const valid = new Set(this.categoryOptions().map((category) => category.id));
      if (
        this.model().categoryId !== null &&
        !valid.has(this.model().categoryId as number)
      ) {
        this.model.update((model) => ({ ...model, categoryId: null }));
      }
    });
  }

  save(event: Event): void {
    event.preventDefault();

    submit(this.recordForm, {
      action: async () => {
        this.submitting.set(true);
        this.errorMessage.set(null);

        try {
          const { direction, amount, date, time, categoryId } = this.model();
          const recorded = await firstValueFrom(
            this.service.record({
              accountId: this.accountId(),
              direction,
              amount,
              // `required` has already ruled out a null date or time.
              date: combineDateTime(date as Date, time as Date),
              categoryId,
              transferToAccountId: null,
            } satisfies NewTransaction)
          );
          this.recorded.emit(recorded);
          return undefined;
        } catch (error) {
          const { boundErrors, bannerMessage } = partitionServerError(
            error,
            this.serverErrorControls(),
            COULD_NOT_RECORD
          );
          if (boundErrors.length > 0) {
            this.recordForm().markAsTouched();
          }
          if (bannerMessage !== null) {
            this.errorMessage.set(bannerMessage);
          }
          return boundErrors.length > 0 ? boundErrors : undefined;
        } finally {
          this.submitting.set(false);
        }
      },
    });
  }

  protected cancel(): void {
    this.cancelled.emit();
  }

  /**
   * The controls a server-blamed field can bind onto. The interceptor has
   * camelCased the API's keys; the create endpoint's timestamp rejection comes
   * back as `transactionDate`, which pins onto the date control.
   */
  private serverErrorControls(): ServerErrorControls {
    return {
      amount: this.recordForm.amount,
      categoryId: this.recordForm.categoryId,
      date: this.recordForm.date,
      transactionDate: this.recordForm.date,
    };
  }
}

/**
 * Fold the two controls back into one moment: the calendar day from `date`, the
 * wall-clock from `time`. Seconds are dropped — the person set minutes.
 */
function combineDateTime(date: Date, time: Date): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    time.getHours(),
    time.getMinutes(),
    0,
    0
  );
}
