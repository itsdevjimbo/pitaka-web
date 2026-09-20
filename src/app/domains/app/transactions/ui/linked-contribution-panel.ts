import { DatePipe } from '@angular/common';
import { Component, computed, inject, Injector, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { firstValueFrom, forkJoin } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { PesoPipe } from '@/app/core/money';
import { RowNotice } from '@/app/core/notices';
import {
  ContributionDeletionCoordinator,
  Goal,
  GoalContribution,
  GoalContributionsService,
  GoalsService,
} from '@/app/domains/app/goals';
import { TransactionLinkedContribution, TransactionLinkedContributions } from '../data/linked-contribution';
import { Transaction } from '../data/transaction';
import { transactionSplitFinancialAvailability } from '../data/transaction-split-availability';
import { TransactionsService } from '../data/transactions.service';

type RefreshedContributionFacts = {
  goal: Goal;
  goalHistory: GoalContribution[];
};

type LinkedContributionCreationAvailability =
  | { status: 'unchecked' | 'checking' | 'available'; explanation: null }
  | { status: 'unavailable' | 'error'; explanation: string };

/** Progressive Transaction context for authoritative Linked Contribution history and correction. */
@Component({
  selector: 'transactions-linked-contribution-panel',
  templateUrl: './linked-contribution-panel.html',
  imports: [DatePipe, MatButtonModule, PesoPipe, RouterLink, RowNotice],
  providers: [ContributionDeletionCoordinator],
})
export class LinkedContributionPanel {
  private readonly transactions = inject(TransactionsService);
  private readonly injector = inject(Injector);
  private snapshotRequest = 0;

  readonly transaction = input.required<Transaction>();
  protected readonly showing = signal(false);
  protected readonly loading = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly snapshot = signal<TransactionLinkedContributions | null>(null);
  protected readonly refreshedFacts = signal<RefreshedContributionFacts | null>(null);
  protected readonly confirmingDelete = signal<TransactionLinkedContribution | null>(null);
  protected readonly deletingId = signal<number | null>(null);
  protected readonly deleteFailure = signal<{
    contribution: TransactionLinkedContribution;
    message: string;
  } | null>(null);
  protected readonly refreshFailure = signal<{
    contribution: TransactionLinkedContribution;
    message: string;
  } | null>(null);
  readonly creationAvailability = computed<LinkedContributionCreationAvailability>(() => {
    if (this.loading()) return { status: 'checking', explanation: null };
    if (this.errorMessage() !== null) {
      return { status: 'error', explanation: 'Current contribution capacity could not be checked.' };
    }
    const snapshot = this.snapshot();
    if (snapshot === null) return { status: 'unchecked', explanation: null };
    const availability = transactionSplitFinancialAvailability(snapshot);
    return availability.available
      ? { status: 'available', explanation: null }
      : { status: 'unavailable', explanation: availability.explanation };
  });

  protected async toggle(): Promise<void> {
    const showing = !this.showing();
    this.showing.set(showing);
    if (showing && this.snapshot() === null) await this.refresh();
  }

  /** Fresh read after entry, retry, or a write because these facts carry money (ADR 0006). */
  async refresh(): Promise<void> {
    const request = ++this.snapshotRequest;
    this.loading.set(true);
    this.errorMessage.set(null);
    try {
      const snapshot = await firstValueFrom(this.transactions.linkedContributions(this.transaction().id));
      if (request !== this.snapshotRequest) return;
      this.snapshot.set(snapshot);
    } catch (error) {
      if (request !== this.snapshotRequest) return;
      this.errorMessage.set(
        error instanceof ApiError
          ? error.message
          : 'Something went wrong loading Linked Contributions. Please try again.',
      );
    } finally {
      if (request === this.snapshotRequest) this.loading.set(false);
    }
  }

  protected askDelete(contribution: TransactionLinkedContribution): void {
    this.deleteFailure.set(null);
    this.confirmingDelete.set(contribution);
  }

  protected cancelDelete(): void {
    this.confirmingDelete.set(null);
  }

  protected async confirmDelete(contribution: TransactionLinkedContribution): Promise<void> {
    if (this.deletingId() !== null) return;
    this.confirmingDelete.set(null);
    this.deleteFailure.set(null);
    this.deletingId.set(contribution.id);
    try {
      await firstValueFrom(this.injector.get(ContributionDeletionCoordinator).attempt(contribution.id));
      await this.refreshAfterDeletion(contribution);
    } catch (error) {
      this.deleteFailure.set({
        contribution,
        message:
          error instanceof ApiError
            ? error.message
            : 'We could not confirm whether this Contribution was deleted. Retry safely to check.',
      });
    } finally {
      this.deletingId.set(null);
    }
  }

  protected async refreshAfterDeletion(contribution: TransactionLinkedContribution): Promise<void> {
    const request = ++this.snapshotRequest;
    this.refreshFailure.set(null);
    try {
      const facts = await firstValueFrom(
        forkJoin({
          snapshot: this.transactions.linkedContributions(this.transaction().id),
          goal: this.injector.get(GoalsService).get(contribution.goalId),
          goalHistory: this.injector.get(GoalContributionsService).list(contribution.goalId),
        }),
      );
      if (request !== this.snapshotRequest) return;
      this.snapshot.set(facts.snapshot);
      this.refreshedFacts.set({
        goal: facts.goal,
        goalHistory: facts.goalHistory,
      });
    } catch {
      if (request !== this.snapshotRequest) return;
      this.refreshFailure.set({
        contribution,
        message: 'The Contribution changed but the latest Transaction, Account, and Goal details could not be loaded.',
      });
    }
  }
}
