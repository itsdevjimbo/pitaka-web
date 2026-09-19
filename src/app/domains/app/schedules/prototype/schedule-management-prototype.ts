import { Component, HostListener, computed, inject, isDevMode, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';

type VariantKey = 'A' | 'B' | 'C';
type ScheduleState = 'Active' | 'Paused' | 'Completed' | 'Cancelled';

type Schedule = {
  name: string;
  amount: string;
  direction: 'Income' | 'Expense';
  account: string;
  category: string;
  cadence: string;
  next: string;
  state: ScheduleState;
  generated: number;
};

/**
 * Three variants of Schedule management, switchable via `?variant=`, on the
 * throwaway `/app/prototype/schedules` route.
 */
@Component({
  selector: 'schedule-management-prototype',
  templateUrl: './schedule-management-prototype.html',
  host: { class: 'flex flex-auto flex-col' },
})
export default class ScheduleManagementPrototype {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly queryParams = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });

  protected readonly variants: readonly VariantKey[] = ['A', 'B', 'C'];
  protected readonly variantNames: Record<VariantKey, string> = {
    A: 'Grouped list',
    B: 'Timeline + cards',
    C: 'Master detail',
  };
  protected readonly isPrototype = isDevMode();
  protected readonly variant = computed<VariantKey>(() => {
    const requested = this.queryParams().get('variant');
    return requested === 'B' || requested === 'C' ? requested : 'A';
  });
  protected readonly pastOpen = signal(false);
  protected readonly dialog = signal<'new' | 'edit' | 'pause' | 'resume' | 'extend' | null>(null);
  protected readonly section = signal<'Upcoming' | 'Paused' | 'Past'>('Upcoming');
  protected readonly sections = ['Upcoming', 'Paused', 'Past'] as const;
  protected readonly stateOverrides = signal<Record<string, ScheduleState>>({});
  protected readonly notice = signal('');
  protected readonly selected = signal('Rent');

  protected readonly schedules: readonly Schedule[] = [
    {
      name: 'Salary',
      amount: '₱82,000',
      direction: 'Income',
      account: 'BPI Savings',
      category: 'Salary',
      cadence: 'Monthly · every 15th',
      next: 'Tomorrow, 15 Sep',
      state: 'Active',
      generated: 14,
    },
    {
      name: 'Rent',
      amount: '₱18,500',
      direction: 'Expense',
      account: 'BPI Savings',
      category: 'Housing',
      cadence: 'Monthly · every 1st',
      next: '1 Oct',
      state: 'Active',
      generated: 9,
    },
    {
      name: 'Gym membership',
      amount: '₱2,200',
      direction: 'Expense',
      account: 'GCash',
      category: 'Health',
      cadence: 'Monthly · every 20th',
      next: '20 Sep',
      state: 'Paused',
      generated: 6,
    },
    {
      name: 'Freelance retainer',
      amount: '₱24,000',
      direction: 'Income',
      account: 'BPI Savings',
      category: 'Freelance',
      cadence: 'Monthly · every 30th',
      next: '—',
      state: 'Completed',
      generated: 12,
    },
    {
      name: 'Old cloud plan',
      amount: '₱750',
      direction: 'Expense',
      account: 'GCash',
      category: 'Software',
      cadence: 'Monthly · every 4th',
      next: '—',
      state: 'Cancelled',
      generated: 4,
    },
  ];

  protected readonly selectedSchedule = computed(
    () => this.schedules.find((item) => item.name === this.selected()) ?? this.schedules[0],
  );

  protected stateOf(item: Schedule): ScheduleState {
    return this.stateOverrides()[item.name] ?? item.state;
  }

  protected itemsFor(section: string): readonly Schedule[] {
    return this.schedules.filter((item) => {
      const state = this.stateOf(item);
      return section === 'Upcoming'
        ? state === 'Active'
        : section === 'Paused'
          ? state === 'Paused'
          : state === 'Completed' || state === 'Cancelled';
    });
  }

  protected confirmLifecycle(): void {
    const action = this.dialog();
    const state = action === 'pause' ? 'Paused' : 'Active';
    const name = this.selected();
    this.stateOverrides.update((states) => ({ ...states, [name]: state }));
    this.notice.set(`${name} is now ${state.toLowerCase()}. Prototype only; reload to reset.`);
    this.closeDialog();
  }

  protected choose(name: string): void {
    this.selected.set(name);
  }
  protected openDialog(kind: 'new' | 'edit' | 'pause' | 'resume' | 'extend', name?: string): void {
    if (name) this.choose(name);
    this.dialog.set(kind);
  }
  protected closeDialog(): void {
    this.dialog.set(null);
  }

  protected cycle(step: -1 | 1): void {
    const current = this.variants.indexOf(this.variant());
    const next = this.variants[(current + step + this.variants.length) % this.variants.length];
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { variant: next },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  @HostListener('document:keydown', ['$event'])
  protected onKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    if (target?.matches('input, textarea, [contenteditable="true"]')) return;
    if (event.key === 'ArrowLeft') this.cycle(-1);
    if (event.key === 'ArrowRight') this.cycle(1);
  }
}
