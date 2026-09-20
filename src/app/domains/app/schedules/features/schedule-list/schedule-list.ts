import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { forkJoin } from 'rxjs';
import { Account, AccountsService } from '@/app/domains/app/accounts';
import { CategoriesService, Category } from '@/app/domains/app/categories';
import { Schedule, ScheduleStatus, SchedulesService } from '../..';
import { ScheduleLifecycleCoordinator, ScheduleLifecycleEvent } from '../../data/schedule-lifecycle-coordinator';
import { EditScheduleDialog } from '../../ui/edit-schedule/edit-schedule-dialog';
import { ExtendScheduleDialog } from '../../ui/extend-schedule/extend-schedule-dialog';
import { NewScheduleDialog } from '../../ui/new-schedule/new-schedule-dialog';
import { ScheduleEmptyState } from '../../ui/schedule-empty-state/schedule-empty-state';
import {
  ScheduleLifecycleAction,
  ScheduleLifecycleDialog,
  ScheduleLifecycleDialogData,
} from '../../ui/schedule-lifecycle-dialog/schedule-lifecycle-dialog';
import {
  ScheduleLifecycleNav,
  ScheduleView,
  ScheduleViewCounts,
} from '../../ui/schedule-lifecycle-nav/schedule-lifecycle-nav';
import { ScheduleRow, ScheduleRowData } from '../../ui/schedule-row/schedule-row';

const STATUS_VIEW: Record<ScheduleStatus, ScheduleView> = {
  active: 'upcoming',
  paused: 'paused',
  completed: 'past',
  cancelled: 'past',
};

@Component({
  selector: 'schedule-list',
  templateUrl: './schedule-list.html',
  imports: [MatButtonModule, MatIconModule, ScheduleEmptyState, ScheduleLifecycleNav, ScheduleRow],
  host: { class: 'flex flex-auto flex-col' },
})
export default class ScheduleList {
  private readonly schedulesService = inject(SchedulesService);
  private readonly accountsService = inject(AccountsService);
  private readonly categoriesService = inject(CategoriesService);
  private readonly lifecycleCoordinator = inject(ScheduleLifecycleCoordinator);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialog = inject(MatDialog);

  protected readonly schedules = signal<readonly Schedule[] | null>(null);
  private readonly accounts = signal<readonly Account[]>([]);
  private readonly categories = signal<readonly Category[]>([]);
  protected readonly loading = signal(true);
  protected readonly refreshing = signal(false);
  protected readonly loadFailed = signal(false);
  protected readonly actionMessage = signal<string | null>(null);
  protected readonly busyScheduleIds = signal<ReadonlySet<number>>(new Set());

  /** True after a refresh failure until all three collections refresh successfully. */
  protected readonly stale = signal(false);
  protected readonly selectedView = signal<ScheduleView>('upcoming');

  protected readonly rows = computed<readonly ScheduleRowData[]>(() => {
    const accountById = new Map(this.accounts().map((account) => [account.id, account]));
    const categoryById = new Map(this.categories().map((category) => [category.id, category]));

    return (this.schedules() ?? []).map((schedule) => {
      const account = accountById.get(schedule.accountId);
      const category = schedule.categoryId === null ? undefined : categoryById.get(schedule.categoryId);
      return {
        schedule,
        accountName: account?.name ?? 'Unknown Account',
        accountRetired: account !== undefined && !account.isActive,
        categoryName: schedule.categoryId === null ? 'Uncategorized' : (category?.name ?? 'Unknown Category'),
        categoryRetired: category !== undefined && !category.isActive,
      };
    });
  });

  protected readonly visibleRows = computed(() => {
    const view = this.selectedView();
    return this.rows()
      .filter((row) => STATUS_VIEW[row.schedule.status] === view)
      .sort((a, b) => {
        if (view === 'upcoming') {
          return (
            a.schedule.nextGeneration.getTime() - b.schedule.nextGeneration.getTime() ||
            a.schedule.name.localeCompare(b.schedule.name)
          );
        }
        return a.schedule.name.localeCompare(b.schedule.name);
      });
  });

  protected readonly counts = computed<ScheduleViewCounts>(() => {
    const result: Record<ScheduleView, number> = {
      upcoming: 0,
      paused: 0,
      past: 0,
    };
    for (const row of this.rows()) result[STATUS_VIEW[row.schedule.status]] += 1;
    return result;
  });

  protected readonly empty = computed(() => this.schedules()?.length === 0);

  constructor() {
    this.lifecycleCoordinator.events
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((event) => this.onLifecycleEvent(event));
    this.load();
  }

  protected load(conflict?: { scheduleId: number; message: string }): void {
    const hasCurrentData = this.schedules() !== null;
    if (hasCurrentData) this.refreshing.set(true);
    else this.loading.set(true);
    this.loadFailed.set(false);

    forkJoin({
      schedules: this.schedulesService.list(),
      accounts: this.accountsService.all(),
      categories: this.categoriesService.all(),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ schedules, accounts, categories }) => {
          this.schedules.set(schedules);
          this.accounts.set(accounts);
          this.categories.set(categories);
          this.stale.set(false);
          this.loading.set(false);
          this.refreshing.set(false);
          if (conflict) {
            const current = schedules.find((schedule) => schedule.id === conflict.scheduleId);
            const state = current ? ` It is currently ${current.status}.` : '';
            this.actionMessage.set(`${conflict.message}${state} Review the refreshed Schedule before trying again.`);
          } else this.actionMessage.set(null);
        },
        error: () => {
          if (hasCurrentData) this.stale.set(true);
          else this.loadFailed.set(true);
          this.loading.set(false);
          this.refreshing.set(false);
        },
      });
  }

  protected openCreateDialog(): void {
    if (this.stale() || this.refreshing()) return;
    this.dialog
      .open<NewScheduleDialog, undefined, Schedule>(NewScheduleDialog)
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((created) => {
        if (created) this.load();
      });
  }

  protected openEditDialog(row: ScheduleRowData): void {
    if (this.stale() || this.refreshing()) return;
    const ref = this.dialog.open<EditScheduleDialog, ScheduleRowData, Schedule>(EditScheduleDialog, { data: row });
    ref
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.load());
  }

  protected openExtendDialog(row: ScheduleRowData): void {
    if (this.stale() || this.refreshing() || row.accountRetired || row.schedule.status !== 'completed') return;
    this.actionMessage.set(null);
    this.dialog.open<ExtendScheduleDialog, ScheduleRowData>(ExtendScheduleDialog, { data: row });
  }

  protected openLifecycleDialog(row: ScheduleRowData, action: ScheduleLifecycleAction): void {
    if (this.stale() || this.refreshing() || (action === 'resume' && row.accountRetired)) return;
    this.actionMessage.set(null);
    this.dialog.open<ScheduleLifecycleDialog, ScheduleLifecycleDialogData>(ScheduleLifecycleDialog, {
      data: {
        schedule: row.schedule,
        action,
      },
    });
  }

  private onLifecycleEvent(event: ScheduleLifecycleEvent): void {
    if (event.kind === 'started') {
      this.busyScheduleIds.update((ids) => new Set(ids).add(event.scheduleId));
      this.actionMessage.set(null);
      return;
    }
    this.busyScheduleIds.update((ids) => {
      const next = new Set(ids);
      next.delete(event.kind === 'updated' ? event.schedule.id : event.scheduleId);
      return next;
    });
    if (event.kind === 'updated') {
      this.selectedView.set(STATUS_VIEW[event.schedule.status]);
      this.load();
    } else if (event.kind === 'conflict') this.load(event);
    else this.actionMessage.set(event.message);
  }
}
