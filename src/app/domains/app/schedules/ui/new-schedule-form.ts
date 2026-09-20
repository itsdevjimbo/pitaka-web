import { formatDate } from '@angular/common';
import { Component, computed, DestroyRef, inject, linkedSignal, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { form, FormField, max, maxLength, min, required, submit, validate } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { firstValueFrom, forkJoin } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { partitionServerError, ServerErrorControls } from '@/app/core/forms';
import { Account, AccountsService } from '@/app/domains/app/accounts';
import { CategoriesService, Category } from '@/app/domains/app/categories';
import {
  NewSchedule,
  Schedule,
  SCHEDULE_AMOUNT_MAX,
  SCHEDULE_AMOUNT_MIN,
  SCHEDULE_FREQUENCIES,
  SCHEDULE_NAME_MAX,
  ScheduleDirection,
  ScheduleFrequency,
  SchedulesService,
} from '..';

type NewScheduleModel = {
  name: string;
  amount: number | null;
  accountId: number | null;
  categoryId: number | null;
  description: string;
  direction: ScheduleDirection | '';
  frequency: ScheduleFrequency | '';
  firstGeneration: Date | null;
  lastGeneration: Date | null;
};

const DIRECTION_OPTIONS: readonly { value: ScheduleDirection; label: string }[] = [
  { value: 'income', label: 'Income' },
  { value: 'expense', label: 'Expense' },
];

const FREQUENCY_OPTIONS = (Object.keys(SCHEDULE_FREQUENCIES) as ScheduleFrequency[]).map((value) => ({
  value,
  label: SCHEDULE_FREQUENCIES[value],
}));

const COULD_NOT_CREATE = 'Something went wrong creating your Schedule. Please try again.';

@Component({
  selector: 'schedules-new-schedule-form',
  templateUrl: './new-schedule-form.html',
  imports: [FormField, MatButtonModule, MatDatepickerModule, MatFormFieldModule, MatInputModule, MatSelectModule],
})
export class NewScheduleForm {
  private readonly schedulesService = inject(SchedulesService);
  private readonly accountsService = inject(AccountsService);
  private readonly categoriesService = inject(CategoriesService);
  private readonly destroyRef = inject(DestroyRef);

  readonly created = output<Schedule>();
  readonly cancelled = output<void>();

  protected readonly directions = DIRECTION_OPTIONS;
  protected readonly frequencies = FREQUENCY_OPTIONS;
  protected readonly accounts = signal<readonly Account[]>([]);
  private readonly categories = signal<readonly Category[]>([]);
  protected readonly loadingOptions = signal(true);
  protected readonly optionsFailed = signal(false);
  protected readonly submitting = signal(false);
  protected readonly eligibilityRejected = signal(false);

  protected readonly model = signal<NewScheduleModel>({
    name: '',
    amount: null,
    accountId: null,
    categoryId: null,
    description: '',
    direction: '',
    frequency: '',
    firstGeneration: null,
    lastGeneration: null,
  });

  protected readonly categoryOptions = computed(() => {
    const direction = this.model().direction;
    return direction === '' ? [] : this.categories().filter((category) => category.kind === direction);
  });

  protected readonly firstGenerationMinimum = firstGenerationMinimum();

  protected readonly scheduleForm = form(this.model, (path) => {
    required(path.name, { message: 'You must enter a name' });
    validate(path.name, (context) =>
      context.value().trim() ? null : { kind: 'trimmed-required', message: 'You must enter a name' },
    );
    maxLength(path.name, SCHEDULE_NAME_MAX, {
      message: `The name must be ${SCHEDULE_NAME_MAX} characters or fewer`,
    });
    required(path.amount, { message: 'You must enter an amount' });
    min(path.amount, SCHEDULE_AMOUNT_MIN, { message: 'The amount must be at least ₱0.01' });
    max(path.amount, SCHEDULE_AMOUNT_MAX, { message: 'The amount is too large' });
    required(path.accountId, { message: 'Choose an Account' });
    required(path.categoryId, { message: 'Choose a Category' });
    required(path.direction, { message: 'Choose a direction' });
    required(path.frequency, { message: 'Choose a frequency' });
    required(path.firstGeneration, { message: 'Choose a First generation date' });
    validate(path.firstGeneration, (context) => {
      const value = context.value();
      return value !== null && compareCalendarDates(value, this.firstGenerationMinimum) < 0
        ? { kind: 'minimum-date', message: minimumMessage(this.firstGenerationMinimum) }
        : null;
    });
    validate(path.lastGeneration, (context) => {
      const value = context.value();
      const first = this.model().firstGeneration;
      if (value === null || first === null) return null;
      const minimum = addCalendarDays(first, 1);
      return compareCalendarDates(value, minimum) < 0
        ? { kind: 'minimum-date', message: minimumMessage(minimum) }
        : null;
    });
  });

  protected readonly errorMessage = linkedSignal<NewScheduleModel, string | null>({
    source: this.model,
    computation: () => null,
  });

  constructor() {
    void this.loadOptions();
  }

  protected directionChanged(): void {
    this.eligibilityChanged();
    const selected = this.categories().find((category) => category.id === this.model().categoryId);
    if (selected?.kind !== this.model().direction) {
      this.model.update((value) => ({ ...value, categoryId: null }));
    }
  }

  protected eligibilityChanged(): void {
    this.eligibilityRejected.set(false);
  }

  protected save(event: Event): void {
    event.preventDefault();
    submit(this.scheduleForm, {
      action: async () => {
        this.submitting.set(true);
        this.errorMessage.set(null);
        try {
          const value = this.model();
          const created = await firstValueFrom(
            this.schedulesService.create({
              accountId: value.accountId as number,
              categoryId: value.categoryId as number,
              name: value.name.trim(),
              direction: value.direction as ScheduleDirection,
              amount: value.amount as number,
              description: value.description.trim() || null,
              frequency: value.frequency as ScheduleFrequency,
              firstGeneration: value.firstGeneration as Date,
              lastGeneration: value.lastGeneration,
            } satisfies NewSchedule),
          );
          this.created.emit(created);
          return undefined;
        } catch (error) {
          if (isUnattributedConflict(error)) {
            const refreshed = await this.refreshAfterConflict();
            this.errorMessage.set(
              refreshed
                ? 'Schedules or filing choices changed. Review the refreshed values and try again.'
                : 'Schedules changed, but current information couldn’t be refreshed. Close the dialog and try again.',
            );
            return undefined;
          }

          if (hasEligibilityError(error)) {
            this.eligibilityRejected.set(true);
            void this.loadOptions(true);
          }

          const { boundErrors, bannerMessage } = partitionServerError(
            error,
            this.serverErrorControls(),
            COULD_NOT_CREATE,
          );
          if (boundErrors.length > 0) this.scheduleForm().markAsTouched();
          if (bannerMessage !== null) this.errorMessage.set(bannerMessage);
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

  private async loadOptions(refresh = false): Promise<boolean> {
    this.loadingOptions.set(true);
    this.optionsFailed.set(false);
    try {
      const { accounts, categories } = await firstValueFrom(
        forkJoin({
          accounts: this.accountsService.all(),
          categories: refresh ? this.categoriesService.refreshList() : this.categoriesService.list(),
        }).pipe(takeUntilDestroyed(this.destroyRef)),
      );
      this.applyEligibleOptions(accounts, categories, false);
      return true;
    } catch {
      this.optionsFailed.set(true);
      return false;
    } finally {
      this.loadingOptions.set(false);
    }
  }

  private async refreshAfterConflict(): Promise<boolean> {
    this.loadingOptions.set(true);
    this.optionsFailed.set(false);
    try {
      const { accounts, categories } = await firstValueFrom(
        forkJoin({
          schedules: this.schedulesService.list(),
          accounts: this.accountsService.all(),
          categories: this.categoriesService.refreshList(),
        }).pipe(takeUntilDestroyed(this.destroyRef)),
      );
      this.applyEligibleOptions(accounts, categories, true);
      return true;
    } catch {
      this.optionsFailed.set(true);
      return false;
    } finally {
      this.loadingOptions.set(false);
    }
  }

  private applyEligibleOptions(
    accounts: readonly Account[],
    categories: readonly Category[],
    clearUnavailable: boolean,
  ): void {
    const eligibleAccounts = accounts.filter((account) => account.isActive);
    this.accounts.set(eligibleAccounts);
    this.categories.set(categories);
    if (!clearUnavailable) return;
    this.model.update((value) => ({
      ...value,
      accountId: eligibleAccounts.some((account) => account.id === value.accountId) ? value.accountId : null,
      categoryId: categories.some((category) => category.id === value.categoryId) ? value.categoryId : null,
    }));
  }

  private serverErrorControls(): ServerErrorControls {
    return {
      name: this.scheduleForm.name,
      amount: this.scheduleForm.amount,
      accountId: this.scheduleForm.accountId,
      categoryId: this.scheduleForm.categoryId,
      description: this.scheduleForm.description,
      direction: this.scheduleForm.direction,
      frequency: this.scheduleForm.frequency,
      firstGeneration: this.scheduleForm.firstGeneration,
      lastGeneration: this.scheduleForm.lastGeneration,
    };
  }
}

/** Tomorrow in the UTC calendar, represented as the same local calendar day for the date picker. */
function firstGenerationMinimum(now = new Date()): Date {
  return addCalendarDays(new Date(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()), 1);
}

function addCalendarDays(value: Date, count: number): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate() + count);
}

function compareCalendarDates(left: Date, right: Date): number {
  return (
    Date.UTC(left.getFullYear(), left.getMonth(), left.getDate()) -
    Date.UTC(right.getFullYear(), right.getMonth(), right.getDate())
  );
}

function minimumMessage(minimum: Date): string {
  return `Choose ${formatDate(minimum, 'd MMM y', 'en-US')} or later`;
}

function isUnattributedConflict(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 409 && Object.keys(error.fieldErrors).length === 0;
}

function hasEligibilityError(error: unknown): error is ApiError {
  return (
    error instanceof ApiError &&
    (error.fieldErrors['accountId'] !== undefined || error.fieldErrors['categoryId'] !== undefined)
  );
}
