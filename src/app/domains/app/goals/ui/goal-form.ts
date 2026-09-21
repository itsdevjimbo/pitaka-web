import { Component, inject, input, linkedSignal, output, signal } from '@angular/core';
import { form, FormField, max, maxLength, min, required, submit, validate } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { firstValueFrom } from 'rxjs';
import { partitionServerError, ServerErrorControls } from '@/app/core/forms';
import { PesoPipe } from '@/app/core/money';
import { Goal, GOAL_AMOUNT_MAX, GOAL_AMOUNT_MIN, GOAL_NAME_MAX, NewGoal } from '../data/goal';
import { GoalsService } from '../data/goals.service';

type GoalModel = Omit<NewGoal, 'targetAmount'> & { targetAmount: number | null };

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
  readonly cancelled = output<void>();
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
  protected readonly errorMessage = linkedSignal<GoalModel, string | null>({
    source: this.model,
    computation: () => null,
  });
  protected readonly isOverTarget = () => {
    const goal = this.goal();
    const targetAmount = this.model().targetAmount;
    return goal !== null && targetAmount !== null && targetAmount < goal.currentAmount;
  };

  save(event: Event): void {
    event.preventDefault();
    submit(this.goalForm, {
      action: async () => {
        this.submitting.set(true);
        this.errorMessage.set(null);
        try {
          const { name, targetAmount, targetDate } = this.model();
          const value: NewGoal = { name: name.trim(), targetAmount: targetAmount as number, targetDate };
          const result = await firstValueFrom(
            this.goal() ? this.service.update(this.goal()!.id, value) : this.service.create(value),
          );
          this.saved.emit(result);
          return undefined;
        } catch (error) {
          const { boundErrors, bannerMessage } = partitionServerError(
            error,
            this.serverErrorControls(),
            'Something went wrong saving this Goal. Please try again.',
          );
          if (boundErrors.length) this.goalForm().markAsTouched();
          if (bannerMessage !== null) this.errorMessage.set(bannerMessage);
          return boundErrors.length ? boundErrors : undefined;
        } finally {
          this.submitting.set(false);
        }
      },
    });
  }
  protected cancel(): void {
    this.cancelled.emit();
  }
  private serverErrorControls(): ServerErrorControls {
    return { name: this.goalForm.name, targetAmount: this.goalForm.targetAmount, targetDate: this.goalForm.targetDate };
  }
}
