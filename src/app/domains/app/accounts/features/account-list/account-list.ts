import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { RouterLink } from '@angular/router';
import { Observable } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { PesoPipe, sumPesos } from '@/app/core/money';
import { Account, ACCOUNT_TYPES } from '../../data/account';
import {
  AccountDeleteBlockedError,
  AccountModifiedError,
} from '../../data/account-errors';
import { AccountsService } from '../../data/accounts.service';
import { NewAccountDialog } from '../../ui/new-account-dialog';
import { RenameAccountDialog } from '../../ui/rename-account-dialog';

const LOAD_FAILED =
  'Something went wrong loading your accounts. Please try again.';

const ACTION_FAILED = 'Something went wrong. Please try again.';

/** What to point the person at once a delete is refused for a full Account. */
const DELETE_BLOCK_HINT: Record<
  AccountDeleteBlockedError['reason'],
  string
> = {
  'transaction-history':
    'You can retire it instead — that keeps everything it has recorded.',
  'goal-allocation':
    'Resolve that goal first, then the account can be deleted.',
};

/**
 * A message pinned to one Account's row after a lifecycle action failed:
 * a refused delete, a retire that lost a race, a rename conflict the form
 * could not word itself. `retry` re-runs the action that failed; `retire`
 * offers the way out of a delete blocked by Transaction history.
 */
type RowNotice = {
  id: number;
  message: string;
  retry?: () => void;
  retire?: () => void;
};

/**
 * The landing screen: every Account the person owns, its type and current
 * balance, and the total — so "where do I stand?" is answered without
 * arithmetic. Retired Accounts read as retired and can be hidden; a Profile with
 * no Accounts gets told what to do next rather than a blank screen.
 *
 * Each row can be renamed, retired or reactivated, and deleted — deletion behind
 * a confirm, and every one of those writes followed by a fresh read of the list
 * rather than a local patch (ADR 0006). A write that lost an optimistic-
 * concurrency race, or a delete the API refuses because the Account still holds
 * history or money, surfaces as a notice on that row with the way forward.
 */
@Component({
  selector: 'account-list',
  templateUrl: './account-list.html',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    RouterLink,
    PesoPipe,
  ],
  host: {
    class: 'flex flex-auto flex-col',
  },
})
export default class AccountList {
  // Dependencies
  private service = inject(AccountsService);
  private destroyRef = inject(DestroyRef);
  private dialog = inject(MatDialog);

  // State
  protected readonly accounts = signal<readonly Account[] | null>(null);
  protected readonly loading = signal(true);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly showRetired = signal(false);

  /** The id of the Account whose delete is awaiting confirmation, or `null`. */
  protected readonly confirmingDeleteId = signal<number | null>(null);

  /** The id of the Account with a retire/reactivate/delete request in flight. */
  protected readonly busyId = signal<number | null>(null);

  /** A per-row message left by a failed lifecycle action. */
  protected readonly notice = signal<RowNotice | null>(null);

  protected readonly types = ACCOUNT_TYPES;

  /** Whether the person owns any retired Account — gates the hide/show control. */
  protected readonly hasRetired = computed(() =>
    (this.accounts() ?? []).some((account) => !account.isActive)
  );

  /** The Accounts on screen: all of them, or only the active ones. */
  protected readonly visibleAccounts = computed(() => {
    const all = this.accounts() ?? [];
    return this.showRetired()
      ? all
      : all.filter((account) => account.isActive);
  });

  /** The sum of exactly what is on screen — the headline figure. */
  protected readonly total = computed(() =>
    sumPesos(this.visibleAccounts().map((account) => account.currentBalance))
  );

  /** The sum across every Account, retired included — shown once retired are revealed. */
  protected readonly allAccountsTotal = computed(() =>
    sumPesos((this.accounts() ?? []).map((account) => account.currentBalance))
  );

  /** What the headline total covers, said plainly. */
  protected readonly totalLabel = computed(() => {
    if (!this.hasRetired()) {
      return 'Total';
    }
    return this.showRetired()
      ? 'Total across all accounts'
      : 'Total across active accounts';
  });

  constructor() {
    this.load();
  }

  /** Read the list from the server afresh. Bound to the error state's retry. */
  protected load(): void {
    this.loading.set(true);
    this.errorMessage.set(null);

    this.service
      .list()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (accounts) => {
          this.accounts.set(accounts);
          this.loading.set(false);
        },
        error: (error: unknown) => {
          this.errorMessage.set(
            error instanceof ApiError ? error.message : LOAD_FAILED
          );
          this.loading.set(false);
        },
      });
  }

  protected toggleRetired(): void {
    this.showRetired.update((shown) => !shown);
  }

  /**
   * Open the *Add account* dialog. It closes with the created Account on a
   * successful save, or with nothing on Cancel, the close control, or Escape.
   */
  protected openNewAccountDialog(): void {
    this.onDialogResult(
      this.dialog.open<NewAccountDialog, undefined, Account>(NewAccountDialog),
      (created) => this.onCreated(created)
    );
  }

  /**
   * Open the *Rename* dialog for one row, seeded with its Account. It closes
   * with the renamed Account on a successful save, or with nothing otherwise.
   * The row is left as it is, so its name, type, balance and retired badge stay
   * on screen underneath.
   */
  protected openRenameDialog(account: Account): void {
    this.notice.set(null);
    this.confirmingDeleteId.set(null);

    this.onDialogResult(
      this.dialog.open<RenameAccountDialog, Account, Account>(
        RenameAccountDialog,
        { data: account }
      ),
      () => this.onRenamed()
    );
  }

  /**
   * Run `handle` once a dialog closes with a result — a saved Account — and do
   * nothing when it closes with none (Cancel, the close control, Escape). The
   * subscription is torn down with the component.
   */
  private onDialogResult<R>(
    ref: MatDialogRef<unknown, R>,
    handle: (result: R) => void
  ): void {
    ref
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((result) => {
        if (result) {
          handle(result);
        }
      });
  }

  /**
   * A new Account was created. Show it at once — its balance is the server's own
   * figure from the create response, not a remembered one — then re-read the
   * list so it lands in the server's order and picks up anything changed
   * elsewhere (ADR 0006: reconcile a write with a fresh read, don't trust a
   * local splice). A failed reconcile keeps the optimistic row rather than
   * replacing the screen with an error.
   */
  private onCreated(account: Account): void {
    this.accounts.update((list) => [...(list ?? []), account]);
    this.reconcile();
  }

  /** The rename saved. Re-read so the new name lands everywhere (ADR 0006). */
  private onRenamed(): void {
    this.reconcile();
  }

  /** Retire an active Account, or bring a retired one back. */
  protected toggleActive(account: Account): void {
    this.runRowWrite(
      account.id,
      this.service.setActive(account.id, !account.isActive),
      (error) => ({
        id: account.id,
        message: messageFor(error),
        retry: () => this.toggleActive(account),
      })
    );
  }

  /** Ask before removing a container of money. */
  protected askDelete(account: Account): void {
    this.notice.set(null);
    this.confirmingDeleteId.set(account.id);
  }

  protected cancelDelete(): void {
    this.confirmingDeleteId.set(null);
  }

  /** The person confirmed the delete. */
  protected confirmDelete(account: Account): void {
    this.confirmingDeleteId.set(null);
    this.runRowWrite(account.id, this.service.remove(account.id), (error) =>
      this.noticeForFailedDelete(account, error)
    );
  }

  /**
   * The shape every retire / reactivate / delete shares: mark the row busy,
   * run the write, then re-read the list on success (ADR 0006) or pin the
   * row a notice on failure. Only the failure wording differs, so callers
   * pass just that.
   */
  private runRowWrite(
    id: number,
    write$: Observable<unknown>,
    noticeFor: (error: unknown) => RowNotice
  ): void {
    this.notice.set(null);
    this.busyId.set(id);

    write$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.busyId.set(null);
        this.reconcile();
      },
      error: (error: unknown) => {
        this.busyId.set(null);
        this.notice.set(noticeFor(error));
      },
    });
  }

  /** Turn a failed delete into a row notice with the right way forward. */
  private noticeForFailedDelete(account: Account, error: unknown): RowNotice {
    if (error instanceof AccountDeleteBlockedError) {
      const notice: RowNotice = {
        id: account.id,
        message: `${error.message} ${DELETE_BLOCK_HINT[error.reason]}`,
      };
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

  /**
   * Re-read the list after a write (ADR 0006). A failed reconcile is logged and
   * left — the screen keeps what it had rather than flipping to an error.
   */
  private reconcile(): void {
    this.service
      .list()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (accounts) => this.accounts.set(accounts),
        error: (error: unknown) =>
          console.error('[accounts] reconcile after write failed', error),
      });
  }
}

/** The person-facing line for a lifecycle failure that is not a delete block. */
function messageFor(error: unknown): string {
  if (error instanceof AccountModifiedError) {
    return error.message;
  }
  if (error instanceof ApiError) {
    return error.message;
  }
  return ACTION_FAILED;
}
