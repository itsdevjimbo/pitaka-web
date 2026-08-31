import {
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { form, FormField, required, submit } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTimepickerModule } from '@angular/material/timepicker';
import { firstValueFrom } from 'rxjs';
import { partitionServerError, ServerErrorControls } from '@/app/core/forms';
import { PesoPipe } from '@/app/core/money';
import { CategoriesService } from '@/app/domains/app/categories/categories.service';
import { Category } from '@/app/domains/app/categories/category';
import { combineDateTime } from '../data/combine-date-time';
import {
  RefileTransaction,
  Transaction,
  TRANSACTION_DIRECTIONS,
} from '../data/transaction';
import { TransactionsService } from '../data/transactions.service';

/** The banner line for a refile that failed before it could be attributed. */
const COULD_NOT_REFILE =
  'Something went wrong refiling this transaction. Please try again.';

/**
 * What the refile form edits. The amount and the direction are not here — they
 * were settled at recording and the form shows them as the row's own text, not
 * as fields (see `CONTEXT.md`). `date` and `time` are held apart, each its own
 * required control — an omitted time is not allowed to mean midnight (ADR 0007)
 * — and both are seeded from the Transaction's moment so a person can move
 * either. `description` is a plain string — empty means "clear the note", folded
 * back to `null` on submit.
 */
type RefileTransactionModel = {
  date: Date | null;
  time: Date | null;
  categoryId: number | null;
  description: string;
};

/**
 * The "refile this Transaction" form, rendered inside the refile-transaction
 * dialog over an Account's detail screen — the row stays legible behind it
 * rather than being replaced by the form. It corrects *how* a Transaction is
 * filed — when it is dated, its Category, its note — never what moved. The
 * amount and the direction are shown as plain text, deliberately not as disabled
 * inputs that invite a click and then refuse it; someone who mistyped an amount
 * is pointed at removing and recording again, the only correction that can
 * legitimately move a balance (ADR 0009).
 *
 * Every submit sends the whole mutable set — a full replacement, never a patch —
 * so correcting one field cannot null another (the adapter and its spec carry
 * that contract). A Transfer is refiled only from the Account it was recorded
 * against; the screen offers this form nowhere else, and the adapter still
 * forces a Transfer's Category to null on the wire (ADR 0010). Tags have no
 * entry surface in this slice, so the Transaction's current Tag ids ride along
 * unchanged.
 *
 * Removing a Transaction is **not** done here. An earlier slice (story 32) put
 * the *Remove* button in this form's footer, reasoning that removal inherited
 * the form's "recorded against" placement for free. That rationale is now
 * rejected (ADR 0014): a destructive control must not sit directly beneath the
 * fields someone was just typing into, and erasing is not editing. Remove lives
 * on the row's own menu, confirmed on the row. This form has no removal button,
 * no removal confirmation, and no `removed` output.
 *
 * On a successful refile the parent re-reads the balance and list in place
 * (ADR 0006); the form itself never touches a balance.
 */
@Component({
  selector: 'transactions-refile-transaction-form',
  templateUrl: './refile-transaction-form.html',
  imports: [
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatDatepickerModule,
    MatTimepickerModule,
    PesoPipe,
    FormField,
  ],
})
export class RefileTransactionForm {
  // Dependencies
  private service = inject(TransactionsService);
  private categoriesService = inject(CategoriesService);
  private destroyRef = inject(DestroyRef);

  // Inputs
  /** The Transaction being corrected, as it stands now. */
  readonly transaction = input.required<Transaction>();

  // Outputs
  readonly refiled = output<Transaction>();
  readonly cancelled = output<void>();

  // State
  protected readonly directions = TRANSACTION_DIRECTIONS;

  /**
   * Every Category with its `kind`, from the shared reference cache the detail
   * screen has already resolved for the row list — so this replays a settled
   * value rather than making its own request.
   */
  private readonly categories = signal<readonly Category[]>([]);

  /** True while the Transaction being corrected is a Transfer — no Category field, none sent. */
  protected readonly isTransfer = computed(
    () => this.transaction().direction === 'transfer'
  );

  /** Only the Categories matching this Transaction's direction (ADR 0010). */
  protected readonly categoryOptions = computed(() => {
    const direction = this.transaction().direction;
    return this.categories().filter((category) => category.kind === direction);
  });

  /**
   * Seeded from the Transaction and re-seeded if the input changes: the form
   * opens carrying the current moment, Category and note, so a person who
   * changes one leaves the rest exactly as they were. The Transaction's single
   * `date` fills both the day and the time controls.
   */
  protected readonly model = linkedSignal<RefileTransactionModel>(() => ({
    date: this.transaction().date,
    time: this.transaction().date,
    categoryId: this.transaction().categoryId,
    description: this.transaction().description ?? '',
  }));

  protected readonly refileForm = form(this.model, (path) => {
    // Day and time are each compulsory — a Transaction always has both, and an
    // omitted time is not allowed to mean midnight (ADR 0007). A Category may be
    // corrected to "none" and a note may be emptied, so neither is required.
    required(path.date, { message: 'Choose a date' });
    required(path.time, { message: 'Choose a time' });
  });

  protected readonly submitting = signal(false);

  /** The form-level banner. Linked to the model so any edit clears a stale message. */
  protected readonly errorMessage = linkedSignal<
    RefileTransactionModel,
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
  }

  save(event: Event): void {
    event.preventDefault();

    submit(this.refileForm, {
      action: async () => {
        this.submitting.set(true);
        this.errorMessage.set(null);

        try {
          const { date, time, categoryId, description } = this.model();
          const refiled = await firstValueFrom(
            this.service.refile(this.transaction(), {
              // `required` has ruled out a null day or time by the time this
              // runs; fold the two controls back into one moment.
              date: combineDateTime(date as Date, time as Date),
              categoryId,
              description: description.trim() || null,
              // No Tag entry in this slice: the current ids ride along so a
              // full-replacement payload leaves the Tags exactly as they were.
              tagIds: this.transaction().tags.map((tag) => tag.id),
            } satisfies RefileTransaction)
          );
          this.refiled.emit(refiled);
          return undefined;
        } catch (error) {
          const { boundErrors, bannerMessage } = partitionServerError(
            error,
            this.serverErrorControls(),
            COULD_NOT_REFILE
          );
          if (boundErrors.length > 0) {
            this.refileForm().markAsTouched();
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
   * camelCased the API's keys; a timestamp rejection comes back as
   * `transactionDate`, which pins onto the date control.
   */
  private serverErrorControls(): ServerErrorControls {
    return {
      categoryId: this.refileForm.categoryId,
      description: this.refileForm.description,
      date: this.refileForm.date,
      transactionDate: this.refileForm.date,
    };
  }
}
