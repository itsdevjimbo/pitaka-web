import { Component, inject, signal, viewChild } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { DialogShell } from '@/app/core/dialog';
import { Goal } from '../../data/goal';
import { ContributionForm } from './contribution-form';
@Component({
  selector: 'goals-add-contribution-dialog',
  imports: [DialogShell, ContributionForm],
  template: `
    <app-dialog-shell
      heading="Add contribution"
      [dirty]="dirty()"
      [pending]="pending()"
    >
      <goals-contribution-form
        [goal]="goal"
        (saved)="dialogRef.close('saved')"
        (cancelled)="shell().requestClose()"
        (dirtyChange)="dirty.set($event)"
        (pendingChange)="pending.set($event)"
        (unavailable)="dialogRef.close($event)"
      />
    </app-dialog-shell>
  `,
})
export class AddContributionDialog {
  protected readonly dialogRef =
    inject<MatDialogRef<AddContributionDialog, 'saved' | 'missing' | 'abandoned'>>(MatDialogRef);
  protected readonly goal = inject<Goal>(MAT_DIALOG_DATA);
  protected readonly dirty = signal(false);
  protected readonly pending = signal(false);
  protected readonly shell = viewChild.required(DialogShell);
}
