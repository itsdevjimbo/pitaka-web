import {
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
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
import { CategoriesService } from '@/app/domains/app/categories/categories.service';
import { Category } from '@/app/domains/app/categories/category';
import {
  Budget,
  BUDGET_AMOUNT_MIN,
  BUDGET_NAME_MAX,
  NewBudget,
  Period,
  PERIODS,
} from '../data/budget';
import { startOfCurrentPeriod } from '../data/budget-calendar';
import { BudgetsService } from '../data/budgets.service';

/** The banner line for a create that failed before it could be attributed. */
const COULD_NOT_CREATE =
  'Something went wrong creating your budget. Please try again.';

/** The value the Category picker uses for a Budget that watches all spending. */
const ALL_SPENDING = null;

/** The five Periods, in renewal order, as options for the picker. */
const PERIOD_OPTIONS = (Object.keys(PERIODS) as Period[]).map((value) => ({
  value,
  label: PERIODS[value].label,
}));

/**
 * `period` starts unset so the picker carries no default the person did not
 * choose (the `new-account-form` precedent). `categoryId` starts at `null` —
 * "All spending" — which is a real, valid choice and the only version of this
 * control in which the person can read what an unnarrowed Budget does, so it
 * breaks the no-unchosen-default rule on purpose. `startDate` starts empty and
 * fills itself in once a Period is picked.
 */
type NewBudgetModel = {
  name: string;
  amountLimit: number | null;
  period: Period | '';
  startDate: Date | null;
  categoryId: number | null;
};

/**
 * The "create a Budget" form, rendered inside the new-budget dialog. It owns
 * only the form; the list decides where the created Budget lands and closes the
 * panel.
 *
 * Two behaviours carry the ticket's intent:
 *
 * - **Period has no default.** Once it is picked, the start date fills itself in
 *   with the start of the current calendar Period (ADR 0012) and re-fills if
 *   Period changes — until the person edits the date, after which it is theirs
 *   and never re-filled.
 * - **The Category picker offers "All spending" first, selected by default**,
 *   and lists **expense Categories only** — a Budget on an income Category could
 *   only ever read zero (ADR 0012).
 *
 * A duplicate name comes back from `BudgetsService.create` already filed as a
 * `name` field error. The submit button is disabled while a request is in
 * flight and `submit()` refuses re-entry, so a double-click creates once.
 */
@Component({
  selector: 'budgets-new-budget-form',
  templateUrl: './new-budget-form.html',
  imports: [
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatDatepickerModule,
    FormField,
  ],
})
export class NewBudgetForm {
  // Dependencies
  private service = inject(BudgetsService);
  private categoriesService = inject(CategoriesService);
  private destroyRef = inject(DestroyRef);

  // Outputs
  readonly created = output<Budget>();
  readonly cancelled = output<void>();

  // State
  protected readonly periodOptions = PERIOD_OPTIONS;
  protected readonly allSpending = ALL_SPENDING;

  /** Every Category from the shared cache; narrowed to expenses for the picker. */
  private readonly categories = signal<readonly Category[]>([]);

  /** Only expense Categories — a Budget on an income Category reads zero (ADR 0012). */
  protected readonly categoryOptions = computed(() =>
    this.categories().filter((category) => category.kind === 'expense')
  );

  protected readonly model = signal<NewBudgetModel>({
    name: '',
    amountLimit: null,
    period: '',
    startDate: null,
    categoryId: ALL_SPENDING,
  });

  /** The chosen Period, pulled out so the self-fill effect depends on it alone. */
  private readonly period = computed(() => this.model().period);

  /**
   * Flips to `true` the first time the person changes the start date themselves.
   * Once set, the Period-driven self-fill stops: the date is theirs.
   */
  protected readonly startDateEdited = signal(false);

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
  protected readonly errorMessage = linkedSignal<NewBudgetModel, string | null>({
    source: this.model,
    computation: () => null,
  });

  constructor() {
    this.categoriesService
      .list()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((categories) => this.categories.set(categories));

    // Start date follows Period until the person takes it over. The effect
    // depends only on the chosen Period and the "edited" flag — it writes
    // `startDate` but never reads it, so there is no cycle. A Period change
    // recomputes the date; an edit stops the re-fill for good.
    effect(() => {
      const period = this.period();
      if (period === '' || this.startDateEdited()) {
        return;
      }
      this.model.update((model) => ({
        ...model,
        startDate: startOfCurrentPeriod(period, new Date()),
      }));
    });
  }

  /** The person set the date themselves — hand it over and stop re-filling. */
  protected onStartDateEdited(): void {
    this.startDateEdited.set(true);
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
          const created = await firstValueFrom(
            this.service.create({
              name: name.trim(),
              // `required` / `min` have ruled out a null amount, and
              // `required(path.period)` the empty option, by the time this runs.
              amountLimit: amountLimit as number,
              period: period as Period,
              startDate: startDate as Date,
              categoryId,
            } satisfies NewBudget)
          );
          this.created.emit(created);
          return undefined;
        } catch (error) {
          const { boundErrors, bannerMessage } = partitionServerError(
            error,
            this.serverErrorControls(),
            COULD_NOT_CREATE
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
   * The controls a server-blamed field can bind onto. The interceptor has
   * camelCased the API's keys; `BudgetsService.create` files the duplicate-name
   * 409 under `name`, and the API's range check surfaces as `amountLimit`.
   */
  private serverErrorControls(): ServerErrorControls {
    return {
      name: this.budgetForm.name,
      amountLimit: this.budgetForm.amountLimit,
    };
  }
}
