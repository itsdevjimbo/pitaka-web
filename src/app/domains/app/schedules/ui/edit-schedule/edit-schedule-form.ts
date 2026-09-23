import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, input, linkedSignal, output, signal } from '@angular/core';
import { form, FormField, max, maxLength, min, required, submit, validate } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { firstValueFrom, forkJoin, timeout, TimeoutError } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { focusFirstInvalidField, partitionServerError, ServerErrorControls } from '@/app/core/forms';
import { CategoriesService, Category, keepSavedFilingCategory } from '@/app/domains/app/categories';
import {
  Schedule,
  SCHEDULE_AMOUNT_MAX,
  SCHEDULE_AMOUNT_MIN,
  SCHEDULE_FREQUENCIES,
  SCHEDULE_NAME_MAX,
  ScheduleUpdate,
  SchedulesService,
} from '../..';
import {
  addCalendarDays,
  compareCalendarDates,
  formatCalendarDate,
  nextEligibleGeneration,
} from '../../data/schedule-calendar';
import { SCHEDULE_WRITE_TIMEOUT_MS } from '../../data/schedule-write';
import { ScheduleRowData } from '../schedule-row/schedule-row';

type EditScheduleModel = {
  name: string;
  amount: number | null;
  categoryId: number | null;
  description: string;
  lastGeneration: Date | null;
};

@Component({
  selector: 'schedules-edit-schedule-form',
  templateUrl: './edit-schedule-form.html',
  imports: [
    DatePipe,
    FormField,
    MatButtonModule,
    MatDatepickerModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
  ],
})
export class EditScheduleForm {
  private readonly schedulesService = inject(SchedulesService);
  private readonly categoriesService = inject(CategoriesService);

  readonly row = input.required<ScheduleRowData>();
  readonly saved = output<Schedule>();
  readonly cancelled = output<void>();
  readonly dirtyChange = output<boolean>();
  readonly pendingChange = output<boolean>();

  private readonly activeCategories = signal<readonly Category[]>([]);
  private readonly allCategories = signal<readonly Category[]>([]);
  protected readonly loadingOptions = signal(true);
  protected readonly optionsFailed = signal(false);
  protected readonly submitting = signal(false);
  protected readonly outcomeUncertain = signal(false);
  protected readonly eligibilityRejected = signal(false);
  protected readonly conflictRefreshFailed = signal(false);

  protected readonly frequencies = SCHEDULE_FREQUENCIES;
  protected readonly currentSchedule = linkedSignal(() => this.row().schedule);
  protected readonly model = linkedSignal<EditScheduleModel>(() => {
    const schedule = this.row().schedule;
    return {
      name: schedule.name,
      amount: schedule.amount,
      categoryId: schedule.categoryId,
      description: schedule.description ?? '',
      lastGeneration: schedule.lastGeneration,
    };
  });

  protected readonly categoryOptions = computed(() => {
    const schedule = this.currentSchedule();
    return keepSavedFilingCategory(
      this.activeCategories().filter((category) => category.kind === schedule.direction),
      this.allCategories(),
      schedule.categoryId,
      this.model().categoryId,
    );
  });
  protected readonly completesSchedule = computed(() => {
    const end = this.model().lastGeneration;
    return end !== null && compareCalendarDates(end, nextEligibleGeneration(this.currentSchedule())) < 0;
  });
  protected readonly canRetry = computed(() => {
    const status = this.currentSchedule().status;
    return !this.conflictRefreshFailed() && (status === 'active' || status === 'paused');
  });
  private readonly dirty = computed(() => {
    const schedule = this.row().schedule;
    const value = this.model();
    return (
      value.name !== schedule.name ||
      value.amount !== schedule.amount ||
      value.categoryId !== schedule.categoryId ||
      value.description !== (schedule.description ?? '') ||
      value.lastGeneration?.getTime() !== schedule.lastGeneration?.getTime()
    );
  });

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
    validate(path.lastGeneration, (context) => {
      const value = context.value();
      const minimum = addCalendarDays(this.currentSchedule().firstGeneration, 1);
      return value !== null && compareCalendarDates(value, minimum) < 0
        ? { kind: 'minimum-date', message: `Choose ${formatCalendarDate(minimum)} or later` }
        : null;
    });
  });

  protected readonly errorMessage = linkedSignal<EditScheduleModel, string | null>({
    source: this.model,
    computation: () => null,
  });

  constructor() {
    effect(() => this.dirtyChange.emit(this.dirty()));
    void this.loadOptions();
  }

  protected save(event: Event): void {
    event.preventDefault();
    const formElement = event.currentTarget as HTMLFormElement;
    submit(this.scheduleForm, {
      action: async () => {
        this.submitting.set(true);
        this.pendingChange.emit(true);
        this.errorMessage.set(null);
        try {
          const value = this.model();
          const updated = await firstValueFrom(
            this.schedulesService
              .update(this.currentSchedule().id, {
                name: value.name.trim(),
                amount: value.amount as number,
                categoryId: value.categoryId,
                description: value.description.trim() || null,
                lastGeneration: value.lastGeneration,
              } satisfies ScheduleUpdate)
              .pipe(timeout({ first: SCHEDULE_WRITE_TIMEOUT_MS })),
          );
          this.saved.emit(updated);
          return undefined;
        } catch (error) {
          if (error instanceof TimeoutError) {
            this.outcomeUncertain.set(true);
            return undefined;
          }
          if (isUnattributedConflict(error)) {
            const refreshed = await this.refreshAfterConflict();
            this.conflictRefreshFailed.set(!refreshed);
            this.errorMessage.set(
              refreshed
                ? 'The Schedule or its filing choices changed. Review the refreshed information and try again.'
                : 'The Schedule changed, but current information couldn’t be refreshed. Close the dialog and try again.',
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
            'Something went wrong saving your Schedule. Please try again.',
          );
          if (boundErrors.length > 0) {
            this.scheduleForm().markAsTouched();
          }
          if (bannerMessage !== null) {
            this.errorMessage.set(bannerMessage);
          }
          return boundErrors.length > 0 ? boundErrors : undefined;
        } finally {
          this.submitting.set(false);
          this.pendingChange.emit(false);
        }
      },
    });

    if (this.scheduleForm().invalid()) {
      this.scheduleForm().markAsTouched();
      focusFirstInvalidField(formElement);
    }
  }

  protected eligibilityChanged(): void {
    this.eligibilityRejected.set(false);
  }

  protected cancel(): void {
    this.cancelled.emit();
  }

  private async loadOptions(refresh = false): Promise<boolean> {
    this.loadingOptions.set(true);
    this.optionsFailed.set(false);
    try {
      const { active, all } = await firstValueFrom(
        forkJoin({
          active: refresh ? this.categoriesService.refreshList() : this.categoriesService.list(),
          all: this.categoriesService.all(),
        }),
      );
      this.activeCategories.set(active);
      this.allCategories.set(all);
      return true;
    } catch {
      this.optionsFailed.set(true);
      return false;
    } finally {
      this.loadingOptions.set(false);
    }
  }

  private async refreshAfterConflict(): Promise<boolean> {
    try {
      const { schedules, active, all } = await firstValueFrom(
        forkJoin({
          schedules: this.schedulesService.list(),
          active: this.categoriesService.refreshList(),
          all: this.categoriesService.all(),
        }),
      );
      const current = schedules.find((schedule) => schedule.id === this.currentSchedule().id);
      this.activeCategories.set(active);
      this.allCategories.set(all);
      if (current === undefined) {
        return false;
      }
      this.currentSchedule.set(current);
      return true;
    } catch {
      return false;
    }
  }

  private serverErrorControls(): ServerErrorControls {
    return {
      name: this.scheduleForm.name,
      amount: this.scheduleForm.amount,
      categoryId: this.scheduleForm.categoryId,
      description: this.scheduleForm.description,
      lastGeneration: this.scheduleForm.lastGeneration,
    };
  }
}

function isUnattributedConflict(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 409 && Object.keys(error.fieldErrors).length === 0;
}

function hasEligibilityError(error: unknown): error is ApiError {
  return error instanceof ApiError && error.fieldErrors['categoryId'] !== undefined;
}
