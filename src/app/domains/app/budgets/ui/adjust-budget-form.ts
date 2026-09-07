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
import {
  form,
  FormField,
  maxLength,
  min,
  required,
  submit,
} from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { firstValueFrom } from 'rxjs';
import { partitionServerError, ServerErrorControls } from '@/app/core/forms';
import { CategoriesService, Category } from '@/app/domains/app/categories';
import {
  AdjustBudget,
  Budget,
  BUDGET_AMOUNT_MIN,
  BUDGET_NAME_MAX,
  Period,
  PERIODS,
} from '../data/budget';
import { BudgetsService } from '../data/budgets.service';

/** The banner line for an adjust that failed before it could be attributed. */
const COULD_NOT_ADJUST =
  'Something went wrong adjusting your budget. Please try again.';

/** The value the Category picker uses for a Budget that watches all spending. */
const ALL_SPENDING = null;

/** The five Periods, in renewal order, as options for the picker. */
const PERIOD_OPTIONS = (Object.keys(PERIODS) as Period[]).map((value) => ({
  value,
  label: PERIODS[value].label,
}));

/**
 * The editable slice of a Budget — the same five fields the create form offers,
 * prefilled from the Budget rather than started blank. `endDate` and
 * `description` are not here: the form carries the Budget's current `endDate`
 * through untouched at submit, and `description` cannot round-trip (see
 * {@link AdjustBudget}).
 */
type AdjustBudgetModel = {
  name: string;
  amountLimit: number | null;
  period: Period;
  startDate: Date | null;
  categoryId: number | null;
};

/**
 * The "adjust a Budget" form, rendered inside the adjust-budget dialog. It owns
 * only the form; the list re-reads after a successful save so the row lands with
 * its server-resolved Cycle figures (ADR 0006).
 *
 * Every control is prefilled from the Budget and every one is written on submit
 * — `PUT /api/budgets/{id}` is a full replacement, not a patch (see
 * {@link BudgetsService.adjust}). There is **no self-filling start date** the
 * way create has: on an existing Budget both `period` and `startDate` are the
 * person's settled choices, and changing either is a deliberate move that
 * shifts the Cycle — the form says so rather than hiding it, and the re-read
 * afterwards surfaces the new Spent figure.
 *
 * A duplicate name comes back from `BudgetsService.adjust` already filed as a
 * `name` field error. `Budget` has no `Version`, so there is no concurrency
 * rejection to word here. The submit button is disabled while a request is in
 * flight and `submit()` refuses re-entry, so a double-click saves once.
 */
@Component({
  selector: 'budgets-adjust-budget-form',
  templateUrl: './adjust-budget-form.html',
  imports: [
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatDatepickerModule,
    FormField,
  ],
})
export class AdjustBudgetForm {
  // Dependencies
  private service = inject(BudgetsService);
  private categoriesService = inject(CategoriesService);
  private destroyRef = inject(DestroyRef);

  // Inputs
  readonly budget = input.required<Budget>();

  // Outputs
  readonly adjusted = output<Budget>();
  readonly cancelled = output<void>();

  // State
  protected readonly periodOptions = PERIOD_OPTIONS;
  protected readonly allSpending = ALL_SPENDING;

  /** Every Category from the shared cache; narrowed to expenses for the picker. */
  private readonly categories = signal<readonly Category[]>([]);

  /**
   * Expense Categories for the picker — a Budget on an income Category reads
   * zero (ADR 0012) — plus the Budget's current Category if it somehow is not
   * among them, so a prefilled value is never silently dropped to blank.
   */
  protected readonly categoryOptions = computed(() => {
    const expenses = this.categories().filter(
      (category) => category.kind === 'expense'
    );
    const currentId = this.budget().categoryId;
    if (currentId === null || expenses.some((c) => c.id === currentId)) {
      return expenses;
    }
    const current = this.categories().find((c) => c.id === currentId);
    return current ? [...expenses, current] : expenses;
  });

  protected readonly model = linkedSignal<AdjustBudgetModel>(() => {
    const budget = this.budget();
    return {
      name: budget.name,
      amountLimit: budget.amountLimit,
      period: budget.period,
      startDate: budget.startDate,
      categoryId: budget.categoryId,
    };
  });

  protected readonly budgetForm = form(this.model, (path) => {
    required(path.name, { message: 'You must enter a name' });
    maxLength(path.name, BUDGET_NAME_MAX, {
      message: `The name must be ${BUDGET_NAME_MAX} characters or fewer`,
    });
    required(path.amountLimit, { message: 'You must enter an amount' });
    min(path.amountLimit, BUDGET_AMOUNT_MIN, {
      message: `The amount must be at least ${BUDGET_AMOUNT_MIN}`,
    });
    required(path.period, { message: 'You must choose a period' });
    required(path.startDate, { message: 'You must choose a start date' });
    // `categoryId` is deliberately not required — `null` is "All spending".
  });

  protected readonly submitting = signal(false);

  /**
   * The form-level banner. Linked to the model so any edit clears it: a message
   * about values the person has since changed is worse than none.
   */
  protected readonly errorMessage = linkedSignal<
    AdjustBudgetModel,
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

    submit(this.budgetForm, {
      action: async () => {
        this.submitting.set(true);
        this.errorMessage.set(null);

        try {
          const { name, amountLimit, period, startDate, categoryId } =
            this.model();
          const adjusted = await firstValueFrom(
            this.service.adjust(this.budget().id, {
              name: name.trim(),
              // `required` / `min` have ruled out a null amount by now.
              amountLimit: amountLimit as number,
              period,
              startDate: startDate as Date,
              // Carried through untouched so the full-replacement PUT keeps it.
              endDate: this.budget().endDate,
              categoryId,
            } satisfies AdjustBudget)
          );
          this.adjusted.emit(adjusted);
          return undefined;
        } catch (error) {
          const { boundErrors, bannerMessage } = partitionServerError(
            error,
            this.serverErrorControls(),
            COULD_NOT_ADJUST
          );
          if (boundErrors.length > 0) {
            this.budgetForm().markAsTouched();
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
   * The controls a server-blamed field can bind onto. `BudgetsService.adjust`
   * files the duplicate-name 409 under `name`, and the API's range check
   * surfaces as `amountLimit`.
   */
  private serverErrorControls(): ServerErrorControls {
    return {
      name: this.budgetForm.name,
      amountLimit: this.budgetForm.amountLimit,
    };
  }
}
