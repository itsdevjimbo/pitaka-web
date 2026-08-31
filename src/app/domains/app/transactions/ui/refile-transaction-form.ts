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
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTimepickerModule } from '@angular/material/timepicker';
import { firstValueFrom } from 'rxjs';
import { ApiError } from '@/app/core/api';
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

/** The banner line for a re-file that failed before it could be attributed. */
const COULD_NOT_REFILE =
  'Something went wrong re-filing this transaction. Please try again.';

/** The banner line for a removal that failed with nothing more specific to say. */
const COULD_NOT_REMOVE =
  'Something went wrong removing this transaction. Please try again.';

/**
 * What the re-file form edits. The amount and the direction are not here — they
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
 * The inline "re-file this Transaction" editor: the row swaps into this the way
 * an Account row swaps into a rename. It corrects *how* a Transaction is filed —
 * when it is dated, its Category, its note — never what moved. The amount and the
 * direction are shown as plain text, deliberately not as disabled inputs that
 * invite a click and then refuse it; someone who mistyped an amount is pointed
 * at removing and recording again, the only correction that can legitimately
 * move a balance (ADR 0009).
 *
 * Every submit sends the whole mutable set — a full replacement, never a patch —
 * so correcting one field cannot null another (the adapter and its spec carry
 * that contract). A Transfer is re-filed only from the Account it was recorded
 * against; the screen offers this form nowhere else, and the adapter still
 * forces a Transfer's Category to null on the wire (ADR 0010). Tags have no
 * entry surface in this slice, so the Transaction's current Tag ids ride along
 * unchanged.
 *
 * This is also where a Transaction is **removed** — the correction re-filing
 * cannot make. A Transaction's amount is settled at recording (`CONTEXT.md`), so
 * a wrong one is fixed by removing and recording again, the only correction that
 * legitimately moves a balance. Removal is gated behind an inline confirmation
 * so a mis-click cannot move a balance, and it inherits this form's "recorded
 * against" placement for free: a Transfer can only be removed from its home
 * Account because that is the only place this form opens (ADR 0010).
 *
 * On success — of either a re-file or a removal — the parent re-reads the
 * balance and list in place (ADR 0006); the form itself never touches a balance.
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
    MatIconModule,
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
  /** The Transaction was removed — the row is gone; the parent refreshes in place. */
  readonly removed = output<void>();
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

  /**
   * True once "Remove" has been pressed and the inline confirmation is showing.
   * Nothing has been sent yet — a mis-click is undone by dismissing it, and the
   * balance has not moved (story 30).
   */
  protected readonly confirmingRemove = signal(false);

  /** True while the removal request is in flight — guards a double confirm. */
  protected readonly removing = signal(false);

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

  /** Reveal the inline confirmation. Sends nothing — the balance stays put. */
  protected askRemove(): void {
    this.errorMessage.set(null);
    this.confirmingRemove.set(true);
  }

  /** Dismiss the confirmation with nothing removed (story 30). */
  protected cancelRemove(): void {
    this.confirmingRemove.set(false);
  }

  /**
   * The confirmation was confirmed: remove the Transaction. On success the
   * parent re-reads the balance from the server (ADR 0006) — the API has moved
   * it back by exactly what moved. On failure a banner explains and the row is
   * left in place; the confirmation stays open so a retry is one press, matching
   * how a failed re-file keeps its form.
   */
  protected async confirmRemove(): Promise<void> {
    if (this.removing()) {
      return;
    }
    this.removing.set(true);
    this.errorMessage.set(null);

    try {
      await firstValueFrom(this.service.remove(this.transaction().id));
      this.removed.emit();
    } catch (error) {
      this.errorMessage.set(
        error instanceof ApiError ? error.message : COULD_NOT_REMOVE
      );
    } finally {
      this.removing.set(false);
    }
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
