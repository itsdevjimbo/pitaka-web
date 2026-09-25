import { Component, computed, effect, inject, input, linkedSignal, output, signal } from '@angular/core';
import { form, FormField, max, maxLength, min, required, submit, validate } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { firstValueFrom, timeout, TimeoutError } from 'rxjs';
import { focusFirstInvalidField, partitionServerError, ServerErrorControls } from '@/app/core/forms';
import { PesoPipe } from '@/app/core/money';
import { Goal, GOAL_AMOUNT_MAX, GOAL_AMOUNT_MIN, GOAL_NAME_MAX, NewGoal } from '../../data/goal';
import { GoalUnavailableError } from '../../data/goal-errors';
import { GoalsService } from '../../data/goals.service';

type GoalModel = Omit<NewGoal, 'targetAmount'> & { targetAmount: number | null };

const SAVE_TIMEOUT_MS = 15_000;
const SAVE_UNCERTAIN = 'We couldn’t confirm whether this Goal was saved. Refresh Goals before trying again.';

/** Shared fields and validation used by the deliberately separate new and edit dialogs. */
@Component({
  selector: 'goals-goal-form',
  templateUrl: './goal-form.html',
  imports: [MatButtonModule, MatDatepickerModule, MatFormFieldModule, MatInputModule, PesoPipe, FormField],
})
export class GoalForm {
  private service = inject(GoalsService);
  readonly goal = input<Goal | null>(null);
  readonly saved = output<Goal>();
  readonly unavailable = output<void>();
  readonly cancelled = output<void>();
  readonly dirtyChange = output<boolean>();
  readonly pendingChange = output<boolean>();
  protected readonly model = linkedSignal<Goal | null, GoalModel>({
    source: this.goal,
    computation: (goal) => {
      return goal
        ? { name: goal.name, targetAmount: goal.targetAmount, targetDate: goal.targetDate }
        : { name: '', targetAmount: null, targetDate: null };
    },
  });
  protected readonly goalForm = form(this.model, (path) => {
    required(path.name, { message: 'You must enter a name' });
    validate(path.name, (context) =>
      context.value().trim() ? null : { kind: 'trimmed-required', message: 'You must enter a name' },
    );
    maxLength(path.name, GOAL_NAME_MAX, { message: `The name must be ${GOAL_NAME_MAX} characters or fewer` });
    required(path.targetAmount, { message: 'You must enter a target amount' });
    min(path.targetAmount, GOAL_AMOUNT_MIN, { message: `The target must be at least ₱${GOAL_AMOUNT_MIN}` });
    max(path.targetAmount, GOAL_AMOUNT_MAX, { message: `The target must be ₱${GOAL_AMOUNT_MAX} or less` });
  });
  protected readonly submitting = signal(false);
  private readonly dirty = computed(() => {
    const model = this.model();
    const goal = this.goal();
    return goal
      ? model.name !== goal.name ||
          model.targetAmount !== goal.targetAmount ||
          model.targetDate?.getTime() !== goal.targetDate?.getTime()
      : model.name !== '' || model.targetAmount !== null || model.targetDate !== null;
  });
  protected readonly errorMessage = linkedSignal<GoalModel, string | null>({
    source: this.model,
    computation: () => null,
  });
  protected readonly isOverTarget = () => {
    const goal = this.goal();
    const targetAmount = this.model().targetAmount;
    return goal !== null && targetAmount !== null && targetAmount < goal.currentAmount;
  };

  constructor() {
    effect(() => this.dirtyChange.emit(this.dirty()));
  }

  protected save(event: Event): void {
    event.preventDefault();
    const formElement = event.currentTarget as HTMLFormElement;
    submit(this.goalForm, {
      action: async () => {
        this.submitting.set(true);
        this.pendingChange.emit(true);
        this.errorMessage.set(null);
        try {
          const { name, targetAmount, targetDate } = this.model();
          const value: NewGoal = { name: name.trim(), targetAmount: targetAmount as number, targetDate };
          const result = await firstValueFrom(
            (this.goal() ? this.service.update(this.goal()!.id, value) : this.service.create(value)).pipe(
              timeout({ first: SAVE_TIMEOUT_MS }),
            ),
          );
          this.saved.emit(result);
          return undefined;
        } catch (error) {
          if (error instanceof TimeoutError) {
            this.errorMessage.set(SAVE_UNCERTAIN);
            return undefined;
          }
          // A write against an existing Goal targets its ID; let the screen confirm whether it still exists.
          if (this.goal() && error instanceof GoalUnavailableError) {
            this.errorMessage.set(error.message);
            this.unavailable.emit();
            return undefined;
          }
          const { boundErrors, bannerMessage } = partitionServerError(
            error,
            this.serverErrorControls(),
            'Something went wrong saving this Goal. Please try again.',
          );
          if (boundErrors.length) {
            this.goalForm().markAsTouched();
          }
          if (bannerMessage !== null) {
            this.errorMessage.set(bannerMessage);
          }
          return boundErrors.length ? boundErrors : undefined;
        } finally {
          this.submitting.set(false);
          this.pendingChange.emit(false);
        }
      },
    });

    if (this.goalForm().invalid()) {
      focusFirstInvalidField(formElement);
    }
  }
  protected cancel(): void {
    this.cancelled.emit();
  }
  private serverErrorControls(): ServerErrorControls {
    return { name: this.goalForm.name, targetAmount: this.goalForm.targetAmount, targetDate: this.goalForm.targetDate };
  }
}
