import { DatePipe } from '@angular/common';
import { Component, computed, DestroyRef, effect, inject, input, linkedSignal, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { form, FormField, max, min, required, submit, validate } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { forkJoin, firstValueFrom, timeout, TimeoutError } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { focusFirstInvalidField, partitionServerError, ServerErrorControls } from '@/app/core/forms';
import { formatPeso, PesoPipe, sumPesos } from '@/app/core/money';
import { Account, AccountModifiedError, AccountsService } from '@/app/domains/app/accounts';
import { accountHeadroom } from '../../data/contributions/account-headroom';
import { GoalContributionWithAccountName } from '../../data/contributions/contribution-account-name';
import { NewGoalContribution, UpdateGoalContribution } from '../../data/contributions/goal-contribution';
import { GoalContributionsService } from '../../data/contributions/goal-contributions.service';
import { Goal, GOAL_AMOUNT_MAX, GOAL_AMOUNT_MIN } from '../../data/goal';

type ContributionModel = { accountId: number | null; amount: number | null; contributionDate: Date; note: string };

const SAVE_TIMEOUT_MS = 15_000;
const SAVE_UNCERTAIN =
  'We couldn’t confirm whether this Contribution was saved. Refresh this Goal before trying again.';

/** The separate Add and Edit surfaces for one Goal Contribution. */
@Component({
  selector: 'goals-contribution-form',
  templateUrl: './contribution-form.html',
  imports: [
    MatButtonModule,
    MatDatepickerModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    DatePipe,
    PesoPipe,
    FormField,
  ],
})
export class ContributionForm {
  private readonly accountsService = inject(AccountsService);
  private readonly contributions = inject(GoalContributionsService);
  private readonly destroyRef = inject(DestroyRef);
  readonly goal = input.required<Goal>();
  readonly contribution = input<GoalContributionWithAccountName | null>(null);
  readonly saved = output<void>();
  readonly cancelled = output<void>();
  readonly unavailable = output<'missing' | 'abandoned'>();
  readonly dirtyChange = output<boolean>();
  readonly pendingChange = output<boolean>();
  protected readonly accounts = signal<readonly Account[]>([]);
  protected readonly available = signal(new Map<number, number>());
  protected readonly loadingAccounts = signal(true);
  protected readonly submitting = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly model = linkedSignal<GoalContributionWithAccountName | null, ContributionModel>({
    source: this.contribution,
    computation: (item) =>
      item
        ? {
            accountId: item.accountId,
            amount: item.amount,
            contributionDate: item.contributionDate,
            note: item.note ?? '',
          }
        : { accountId: null, amount: null, contributionDate: today(), note: '' },
  });
  private readonly dirty = computed(() => {
    const model = this.model();
    const contribution = this.contribution();
    return contribution
      ? model.note !== (contribution.note ?? '')
      : model.accountId !== null ||
          model.amount !== null ||
          model.note !== '' ||
          model.contributionDate.getTime() !== today().getTime();
  });
  protected readonly contributionForm = form(this.model, (path) => {
    required(path.contributionDate, { message: 'You must enter a date' });
    validate(path.contributionDate, (context) =>
      context.value() && context.value().getTime() > today().getTime()
        ? { kind: 'future-date', message: 'The date cannot be in the future' }
        : null,
    );
    if (!this.contribution()) {
      required(path.accountId, { message: 'Choose an Account' });
      required(path.amount, { message: 'You must enter an amount' });
      min(path.amount, GOAL_AMOUNT_MIN, { message: 'The amount must be at least ₱0.01' });
      max(path.amount, GOAL_AMOUNT_MAX, { message: 'The amount is too large' });
      validate(path.amount, (context) => {
        const amount = context.value();
        const available = this.selectedAvailable();
        return amount !== null && available !== null && amount > available
          ? { kind: 'headroom', message: `Only ₱${available.toFixed(2)} is available` }
          : null;
      });
    }
  });

  constructor() {
    effect(() => this.dirtyChange.emit(this.dirty()));
    if (!this.contribution()) {
      this.reloadAccounts();
    }
  }

  protected readonly selectedAvailable = (): number | null => {
    const id = this.model().accountId;
    return id === null ? null : (this.available().get(id) ?? null);
  };
  protected readonly overTarget = (): number | null => {
    const amount = this.model().amount;
    return amount === null
      ? null
      : Math.max(0, sumPesos([this.goal().currentAmount, amount, -this.goal().targetAmount]));
  };
  protected accountLabel(account: Account): string {
    const available = this.available().get(account.id) ?? 0;
    return available > 0
      ? `${account.name} — ${format(account.currentBalance)} balance, ${format(available)} available`
      : `${account.name} — ${format(account.currentBalance)} balance, ₱0.00 available; balance fully earmarked`;
  }
  protected save(event: Event): void {
    event.preventDefault();
    const formElement = event.currentTarget as HTMLFormElement;
    submit(this.contributionForm, {
      action: async () => {
        this.submitting.set(true);
        this.pendingChange.emit(true);
        this.errorMessage.set(null);
        try {
          const value = this.model();
          const existing = this.contribution();
          if (existing) {
            await firstValueFrom(
              this.contributions
                .update(existing.id, {
                  note: value.note.trim() || null,
                } satisfies UpdateGoalContribution)
                .pipe(timeout({ first: SAVE_TIMEOUT_MS })),
            );
          } else {
            await firstValueFrom(
              this.contributions
                .create({
                  goalId: this.goal().id,
                  accountId: value.accountId!,
                  transactionId: null,
                  amount: value.amount!,
                  contributionDate: value.contributionDate,
                  note: value.note.trim() || null,
                } satisfies NewGoalContribution)
                .pipe(timeout({ first: SAVE_TIMEOUT_MS })),
            );
          }
          this.saved.emit();
          return undefined;
        } catch (error) {
          if (error instanceof TimeoutError) {
            this.errorMessage.set(SAVE_UNCERTAIN);
          } else if (error instanceof AccountModifiedError) {
            this.reloadAccounts();
            this.errorMessage.set('This Account’s available amount changed. Review the amount and try again.');
          } else if (error instanceof ApiError && /does not exist|inactive/i.test(error.message)) {
            this.reloadAccounts();
            this.errorMessage.set('This Account is no longer available. Choose another Account.');
          } else if (error instanceof ApiError && /abandoned goal/i.test(error.message)) {
            this.unavailable.emit('abandoned');
          } else if (error instanceof ApiError && error.status === 404) {
            this.unavailable.emit('missing');
          } else {
            const { boundErrors, bannerMessage } = partitionServerError(
              error,
              this.serverErrorControls(),
              'Something went wrong saving this Contribution. Please try again.',
            );
            if (boundErrors.length) {
              this.contributionForm().markAsTouched();
            }
            if (bannerMessage !== null) {
              this.errorMessage.set(bannerMessage);
            }
            return boundErrors.length ? boundErrors : undefined;
          }
          return undefined;
        } finally {
          this.submitting.set(false);
          this.pendingChange.emit(false);
        }
      },
    });

    if (this.contributionForm().invalid()) {
      focusFirstInvalidField(formElement);
    }
  }
  protected cancel(): void {
    this.cancelled.emit();
  }
  private reloadAccounts(): void {
    this.loadingAccounts.set(true);
    forkJoin({ accounts: this.accountsService.all(), contributions: this.contributions.all() })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ accounts, contributions }) => {
          this.accounts.set(accounts.filter((account) => account.isActive));
          this.available.set(
            new Map(accountHeadroom(accounts, contributions).map((item) => [item.accountId, item.availableAmount])),
          );
          if (!this.accounts().some((account) => account.id === this.model().accountId)) {
            this.model.update((value) => ({ ...value, accountId: null }));
          }
          this.loadingAccounts.set(false);
        },
        error: () => {
          this.errorMessage.set('Could not load available Accounts. Please try again.');
          this.loadingAccounts.set(false);
        },
      });
  }
  private serverErrorControls(): ServerErrorControls {
    return {
      accountId: this.contributionForm.accountId,
      amount: this.contributionForm.amount,
      contributionDate: this.contributionForm.contributionDate,
      note: this.contributionForm.note,
    };
  }
}
function today(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}
function format(value: number): string {
  return formatPeso(value);
}
