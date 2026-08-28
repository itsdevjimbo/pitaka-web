import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ApiError } from '@/app/core/api';
import { PesoPipe } from '@/app/core/money';
import {
  Account,
  ACCOUNT_TYPE_ICONS,
  ACCOUNT_TYPE_LABELS,
} from './account';
import { AccountsService } from './accounts.service';

const LOAD_FAILED =
  'Something went wrong loading your accounts. Please try again.';

/**
 * The landing screen: every Account the person owns, its type and current
 * balance, and the total — so "where do I stand?" is answered without
 * arithmetic. Retired Accounts read as retired and can be hidden; a Profile with
 * no Accounts gets told what to do next rather than a blank screen.
 *
 * Balances are re-read from the server on every entry (issue #6): the component
 * calls the service in its constructor and holds nothing across navigations.
 */
@Component({
  selector: 'accounts',
  templateUrl: './accounts.html',
  imports: [MatButtonModule, MatIconModule, PesoPipe],
  host: {
    class: 'flex flex-auto flex-col',
  },
})
export default class Accounts {
  // Dependencies
  private service = inject(AccountsService);
  private destroyRef = inject(DestroyRef);

  // State
  protected readonly accounts = signal<readonly Account[] | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly showRetired = signal(false);

  protected readonly typeLabels = ACCOUNT_TYPE_LABELS;
  protected readonly typeIcons = ACCOUNT_TYPE_ICONS;

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

  /** The sum of exactly what is on screen, so the label can say what it covers. */
  protected readonly total = computed(() =>
    this.visibleAccounts().reduce(
      (sum, account) => sum + account.currentBalance,
      0
    )
  );

  constructor() {
    this.load();
  }

  /** Read the list from the server afresh. Bound to the error state's retry. */
  protected load(): void {
    this.loading.set(true);
    this.loadError.set(null);

    this.service
      .list()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (accounts) => {
          this.accounts.set(accounts);
          this.loading.set(false);
        },
        error: (error: unknown) => {
          this.loadError.set(
            error instanceof ApiError ? error.message : LOAD_FAILED
          );
          this.loading.set(false);
        },
      });
  }

  protected toggleRetired(): void {
    this.showRetired.update((shown) => !shown);
  }
}
