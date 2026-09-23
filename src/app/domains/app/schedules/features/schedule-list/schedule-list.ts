import { Component, computed, DestroyRef, ElementRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { forkJoin } from 'rxjs';
import { ResourceState } from '@/app/core/notices';
import { Account, AccountsService } from '@/app/domains/app/accounts';
import { CategoriesService, Category } from '@/app/domains/app/categories';
import { Schedule, ScheduleStatus, SchedulesService } from '../..';
import { ScheduleLifecycleCoordinator, ScheduleLifecycleEvent } from '../../data/schedule-lifecycle-coordinator';
import { ScheduleWriteFreshness } from '../../data/schedule-write';
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

type RefreshReason = 'ordinary' | 'after-write';

@Component({
  selector: 'schedule-list',
  templateUrl: './schedule-list.html',
  imports: [MatButtonModule, MatIconModule, ResourceState, ScheduleEmptyState, ScheduleLifecycleNav, ScheduleRow],
  host: { class: 'flex flex-auto flex-col' },
})
export default class ScheduleList {
  private readonly schedulesService = inject(SchedulesService);
  private readonly accountsService = inject(AccountsService);
  private readonly categoriesService = inject(CategoriesService);
  private readonly lifecycleCoordinator = inject(ScheduleLifecycleCoordinator);
  private readonly writeFreshness = inject(ScheduleWriteFreshness);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialog = inject(MatDialog);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private focusAfterDelete: number | 'heading' | null = null;
  private actionMessageTimer: ReturnType<typeof setTimeout> | null = null;

  protected readonly schedules = signal<readonly Schedule[] | null>(null);
  private readonly accounts = signal<readonly Account[]>([]);
  private readonly categories = signal<readonly Category[]>([]);
  protected readonly loading = signal(true);
  protected readonly refreshing = signal(false);
  protected readonly loadFailed = signal(false);
  protected readonly actionMessage = signal<string | null>(null);
  protected readonly actionMessageIsSuccess = signal(false);
  protected readonly busyScheduleIds = signal<ReadonlySet<number>>(new Set());

  /** True after a refresh failure until all three collections refresh successfully. */
  protected readonly stale = signal(false);
  protected readonly savedStale = signal(false);
  protected readonly uncertainWrite = signal(false);
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
    for (const row of this.rows()) {
      result[STATUS_VIEW[row.schedule.status]] += 1;
    }
    return result;
  });

  protected readonly empty = computed(() => this.schedules()?.length === 0);

  constructor() {
    this.destroyRef.onDestroy(() => {
      if (this.actionMessageTimer !== null) {
        clearTimeout(this.actionMessageTimer);
      }
    });
    this.lifecycleCoordinator.events
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((event) => this.onLifecycleEvent(event));
    this.writeFreshness.uncertain.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.stale.set(true);
      this.savedStale.set(false);
      this.uncertainWrite.set(true);
    });
    this.load();
  }

  protected load(conflict?: { scheduleId: number; message: string }, reason: RefreshReason = 'ordinary'): void {
    const hasCurrentData = this.schedules() !== null;
    if (hasCurrentData) {
      this.refreshing.set(true);
      this.uncertainWrite.set(false);
    } else {
      this.loading.set(true);
    }
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
          this.savedStale.set(false);
          this.uncertainWrite.set(false);
          this.loading.set(false);
          this.refreshing.set(false);
          if (conflict) {
            this.clearActionMessage();
            const current = schedules.find((schedule) => schedule.id === conflict.scheduleId);
            const state = current ? ` It is currently ${current.status}.` : '';
            this.actionMessage.set(`${conflict.message}${state} Review the refreshed Schedule before trying again.`);
          } else if (reason === 'ordinary') {
            this.clearActionMessage();
          }
          this.restoreDeleteFocus();
        },
        error: () => {
          if (hasCurrentData) {
            this.stale.set(true);
            this.savedStale.set(reason === 'after-write');
          } else {
            this.loadFailed.set(true);
          }
          this.loading.set(false);
          this.refreshing.set(false);
        },
      });
  }

  protected openCreateDialog(): void {
    if (this.stale() || this.refreshing()) {
      return;
    }
    this.dialog
      .open<NewScheduleDialog, undefined, Schedule>(NewScheduleDialog)
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((created) => {
        if (created) {
          this.showActionMessage(`${created.name} created.`);
          this.load(undefined, 'after-write');
        }
      });
  }

  protected openEditDialog(row: ScheduleRowData): void {
    if (this.stale() || this.refreshing()) {
      return;
    }
    const ref = this.dialog.open<EditScheduleDialog, ScheduleRowData, Schedule>(EditScheduleDialog, { data: row });
    ref
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((saved) => {
        if (saved) {
          this.showActionMessage(`${saved.name} saved.`);
          this.load(undefined, 'after-write');
        }
      });
  }

  protected openExtendDialog(row: ScheduleRowData): void {
    if (this.stale() || this.refreshing() || row.accountRetired || row.schedule.status !== 'completed') {
      return;
    }
    this.clearActionMessage();
    this.dialog.open<ExtendScheduleDialog, ScheduleRowData>(ExtendScheduleDialog, { data: row });
  }

  protected openLifecycleDialog(row: ScheduleRowData, action: ScheduleLifecycleAction): void {
    if (this.stale() || this.refreshing() || (action === 'resume' && row.accountRetired)) {
      return;
    }
    this.clearActionMessage();
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
      this.clearActionMessage();
      return;
    }
    this.busyScheduleIds.update((ids) => {
      const next = new Set(ids);
      next.delete(event.kind === 'updated' ? event.schedule.id : event.scheduleId);
      return next;
    });
    if (event.kind === 'updated') {
      this.selectedView.set(STATUS_VIEW[event.schedule.status]);
      this.showActionMessage(`${event.schedule.name} updated.`);
      this.load(undefined, 'after-write');
    } else if (event.kind === 'conflict') {
      this.load(event);
    } else {
      this.clearActionMessage();
      if (event.kind === 'uncertain') {
        this.stale.set(true);
        this.savedStale.set(false);
        this.uncertainWrite.set(true);
      }
      this.actionMessage.set(event.message);
    }
  }

  protected onScheduleDeleted(row: ScheduleRowData): void {
    const rows = this.visibleRows();
    const index = rows.findIndex((candidate) => candidate.schedule.id === row.schedule.id);
    this.focusAfterDelete = rows[index + 1]?.schedule.id ?? rows[index - 1]?.schedule.id ?? 'heading';
    this.restoreDeleteFocus();
    this.showActionMessage(`${row.schedule.name} deleted.`);
    this.load(undefined, 'after-write');
  }

  protected onDeleteConflict(conflict: { scheduleId: number; message: string }): void {
    this.clearActionMessage();
    this.load(conflict);
  }

  private restoreDeleteFocus(): void {
    const target = this.focusAfterDelete;
    if (target === null) {
      return;
    }
    this.focusAfterDelete = null;
    queueMicrotask(() => {
      const selector = target === 'heading' ? 'h1' : `[data-schedule-id="${target}"] button`;
      this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus();
    });
  }

  private showActionMessage(message: string): void {
    this.clearActionMessage();
    this.actionMessageIsSuccess.set(true);
    this.actionMessage.set(message);
    this.actionMessageTimer = setTimeout(() => {
      this.actionMessage.set(null);
      this.actionMessageTimer = null;
    }, 5_000);
  }

  private clearActionMessage(): void {
    if (this.actionMessageTimer !== null) {
      clearTimeout(this.actionMessageTimer);
      this.actionMessageTimer = null;
    }
    this.actionMessageIsSuccess.set(false);
    this.actionMessage.set(null);
  }
}
