// PROTOTYPE — throwaway. Variant C: "two panes, search first."
// The density answer: Expense and Income sit side by side on desktop (stacked
// on phone), each pane a self-contained board with its own count, its own
// search field, its own Active/Retired/All filter, and its own add field pinned
// at the top. Scanning dozens is a filter problem, so the filter is the primary
// affordance rather than the list. Rename opens a dialog (A's affordance) so
// the pane's own controls never fight the row's.
import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { PrototypeCategory } from './prototype-data';
import { PrototypeStore } from './prototype-store';
import { PrototypeCategoryDialog } from './variant-a';

type Filter = 'active' | 'retired' | 'all';

@Component({
  selector: 'prototype-variant-c',
  imports: [MatButtonModule, MatIconModule],
  template: `
    <div class="mx-auto flex w-full max-w-5xl flex-col gap-y-6 p-4 pb-24 sm:p-8 sm:pb-24">
      <header class="flex flex-col gap-y-1">
        <h1 class="text-2xl font-bold tracking-tight">Categories</h1>
        <p class="text-neutral-500 dark:text-neutral-400">
          How you file what you spend and earn.
        </p>
      </header>

      <div class="grid gap-6 lg:grid-cols-2">
        @for (section of sections; track section.kind) {
          <section class="flex flex-col gap-y-3 rounded-2xl border border-neutral-200 p-4 dark:border-neutral-800">
            <div class="flex items-baseline justify-between gap-x-3">
              <h2 class="text-lg font-semibold tracking-tight">{{ section.label }}</h2>
              <span class="text-sm text-neutral-500 tabular-nums dark:text-neutral-400">
                {{ rows(section.kind).length }} shown
              </span>
            </div>

            <!-- Add, pinned at the top of its own pane: the kind is the pane -->
            <div class="flex items-center gap-x-2 rounded-lg bg-neutral-100 px-2 py-1.5 dark:bg-neutral-900">
              <mat-icon class="size-4 shrink-0 text-neutral-400" svgIcon="plus" />
              <input
                #adder
                class="min-w-0 flex-auto bg-transparent py-0.5 placeholder:text-neutral-400 focus:outline-none"
                placeholder="New {{ section.label.toLowerCase() }} category"
                (keydown.enter)="create(section.kind, adder)"
              />
            </div>

            <!-- Search + filter: the primary affordance at this density -->
            <div class="flex flex-wrap items-center gap-2">
              <div class="flex min-w-40 flex-auto items-center gap-x-2 rounded-lg border border-neutral-200 px-2 py-1.5 dark:border-neutral-800">
                <mat-icon class="size-4 shrink-0 text-neutral-400" svgIcon="search" />
                <input
                  class="min-w-0 flex-auto bg-transparent py-0.5 text-sm placeholder:text-neutral-400 focus:outline-none"
                  placeholder="Filter"
                  [value]="query()[section.kind]"
                  (input)="setQuery(section.kind, $event)"
                />
              </div>
              <div class="flex shrink-0 overflow-hidden rounded-lg border border-neutral-200 text-sm dark:border-neutral-800">
                @for (option of filters; track option) {
                  <button
                    class="px-2.5 py-1 capitalize"
                    type="button"
                    [class]="filter()[section.kind] === option
                      ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900'
                      : 'hover:bg-neutral-100 dark:hover:bg-neutral-900'"
                    (click)="setFilter(section.kind, option)"
                  >
                    {{ option }}
                  </button>
                }
              </div>
            </div>

            <ul class="flex flex-col">
              @for (category of rows(section.kind); track category.id) {
                <li
                  class="group flex items-center gap-x-2 rounded-lg px-2 py-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-900"
                  [class.opacity-55]="!category.isActive"
                >
                  <span class="min-w-0 flex-auto truncate text-sm">{{ category.name }}</span>
                  @if (category.isDefault) {
                    <mat-icon class="size-4 shrink-0 text-neutral-400" svgIcon="lock" aria-label="Supplied by Pitaka" />
                  }
                  @if (!category.isActive) {
                    <span class="shrink-0 text-2xs font-semibold tracking-wide text-neutral-400 uppercase">Retired</span>
                  }
                  @if (!category.isDefault) {
                    <span class="flex shrink-0 gap-x-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
                      <button class="rounded p-1" type="button" aria-label="Rename" (click)="rename(category)">
                        <mat-icon class="size-4 text-neutral-500" svgIcon="pencil" />
                      </button>
                      <button class="rounded p-1" type="button"
                        [attr.aria-label]="category.isActive ? 'Retire' : 'Reactivate'"
                        (click)="store.toggleActive(category.id)">
                        <mat-icon class="size-4 text-neutral-500" [svgIcon]="category.isActive ? 'archive' : 'archive-restore'" />
                      </button>
                      <button class="rounded p-1" type="button" aria-label="Delete" (click)="store.delete(category.id)">
                        <mat-icon class="size-4 text-neutral-500" svgIcon="trash-2" />
                      </button>
                    </span>
                  }
                </li>
              } @empty {
                <li class="px-2 py-6 text-center text-sm text-neutral-500 dark:text-neutral-400">
                  Nothing matches.
                </li>
              }
            </ul>
          </section>
        }
      </div>
    </div>
  `,
})
export class VariantC {
  protected readonly store = inject(PrototypeStore);
  private dialog = inject(MatDialog);

  protected readonly filters: Filter[] = ['active', 'retired', 'all'];
  protected readonly sections = [
    { kind: 'expense' as const, label: 'Expense' },
    { kind: 'income' as const, label: 'Income' },
  ];

  protected readonly query = signal<Record<string, string>>({ expense: '', income: '' });
  protected readonly filter = signal<Record<string, Filter>>({ expense: 'active', income: 'active' });

  protected rows(kind: 'income' | 'expense'): PrototypeCategory[] {
    const all = kind === 'expense' ? this.store.expense() : this.store.income();
    const q = this.query()[kind].trim().toLowerCase();
    const f = this.filter()[kind];
    return all
      .filter((c) => (f === 'all' ? true : f === 'active' ? c.isActive : !c.isActive))
      .filter((c) => !q || c.name.toLowerCase().includes(q));
  }

  protected setQuery(kind: string, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.query.update((q) => ({ ...q, [kind]: value }));
  }

  protected setFilter(kind: string, value: Filter): void {
    this.filter.update((f) => ({ ...f, [kind]: value }));
  }

  protected create(kind: 'income' | 'expense', input: HTMLInputElement): void {
    const name = input.value.trim();
    if (!name) return;
    this.store.create(name, kind);
    input.value = '';
  }

  protected rename(category: PrototypeCategory): void {
    this.dialog
      .open(PrototypeCategoryDialog, { data: { kind: category.kind, category } })
      .afterClosed()
      .subscribe((name) => name && this.store.rename(category.id, name.trim()));
  }
}
