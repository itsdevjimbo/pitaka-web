import { KeyValuePipe } from '@angular/common';
import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
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
import { RowNotice } from '@/app/core/notices';
import { Account, AccountCriteria, ACCOUNT_TYPES } from '../../data/account';
import {
  criteriaFromQueryParams,
  criteriaToQueryParams,
  sameCriteria,
} from '../../data/account-criteria-params';
import {
  AccountDeleteBlockedError,
  AccountModifiedError,
} from '../../data/account-errors';
import { AccountsService } from '../../data/accounts.service';
import { NewAccountDialog } from '../../ui/new-account-dialog';
import { RenameAccountDialog } from '../../ui/rename-account-dialog';

const LOAD_FAILED =
  'Something went wrong loading your accounts. Please try again.';
const FILTER_FAILED =
  'Something went wrong applying those filters. Please try again.';
const ACTION_FAILED = 'Something went wrong. Please try again.';
const DELETE_BLOCK_HINT: Record<AccountDeleteBlockedError['reason'], string> = {
  'transaction-history':
    'You can retire it instead — that keeps everything it has recorded.',
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
  ],
  host: { class: 'flex flex-auto flex-col' },
})
export default class AccountList {
  private service = inject(AccountsService);
  private destroyRef = inject(DestroyRef);
  private dialog = inject(MatDialog);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private readonly readReset = new Subject<void>();
  protected readonly accounts = signal<readonly Account[] | null>(null);
  protected readonly loading = signal(true);
  protected readonly filtering = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly filterError = signal<string | null>(null);
  protected readonly actionMessage = signal<string | null>(null);
  protected readonly ownsAccounts = signal<boolean | null>(null);
  protected readonly criteria = signal<AccountCriteria>(
    criteriaFromQueryParams(this.route.snapshot.queryParamMap)
  );
  protected readonly displayedCriteria = signal<AccountCriteria>(
    this.criteria()
  );
  protected readonly confirmingDeleteId = signal<number | null>(null);
  protected readonly busyId = signal<number | null>(null);
  protected readonly notice = signal<RowNoticeState | null>(null);
  protected readonly types = ACCOUNT_TYPES;
  protected readonly total = computed(() =>
    sumPesos((this.accounts() ?? []).map((account) => account.currentBalance))
  );
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
    () =>
      this.ownsAccounts() === true &&
      !this.filtering() &&
      this.accounts()?.length === 0
  );
  constructor() {
    this.destroyRef.onDestroy(() => this.readReset.complete());
    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        const next = criteriaFromQueryParams(params);
        if (!sameCriteria(next, this.criteria())) {
          this.criteria.set(next);
          if (this.ownsAccounts() === true) this.readCriteria(next);
        }
      });
    this.load();
  }
  protected load(): void {
    this.loading.set(true);
    this.errorMessage.set(null);
    this.filterError.set(null);
    this.service
      .all()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (all) => {
          this.ownsAccounts.set(all.length > 0);
          if (all.length === 0) {
            this.accounts.set([]);
            this.loading.set(false);
            return;
          }
          if (!this.service.list) {
            this.accounts.set(all);
            this.loading.set(false);
            return;
          }
          this.readCriteria(this.criteria(), true);
        },
        error: (error: unknown) => {
          this.errorMessage.set(
            error instanceof ApiError ? error.message : LOAD_FAILED
          );
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
  private readCriteria(criteria: AccountCriteria, initial = false): void {
    this.readReset.next();
    this.filterError.set(null);
    this.filtering.set(!initial);
    this.list(criteria)
      .pipe(takeUntil(this.readReset), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (accounts) => {
          this.displayedCriteria.set(criteria);
          this.accounts.set(accounts);
          if (accounts.length === 0) this.checkWhetherProfileOwnsAccounts();
          this.loading.set(false);
          this.filtering.set(false);
        },
        error: (error: unknown) => {
          if (initial && this.accounts() === null)
            this.errorMessage.set(
              error instanceof ApiError ? error.message : LOAD_FAILED
            );
          else
            this.filterError.set(
              error instanceof ApiError ? error.message : FILTER_FAILED
            );
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
    this.onDialogResult(
      this.dialog.open<NewAccountDialog, undefined, Account>(NewAccountDialog),
      (created) => this.onCreated(created)
    );
  }
  protected openRenameDialog(account: Account): void {
    this.notice.set(null);
    this.confirmingDeleteId.set(null);
    this.onDialogResult(
      this.dialog.open<RenameAccountDialog, Account, Account>(
        RenameAccountDialog,
        { data: account }
      ),
      () => this.reconcile()
    );
  }
  private onDialogResult<R>(
    ref: MatDialogRef<unknown, R>,
    handle: (result: R) => void
  ): void {
    ref
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((result) => {
        if (result) handle(result);
      });
  }
  private onCreated(account: Account): void {
    this.ownsAccounts.set(true);
    const outsideCriteria = messageForOutsideCriteria(account, this.criteria());
    this.actionMessage.set(outsideCriteria);
    if (outsideCriteria === null)
      this.accounts.update((accounts) => [...(accounts ?? []), account]);
    this.reconcile();
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
      { ...account, isActive: !account.isActive }
    );
  }
  protected askDelete(account: Account): void {
    this.notice.set(null);
    this.confirmingDeleteId.set(account.id);
  }
  protected cancelDelete(): void {
    this.confirmingDeleteId.set(null);
  }
  protected confirmDelete(account: Account): void {
    this.confirmingDeleteId.set(null);
    this.runRowWrite(account.id, this.service.remove(account.id), (error) =>
      this.noticeForFailedDelete(account, error)
    );
  }
  private runRowWrite(
    id: number,
    write$: Observable<unknown>,
    noticeFor: (error: unknown) => RowNoticeState,
    changed: Account | null = null
  ): void {
    this.notice.set(null);
    this.actionMessage.set(null);
    this.busyId.set(id);
    write$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.busyId.set(null);
        this.actionMessage.set(
          changed === null
            ? null
            : messageForOutsideCriteria(changed, this.criteria())
        );
        this.reconcile();
      },
      error: (error) => {
        this.busyId.set(null);
        this.notice.set(noticeFor(error));
      },
    });
  }
  private noticeForFailedDelete(
    account: Account,
    error: unknown
  ): RowNoticeState {
    if (error instanceof AccountDeleteBlockedError) {
      const notice: RowNoticeState = {
        id: account.id,
        message:
          error.reason === 'goal-allocation'
            ? DELETE_BLOCK_HINT[error.reason]
            : `${error.message} ${DELETE_BLOCK_HINT[error.reason]}`,
      };
      if (error.reason === 'goal-allocation') notice.viewGoals = true;
      if (error.reason === 'transaction-history')
        notice.retire = () => this.toggleActive(account);
      return notice;
    }
    return {
      id: account.id,
      message: messageFor(error),
      retry: () => this.confirmDelete(account),
    };
  }
  private reconcile(): void {
    this.readCriteria(this.criteria());
  }
}
function messageFor(error: unknown): string {
  return error instanceof AccountModifiedError || error instanceof ApiError
    ? error.message
    : ACTION_FAILED;
}
function messageForOutsideCriteria(
  account: Account,
  criteria: AccountCriteria
): string | null {
  if (criteria.isActive !== undefined && account.isActive !== criteria.isActive)
    return `${account.name} is ${account.isActive ? 'active' : 'retired'}. Change the status filter to find it.`;
  if (criteria.type !== undefined && account.type !== criteria.type)
    return `${account.name} is a ${account.type} account. Choose ${account.type} to find it.`;
  return null;
}
