import { KeyValuePipe } from '@angular/common';
import { Component, computed, DestroyRef, ElementRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSelectModule } from '@angular/material/select';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Observable, Subject, takeUntil } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { PesoPipe, sumPesos } from '@/app/core/money';
import { ResourceState, RowNotice } from '@/app/core/notices';
import {
  RecordTransactionDialog,
  type RecordTransactionDialogData,
  type Transaction,
} from '@/app/domains/app/transactions';
import { type Account, type AccountCriteria, ACCOUNT_TYPES } from '../../data/account';
import { criteriaFromQueryParams, criteriaToQueryParams, sameCriteria } from '../../data/account-criteria-params';
import { AccountDeleteBlockedError, AccountModifiedError } from '../../data/account-errors';
import { AccountsService } from '../../data/accounts.service';
import { NewAccountDialog } from '../../ui/new-account/new-account-dialog';
import {
  RecordAccountDialog,
  type RecordAccountDialogData,
  type RecordAccountDialogResult,
} from '../../ui/record-account/record-account-dialog';
import { RenameAccountDialog } from '../../ui/rename-account/rename-account-dialog';

const LOAD_FAILED = 'Something went wrong loading your accounts. Please try again.';
const REFRESH_FAILED = 'Couldn’t refresh. These figures may be out of date';
const ACTION_FAILED = 'Something went wrong. Please try again.';
const DELETE_BLOCK_HINT: Record<AccountDeleteBlockedError['reason'], string> = {
  'transaction-history': 'You can retire it instead — that keeps everything it has recorded.',
  'goal-allocation':
    'This Account can’t be deleted while Contributions earmark money in it. Remove those Contributions or delete their Goals, then try again.',
};
type RowNoticeState = {
  id: number;
  message: string;
  viewGoals?: boolean;
  retry?: () => void;
  retire?: () => void;
};

@Component({
  selector: 'account-list',
  templateUrl: './account-list.html',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatFormFieldModule,
    MatSelectModule,
    RouterLink,
    KeyValuePipe,
    PesoPipe,
    RowNotice,
    ResourceState,
  ],
  host: { class: 'flex flex-auto flex-col' },
})
export default class AccountList {
  private service = inject(AccountsService);
  private destroyRef = inject(DestroyRef);
  private dialog = inject(MatDialog);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly readReset = new Subject<void>();
  private actionMessageTimer: ReturnType<typeof setTimeout> | null = null;
  protected readonly displayedAccounts = signal<readonly Account[] | null>(null);
  // The retired-inclusive read only supplies recording choices; its balances are never rendered.
  protected readonly allAccounts = signal<readonly Account[]>([]);
  protected readonly loading = signal(true);
  protected readonly filtering = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly filterError = signal<string | null>(null);
  protected readonly savedStale = signal(false);
  protected readonly actionMessage = signal<string | null>(null);
  protected readonly ownsAccounts = signal<boolean | null>(null);
  protected readonly criteria = signal<AccountCriteria>(criteriaFromQueryParams(this.route.snapshot.queryParamMap));
  protected readonly displayedCriteria = signal<AccountCriteria>(this.criteria());
  protected readonly confirmingDeleteId = signal<number | null>(null);
  protected readonly busyId = signal<number | null>(null);
  protected readonly notice = signal<RowNoticeState | null>(null);
  protected readonly dialogOpen = signal(false);
  private readonly focusAfterDelete = signal<number | 'heading' | null>(null);
  protected readonly types = ACCOUNT_TYPES;
  protected readonly total = computed(() =>
    sumPesos((this.displayedAccounts() ?? []).map((account) => account.currentBalance)),
  );
  protected readonly activeAccounts = computed(() => this.allAccounts().filter((account) => account.isActive));
  protected readonly stale = computed(() => this.filtering() || this.filterError() !== null);
  protected readonly totalLabel = computed(() => {
    const status =
      this.displayedCriteria().isActive === false
        ? 'retired'
        : this.displayedCriteria().isActive === undefined
          ? 'all'
          : 'active';
    const type = this.displayedCriteria().type;
    return `Total across ${status} ${type ? `${this.types[type].label} ` : ''}accounts`;
  });
  protected readonly trueEmpty = computed(() => this.ownsAccounts() === false);
  protected readonly matchedNothing = computed(
    () => this.ownsAccounts() === true && !this.filtering() && this.displayedAccounts()?.length === 0,
  );
  constructor() {
    this.destroyRef.onDestroy(() => {
      this.readReset.complete();
      if (this.actionMessageTimer !== null) {
        clearTimeout(this.actionMessageTimer);
      }
    });
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const next = criteriaFromQueryParams(params);
      if (!sameCriteria(next, this.criteria())) {
        this.criteria.set(next);
        if (this.ownsAccounts() === true) {
          this.readCriteria(next);
        }
      }
    });
    this.load();
  }
  protected load(): void {
    this.loading.set(true);
    this.errorMessage.set(null);
    this.filterError.set(null);
    this.savedStale.set(false);
    this.service
      .all()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (all) => {
          this.allAccounts.set(all);
          this.ownsAccounts.set(all.length > 0);
          if (all.length === 0) {
            this.displayedAccounts.set([]);
            this.loading.set(false);
            return;
          }
          if (!this.service.list) {
            this.displayedAccounts.set(all);
            this.loading.set(false);
            return;
          }
          this.readCriteria(this.criteria(), true);
        },
        error: (error: unknown) => {
          this.errorMessage.set(error instanceof ApiError ? error.message : LOAD_FAILED);
          this.loading.set(false);
        },
      });
  }
  protected applyCriteria(criteria: AccountCriteria): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: criteriaToQueryParams(criteria),
      replaceUrl: true,
    });
  }
  protected clearFilters(): void {
    this.applyCriteria({ isActive: true });
  }
  protected retryFilters(): void {
    this.readCriteria(this.criteria());
  }
  private readCriteria(criteria: AccountCriteria, initial = false, afterWrite = false): void {
    this.readReset.next();
    this.filterError.set(null);
    this.filtering.set(!initial);
    this.list(criteria)
      .pipe(takeUntil(this.readReset), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (accounts) => {
          this.displayedCriteria.set(criteria);
          this.displayedAccounts.set(accounts);
          if (accounts.length === 0) {
            this.checkWhetherProfileOwnsAccounts();
          }
          this.loading.set(false);
          this.filtering.set(false);
          this.savedStale.set(false);
        },
        error: (error: unknown) => {
          if (initial && this.displayedAccounts() === null) {
            this.errorMessage.set(error instanceof ApiError ? error.message : LOAD_FAILED);
          } else {
            this.filterError.set(REFRESH_FAILED);
            this.savedStale.set(afterWrite);
          }
          this.loading.set(false);
          this.filtering.set(false);
        },
      });
  }
  private list(criteria: AccountCriteria): Observable<Account[]> {
    return this.service.list ? this.service.list(criteria) : this.service.all();
  }
  private checkWhetherProfileOwnsAccounts(): void {
    this.service
      .all()
      .pipe(takeUntil(this.readReset), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (accounts) => this.ownsAccounts.set(accounts.length > 0),
      });
  }
  protected openNewAccountDialog(): void {
    this.dialogOpen.set(true);
    this.onDialogResult(this.dialog.open<NewAccountDialog, undefined, Account>(NewAccountDialog), (created) =>
      this.onCreated(created),
    );
  }
  protected openRecordAccountDialog(): void {
    this.dialogOpen.set(true);
    const ref = this.dialog.open<RecordAccountDialog, RecordAccountDialogData, RecordAccountDialogResult>(
      RecordAccountDialog,
      { data: { accounts: this.activeAccounts() } },
    );

    ref
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((result) => {
        if (result === 'new-account') {
          this.openNewAccountDialog();
        } else if (result) {
          this.openRecordDialog(result);
        } else {
          this.dialogOpen.set(false);
        }
      });
  }
  private openRecordDialog(account: Account): void {
    const destinations = this.activeAccounts()
      .filter((candidate) => candidate.id !== account.id)
      .map(({ id, name }) => ({ id, name }));
    const ref = this.dialog.open<RecordTransactionDialog, RecordTransactionDialogData, Transaction>(
      RecordTransactionDialog,
      { data: { fromAccountId: account.id, destinations } },
    );

    ref
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((recorded) => {
        this.dialogOpen.set(false);
        if (recorded) {
          this.showActionMessage('Transaction recorded.');
          this.reconcile(true);
        }
      });
  }
  protected openRenameDialog(account: Account): void {
    this.notice.set(null);
    this.confirmingDeleteId.set(null);
    this.dialogOpen.set(true);
    this.onDialogResult(
      this.dialog.open<RenameAccountDialog, Account, Account>(RenameAccountDialog, { data: account }),
      (renamed) => {
        this.allAccounts.update((accounts) =>
          accounts.map((candidate) => (candidate.id === renamed.id ? renamed : candidate)),
        );
        this.applyOptimisticChange(renamed);
        this.showActionMessage(`${renamed.name} renamed.`);
        this.reconcile(true);
      },
    );
  }
  private onDialogResult<R>(ref: MatDialogRef<unknown, R>, handle: (result: R) => void): void {
    ref
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((result) => {
        this.dialogOpen.set(false);
        if (result) {
          handle(result);
        }
      });
  }
  private onCreated(account: Account): void {
    this.ownsAccounts.set(true);
    this.allAccounts.update((accounts) => [...accounts, account]);
    const outsideCriteria = messageForOutsideCriteria(account, this.criteria());
    this.showActionMessage(outsideCriteria ?? `${account.name} added.`);
    if (outsideCriteria === null) {
      this.displayedAccounts.update((accounts) => [...(accounts ?? []), account]);
    }
    this.reconcile(true);
  }
  protected toggleActive(account: Account): void {
    this.runRowWrite(
      account.id,
      this.service.setActive(account.id, !account.isActive),
      (error) => ({
        id: account.id,
        message: messageFor(error),
        retry: () => this.toggleActive(account),
      }),
      { ...account, isActive: !account.isActive },
      `${account.name} ${account.isActive ? 'retired' : 'reactivated'}.`,
    );
  }
  protected askDelete(account: Account): void {
    this.notice.set(null);
    this.confirmingDeleteId.set(account.id);
    queueMicrotask(() => {
      this.host.nativeElement.querySelector<HTMLButtonElement>(`#cancel-delete-account-${account.id}`)?.focus();
    });
  }
  protected cancelDelete(): void {
    this.confirmingDeleteId.set(null);
  }
  protected confirmDelete(account: Account): void {
    this.confirmingDeleteId.set(null);
    const visible = this.displayedAccounts() ?? [];
    const index = visible.findIndex((candidate) => candidate.id === account.id);
    this.focusAfterDelete.set(visible[index + 1]?.id ?? visible[index - 1]?.id ?? 'heading');
    this.runRowWrite(
      account.id,
      this.service.remove(account.id),
      (error) => this.noticeForFailedDelete(account, error),
      null,
      `${account.name} deleted.`,
    );
  }
  private runRowWrite(
    id: number,
    write$: Observable<unknown>,
    noticeFor: (error: unknown) => RowNoticeState,
    changed: Account | null = null,
    successMessage = '',
  ): void {
    this.notice.set(null);
    this.actionMessage.set(null);
    this.busyId.set(id);
    write$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.busyId.set(null);
        if (changed === null) {
          this.allAccounts.update((accounts) => accounts.filter((account) => account.id !== id));
          this.displayedAccounts.update((accounts) => accounts?.filter((account) => account.id !== id) ?? null);
          this.restoreFocusAfterDelete();
        } else {
          this.allAccounts.update((accounts) =>
            accounts.map((account) => (account.id === changed.id ? changed : account)),
          );
          this.applyOptimisticChange(changed);
        }
        const outsideCriteria = changed === null ? null : messageForOutsideCriteria(changed, this.criteria());
        this.showActionMessage(outsideCriteria ?? successMessage);
        this.reconcile(true);
      },
      error: (error) => {
        this.busyId.set(null);
        this.focusAfterDelete.set(null);
        this.notice.set(noticeFor(error));
      },
    });
  }
  private noticeForFailedDelete(account: Account, error: unknown): RowNoticeState {
    if (error instanceof AccountDeleteBlockedError) {
      const notice: RowNoticeState = {
        id: account.id,
        message:
          error.reason === 'goal-allocation'
            ? DELETE_BLOCK_HINT[error.reason]
            : `${error.message} ${DELETE_BLOCK_HINT[error.reason]}`,
      };
      if (error.reason === 'goal-allocation') {
        notice.viewGoals = true;
      }
      if (error.reason === 'transaction-history') {
        notice.retire = () => this.toggleActive(account);
      }
      return notice;
    }
    return {
      id: account.id,
      message: messageFor(error),
      retry: () => this.confirmDelete(account),
    };
  }
  private reconcile(afterWrite = false): void {
    this.readCriteria(this.criteria(), false, afterWrite);
  }
  private showActionMessage(message: string): void {
    if (this.actionMessageTimer !== null) {
      clearTimeout(this.actionMessageTimer);
    }
    this.actionMessage.set(message);
    this.actionMessageTimer = setTimeout(() => {
      this.actionMessage.set(null);
      this.actionMessageTimer = null;
    }, 5000);
  }
  private applyOptimisticChange(changed: Account): void {
    const matches = accountMatchesCriteria(changed, this.displayedCriteria());
    this.displayedAccounts.update((accounts) => {
      if (accounts === null) {
        return accounts;
      }
      const withoutChanged = accounts.filter((account) => account.id !== changed.id);
      return matches ? [...withoutChanged, changed] : withoutChanged;
    });
  }
  private restoreFocusAfterDelete(): void {
    const target = this.focusAfterDelete();
    if (target === null) {
      return;
    }
    this.focusAfterDelete.set(null);
    queueMicrotask(() => {
      if (target !== 'heading') {
        const actions = this.host.nativeElement.querySelector<HTMLButtonElement>(`#account-actions-${target}`);
        if (actions && !actions.disabled) {
          actions.focus();
          return;
        }
        const accountLink = this.host.nativeElement.querySelector<HTMLAnchorElement>(`#account-link-${target}`);
        if (accountLink) {
          accountLink.focus();
          return;
        }
      }
      this.host.nativeElement.querySelector<HTMLElement>('h1')?.focus();
    });
  }
}
function messageFor(error: unknown): string {
  return error instanceof AccountModifiedError || error instanceof ApiError ? error.message : ACTION_FAILED;
}
function messageForOutsideCriteria(account: Account, criteria: AccountCriteria): string | null {
  if (criteria.isActive !== undefined && account.isActive !== criteria.isActive) {
    return `${account.name} is ${account.isActive ? 'active' : 'retired'}. Change the status filter to find it.`;
  }
  if (criteria.type !== undefined && account.type !== criteria.type) {
    return `${account.name} is a ${account.type} account. Choose ${account.type} to find it.`;
  }
  return null;
}
function accountMatchesCriteria(account: Account, criteria: AccountCriteria): boolean {
  return (
    (criteria.isActive === undefined || account.isActive === criteria.isActive) &&
    (criteria.type === undefined || account.type === criteria.type)
  );
}
