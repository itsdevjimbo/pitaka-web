import { DatePipe } from '@angular/common';
import { Component, inject, linkedSignal, signal } from '@angular/core';
import { form, FormField, required, submit, validate } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { firstValueFrom } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { DialogShell } from '@/app/core/dialog';
import { partitionServerError } from '@/app/core/forms';
import { compareCalendarDates, formatCalendarDate, nextExtensionGeneration } from '../../data/schedule-calendar';
import { ScheduleLifecycleCoordinator } from '../../data/schedule-lifecycle-coordinator';
import { ScheduleRowData } from '../schedule-row/schedule-row';

type ExtendScheduleModel = {
  lastGeneration: Date | null;
};

/** Chooses a finite or indefinite continuation and submits it atomically. */
@Component({
  selector: 'schedules-extend-schedule-dialog',
  templateUrl: './extend-schedule-dialog.html',
  imports: [DatePipe, DialogShell, FormField, MatButtonModule, MatDatepickerModule, MatFormFieldModule, MatInputModule],
})
export class ExtendScheduleDialog {
  private readonly coordinator = inject(ScheduleLifecycleCoordinator);
  protected readonly dialogRef = inject<MatDialogRef<ExtendScheduleDialog>>(MatDialogRef);
  protected readonly row = inject<ScheduleRowData>(MAT_DIALOG_DATA);

  protected readonly nextGeneration = nextExtensionGeneration(this.row.schedule);
  protected readonly minimumEnd = this.nextGeneration;
  protected readonly indefinite = signal(false);
  protected readonly model = linkedSignal<ExtendScheduleModel>(() => ({ lastGeneration: this.minimumEnd }));
  protected readonly submitting = signal(false);
  protected readonly errorMessage = linkedSignal<ExtendScheduleModel, string | null>({
    source: this.model,
    computation: () => null,
  });
  protected readonly extendForm = form(this.model, (path) => {
    required(path.lastGeneration, { message: `Choose ${formatCalendarDate(this.minimumEnd)} or later` });
    validate(path.lastGeneration, (context) => {
      const value = context.value();
      return value !== null && compareCalendarDates(value, this.minimumEnd) < 0
        ? { kind: 'minimum-date', message: `Choose ${formatCalendarDate(this.minimumEnd)} or later` }
        : null;
    });
  });

  protected setIndefinite(value: boolean): void {
    this.indefinite.set(value);
    this.errorMessage.set(null);
  }

  protected save(event: Event): void {
    event.preventDefault();
    if (this.indefinite()) {
      void this.performExtension(null);
      return;
    }
    submit(this.extendForm, { action: async () => this.performExtension(this.model().lastGeneration) });
  }

  private async performExtension(lastGeneration: Date | null) {
    if (this.submitting()) return undefined;
    this.submitting.set(true);
    this.errorMessage.set(null);
    try {
      await firstValueFrom(this.coordinator.extend(this.row.schedule.id, lastGeneration));
      this.dialogRef.close();
      return undefined;
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        this.dialogRef.close();
        return undefined;
      }
      const { boundErrors, bannerMessage } = partitionServerError(
        error,
        { lastGeneration: this.extendForm.lastGeneration },
        'Something went wrong extending your Schedule. Please try again.',
      );
      if (boundErrors.length > 0) this.extendForm().markAsTouched();
      if (bannerMessage !== null) this.errorMessage.set(bannerMessage);
      return boundErrors.length > 0 ? boundErrors : undefined;
    } finally {
      this.submitting.set(false);
    }
  }
}
