import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { applyEach, form, FormField, max, min, required, validate } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { DialogShell } from '@/app/core/dialog';
import { PesoPipe, sumPesos } from '@/app/core/money';
import { Goal, GOAL_AMOUNT_MAX, GOAL_AMOUNT_MIN } from '@/app/domains/app/goals';
import { Transaction } from '../data/transaction';
import { TransactionSplitPayload } from '../data/transaction-split';
import { TransactionSplitContext, TransactionSplitContextStore } from './transaction-split-context';
import {
  TransactionSplitFailure,
  TransactionSplitRecoveryState,
  TransactionSplitRecoveryStore,
} from './transaction-split-recovery';

export type TransactionSplitDialogData = { transaction: Transaction };

type SplitRowModel = {
  goalId: string;
  amount: number | null;
  note: string;
  acknowledgeTargetOverrun: boolean;
};

type SplitFormModel = {
  contributionDate: string;
  contributions: SplitRowModel[];
};

type TargetOverrun = {
  goal: Goal;
  proposedProgress: number;
  overBy: number;
};

@Component({
  selector: 'transactions-transaction-split-dialog',
  templateUrl: './transaction-split-dialog.html',
  imports: [DatePipe, DialogShell, FormField, MatButtonModule, PesoPipe],
})
export class TransactionSplitDialog {
  private readonly data = inject<TransactionSplitDialogData>(MAT_DIALOG_DATA);
  private readonly contextStore = inject(TransactionSplitContextStore);
  private readonly recoveryStore = inject(TransactionSplitRecoveryStore);
  protected readonly dialogRef = inject<MatDialogRef<TransactionSplitDialog, boolean>>(MatDialogRef);

  protected readonly contextState = this.contextStore.state;
  protected readonly recoveryState = this.recoveryStore.state;
  protected readonly source = this.data.transaction;
  protected readonly showErrors = signal(false);
  protected readonly model = signal<SplitFormModel>(initialModel(this.recoveryState()));
  protected readonly splitForm = form(this.model, (path) => {
    required(path.contributionDate, { message: 'You must enter a Contribution date' });
    applyEach(path.contributions, (row) => {
      required(row.goalId, { message: 'Choose a Goal' });
      required(row.amount, { message: 'You must enter an amount' });
      min(row.amount, GOAL_AMOUNT_MIN, { message: 'The amount must be at least ₱0.01' });
      max(row.amount, GOAL_AMOUNT_MAX, { message: 'The amount is too large' });
      validate(row.amount, ({ value }) =>
        value() !== null && !hasCentPrecision(value()!)
          ? { kind: 'cent-precision', message: 'Use an amount with no more than two decimal places' }
          : null,
      );
    });
  });

  protected readonly readyContext = computed<TransactionSplitContext | null>(() => {
    const state = this.contextState();
    return state.status === 'ready' ? state.context : null;
  });
  protected readonly total = computed(() => sumPesos(this.model().contributions.map((row) => row.amount ?? 0)));
  protected readonly duplicateGoals = computed(() => {
    const selected = this.model()
      .contributions.map((row) => row.goalId)
      .filter((id) => id !== '');
    return new Set(selected).size !== selected.length;
  });
  protected readonly transactionCapacityExceeded = computed(() => {
    const context = this.readyContext();
    return context !== null && this.total() > context.snapshot.remainingCapacity;
  });
  protected readonly accountHeadroomExceeded = computed(() => {
    const context = this.readyContext();
    return context !== null && this.total() > context.snapshot.account.availableHeadroom;
  });
  protected readonly pending = computed(() => this.recoveryState().status === 'pending');
  protected readonly formLocked = computed(() => {
    const status = this.recoveryState().status;
    return status === 'pending' || status === 'uncertain' || status === 'idempotency-mismatch';
  });
  protected readonly recoveryMessage = computed(() => {
    const state = this.recoveryState();
    return 'message' in state ? state.message : '';
  });
  protected readonly freshKeyCollision = computed(() => {
    const state = this.recoveryState();
    return state.status === 'idempotency-mismatch' && state.freshKeyCollision;
  });
  protected readonly canSubmit = computed(() => {
    const context = this.readyContext();
    const rows = this.model().contributions;
    return (
      context?.availability.available === true &&
      rows.length > 0 &&
      !this.splitForm().invalid() &&
      !this.duplicateGoals() &&
      !this.transactionCapacityExceeded() &&
      !this.accountHeadroomExceeded() &&
      rows.every((row, index) => this.targetOverrun(index) === null || row.acknowledgeTargetOverrun) &&
      !this.formLocked()
    );
  });
  protected readonly submitDisabled = computed(
    () => this.readyContext()?.availability.available !== true || this.formLocked(),
  );

  constructor() {
    void this.contextStore.load(this.source);
    effect(() => {
      if (this.recoveryState().status === 'confirmed') this.dialogRef.close(true);
    });
  }

  protected addRow(): void {
    this.model.update((value) => ({ ...value, contributions: [...value.contributions, emptyRow()] }));
  }

  protected removeRow(index: number): void {
    if (this.model().contributions.length === 1 || this.formLocked()) return;
    this.model.update((value) => ({
      ...value,
      contributions: value.contributions.filter((_row, rowIndex) => rowIndex !== index),
    }));
  }

  protected goalFor(row: SplitRowModel): Goal | null {
    return this.readyContext()?.goals.find((goal) => goal.id === Number(row.goalId)) ?? null;
  }

  protected targetOverrun(index: number): TargetOverrun | null {
    const row = this.model().contributions[index];
    const goal = row === undefined ? null : this.goalFor(row);
    if (row?.amount === null || row?.amount === undefined || goal === null) return null;
    const proposedProgress = sumPesos([goal.currentAmount, row.amount]);
    if (proposedProgress <= goal.targetAmount) return null;
    return {
      goal,
      proposedProgress,
      overBy: sumPesos([proposedProgress, -goal.targetAmount]),
    };
  }

  protected sharedServerErrors(): readonly string[] {
    const state = this.recoveryState();
    return state.status === 'validation-error' ? (state.fieldErrors['contributions'] ?? []) : [];
  }

  protected dateServerErrors(): readonly string[] {
    const state = this.recoveryState();
    return state.status === 'validation-error' ? (state.fieldErrors['contributionDate'] ?? []) : [];
  }

  protected rowServerErrors(index: number): readonly string[] {
    const state = this.recoveryState();
    if (state.status === 'validation-error') {
      const prefix = `contributions[${index}]`;
      return Object.entries(state.fieldErrors)
        .filter(([key]) => key === prefix || key.startsWith(`${prefix}.`))
        .flatMap(([, messages]) => messages);
    }
    if (state.status === 'refused') {
      return state.failures.filter((failure) => failure.rowIndex === index).map(failureMessage);
    }
    return [];
  }

  protected sharedRefusalErrors(): readonly string[] {
    const state = this.recoveryState();
    return state.status === 'refused'
      ? state.failures.filter((failure) => failure.rowIndex === undefined).map(failureMessage)
      : [];
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    this.showErrors.set(true);
    this.splitForm().markAsTouched();
    if (!this.canSubmit()) return;

    await this.recoveryStore.submit(this.payload());
  }

  protected async retryUncertain(): Promise<void> {
    await this.recoveryStore.retryUncertain();
  }

  protected async retryFreshKeyCollision(): Promise<void> {
    await this.recoveryStore.retryFreshKeyCollision();
  }

  protected async retryContext(): Promise<void> {
    const state = this.contextState();
    if (state.status === 'initial-error') await this.contextStore.retry();
    else await this.contextStore.refresh();
  }

  private payload(): TransactionSplitPayload {
    return {
      transactionId: this.source.id,
      contributionDate: this.model().contributionDate,
      contributions: this.model().contributions.map((row) => ({
        goalId: Number(row.goalId),
        amount: row.amount!,
        note: row.note,
        acknowledgeTargetOverrun: row.acknowledgeTargetOverrun,
      })),
    };
  }
}

function emptyRow(): SplitRowModel {
  return { goalId: '', amount: null, note: '', acknowledgeTargetOverrun: false };
}

function initialModel(state: TransactionSplitRecoveryState): SplitFormModel {
  if (state.status !== 'pending' && state.status !== 'uncertain' && state.status !== 'idempotency-mismatch') {
    return { contributionDate: todayDateOnly(), contributions: [emptyRow()] };
  }
  return {
    contributionDate: state.attempt.payload.contributionDate,
    contributions: state.attempt.payload.contributions.map((row) => ({
      goalId: String(row.goalId),
      amount: row.amount,
      note: row.note ?? '',
      acknowledgeTargetOverrun: row.acknowledgeTargetOverrun,
    })),
  };
}

function todayDateOnly(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function hasCentPrecision(value: number): boolean {
  return /^\d+(?:\.\d{1,2})?$/.test(String(value));
}

function failureMessage(failure: TransactionSplitFailure): string {
  const goalName = typeof failure['goalName'] === 'string' ? failure['goalName'] : 'This Goal';
  switch (failure.reason) {
    case 'goal_inactive':
      return `${goalName} is no longer Active.`;
    case 'target_overrun_acknowledgement_required': {
      const current = numberFact(failure, 'currentProgress');
      const target = numberFact(failure, 'target');
      const proposed = numberFact(failure, 'proposedProgress');
      return current !== null && target !== null && proposed !== null
        ? `${goalName} is at ₱${current.toFixed(2)} of ₱${target.toFixed(2)}; this row would make it ₱${proposed.toFixed(2)}. Acknowledge the target overrun and try again.`
        : `${goalName} now requires target-overrun acknowledgement. Review the row and try again.`;
    }
    case 'account_headroom_exceeded':
      return 'The Account no longer has enough headroom for this split.';
    case 'transaction_capacity_exceeded':
      return 'The Transaction no longer has enough remaining capacity for this split.';
    case 'account_inactive':
      return "The Transaction's Account is retired and cannot fund a new Linked Contribution.";
    case 'transaction_ineligible':
      return 'This Transaction is no longer eligible for Linked Contributions.';
    case 'transaction_missing':
      return 'This Transaction is no longer available.';
    case 'concurrent_state_changed':
      return 'The Transaction, Account, or a Goal changed. Review the refreshed details and try again.';
  }
}

function numberFact(failure: TransactionSplitFailure, name: string): number | null {
  const value = failure[name];
  return typeof value === 'number' ? value : null;
}
