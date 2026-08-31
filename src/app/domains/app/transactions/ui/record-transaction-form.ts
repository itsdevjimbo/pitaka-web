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
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTimepickerModule } from '@angular/material/timepicker';
import { firstValueFrom } from 'rxjs';
import { partitionServerError, ServerErrorControls } from '@/app/core/forms';
import { CategoriesService } from '@/app/domains/app/categories/categories.service';
import { Category } from '@/app/domains/app/categories/category';
import { combineDateTime } from '../data/combine-date-time';
import {
  NewTransaction,
  Transaction,
  TransactionDirection,
  TRANSACTION_DIRECTIONS,
  TransferDestinationAccount,
} from '../data/transaction';
import { TransactionsService } from '../data/transactions.service';

/** The banner line for a record that failed before it could be attributed. */
const COULD_NOT_RECORD =
  'Something went wrong recording this transaction. Please try again.';

/**
 * The directions this form offers, in display order — expense leads, being the
 * movement a person records most, then income, then Transfer. Choosing Transfer
 * swaps the Category field for a destination Account: a Transfer is neither
 * income nor expense, so no Category could classify one (ADR 0010). Derived from
 * the canonical record so a label only ever lives in one place.
 */
const DIRECTION_OPTIONS = (['expense', 'income', 'transfer'] as const).map(
  (value) => ({ value, label: TRANSACTION_DIRECTIONS[value].label })
);

/**
 * `date` and `time` are held apart so each is its own required control — an
 * omitted time is not allowed to mean midnight (ADR 0007) — and recombined into
 * one moment on submit. Both start at "now". `categoryId` and
 * `transferToAccountId` start unset so the pickers show nothing the person did
 * not choose; the direction decides which of the two is asked for and required.
 */
type RecordTransactionModel = {
  direction: TransactionDirection;
  amount: number | null;
  date: Date | null;
  time: Date | null;
  categoryId: number | null;
  transferToAccountId: number | null;
};

/**
 * The "record a Transaction" form, rendered inside the record-transaction dialog
 * over an Account's detail screen. It owns only the form: the screen supplies
 * the Account the money moves from as a plain value (the form has no field for
 * it and does not reason about which Account it belongs to), hands down the
 * Transfer destinations already narrowed to the valid ones, and on success
 * closes the dialog and re-reads the balance and list.
 *
 * Direction is the first control and decides the rest. An income or an expense
 * is filed under a Category, and the picker offers only Categories of that
 * direction (ADR 0010), so an expense cannot be filed under a salary. A Transfer
 * swaps that Category field for a destination Account and sends no Category; the
 * destination picker shows exactly the Accounts the screen handed it — the one
 * in view and every retired one already excluded upstream — so the form does no
 * filtering of its own. The amount is entered positive — the sign is the
 * direction's, never a minus the person types. `submit()` refuses re-entry and
 * the button disables while a request is in flight, so a double-click records
 * once. A rejection the API attributes to a field marks it; a bodyless one
 * becomes a single form-level line.
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
    FormField,
  ],
})
export class RecordTransactionForm {
  // Dependencies
  private service = inject(TransactionsService);
  private categoriesService = inject(CategoriesService);
  private destroyRef = inject(DestroyRef);

  // Inputs

  /**
   * The Account the money moves from, carried as a plain value the way `amount`
   * is. The form has no field for it and does not decide which Account it
   * belongs to — the screen does, and passes the id down.
   */
  readonly fromAccountId = input.required<number>();

  /**
   * The Accounts a Transfer may land in, already narrowed to the valid ones by
   * the screen (the Transactions domain does not read Accounts — ADR 0009). The
   * form shows exactly this list and filters nothing.
   */
  readonly destinations = input<readonly TransferDestinationAccount[]>([]);

  // Outputs
  readonly recorded = output<Transaction>();
  readonly cancelled = output<void>();

  // State
  protected readonly directionOptions = DIRECTION_OPTIONS;

  /**
   * Every Category, each with its `kind`; filtered per direction for the picker.
   * From the shared reference cache, which the detail screen has already
   * resolved for the row list before this form can open, so `list()` replays a
   * settled value rather than making its own request.
   */
  private readonly categories = signal<readonly Category[]>([]);

  protected readonly model = signal<RecordTransactionModel>({
    direction: 'expense',
    amount: null,
    date: new Date(),
    time: new Date(),
    categoryId: null,
    transferToAccountId: null,
  });

  /** True while the chosen direction is Transfer — the form asks for a destination, not a Category. */
  protected readonly isTransfer = computed(
    () => this.model().direction === 'transfer'
  );

  /** Only the Categories matching the chosen direction (ADR 0010). */
  protected readonly categoryOptions = computed(() => {
    const direction = this.model().direction;
    return this.categories().filter((category) => category.kind === direction);
  });

  /**
   * The Accounts the destination picker offers: exactly what the screen handed
   * down (already narrowed to valid destinations), and nothing off a Transfer —
   * there is no destination to pick, which is also what lets one stale-pick
   * pruner serve both this field and the Category.
   */
  protected readonly destinationOptions = computed(() =>
    this.isTransfer() ? this.destinations() : []
  );

  protected readonly recordForm = form(this.model, (path) => {
    // Entered positive — the sign is the direction's, never a minus the person
    // types. `required` covers a cleared field, `min` a zero or a negative.
    required(path.amount, { message: 'Enter an amount greater than zero' });
    min(path.amount, 0.01, { message: 'Enter an amount greater than zero' });
    required(path.date, { message: 'Choose a date' });
    required(path.time, { message: 'Choose a time' });
    // The direction decides which of the last two is asked for: an income or an
    // expense is filed under a Category, a Transfer names a destination Account
    // instead, and never both (ADR 0010).
    required(path.categoryId, {
      message: 'Choose a category',
      when: ({ valueOf }) => valueOf(path.direction) !== 'transfer',
    });
    required(path.transferToAccountId, {
      message: 'Choose a destination account',
      when: ({ valueOf }) => valueOf(path.direction) === 'transfer',
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
      .subscribe((categories) => this.categories.set(categories));

    // A picked id must not outlive the direction that made it valid: a Category
    // from the old direction would file, say, an expense under a salary; a
    // destination left over from a Transfer would ride along on an income. Each
    // picker empties when it no longer applies, so pruning to its options
    // covers the direction switch too.
    effect(() =>
      this.pruneStalePick('categoryId', this.categoryOptions())
    );
    effect(() =>
      this.pruneStalePick('transferToAccountId', this.destinationOptions())
    );
  }

  /** Null a picked id its picker no longer offers. */
  private pruneStalePick(
    key: 'categoryId' | 'transferToAccountId',
    options: readonly { id: number }[]
  ): void {
    const picked = this.model()[key];
    if (picked !== null && !options.some((option) => option.id === picked)) {
      this.model.update((model) => ({ ...model, [key]: null }));
    }
  }

  save(event: Event): void {
    event.preventDefault();

    submit(this.recordForm, {
      action: async () => {
        this.submitting.set(true);
        this.errorMessage.set(null);

        try {
          const { direction, amount, date, time, categoryId, transferToAccountId } =
            this.model();
          // Derive the mutually exclusive pair straight from `direction`, the
          // field being submitted: the stale-pick pruners reconcile the siblings
          // too, but they run as effects and need not have flushed by the time
          // an eager submit reads the model. The adapter enforces the same rule
          // once more on the wire (ADR 0010).
          const isTransfer = direction === 'transfer';
          const recorded = await firstValueFrom(
            this.service.record({
              accountId: this.fromAccountId(),
              direction,
              // `required` / `min` have ruled out a null amount and a null
              // date or time by the time the action runs.
              amount: amount as number,
              date: combineDateTime(date as Date, time as Date),
              categoryId: isTransfer ? null : categoryId,
              transferToAccountId: isTransfer ? transferToAccountId : null,
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
      transferToAccountId: this.recordForm.transferToAccountId,
      date: this.recordForm.date,
      transactionDate: this.recordForm.date,
    };
  }
}
