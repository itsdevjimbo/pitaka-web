// PROTOTYPE — throwaway. Variant B: "inline, no dialog at all."
// Dense borderless rows on a divided list. The name is the edit surface: click
// it (or Rename) and it becomes an input in place, saved on Enter/blur, undone
// on Escape. Each section ends in a live "Add a category" row, so creating is
// typing at the bottom of the list rather than opening anything. Actions are
// icon buttons that appear on hover/focus — no ⋮ menu.
import { Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { PrototypeCategory } from './prototype-data';
import { PrototypeStore } from './prototype-store';

@Component({
  selector: 'prototype-variant-b',
  imports: [MatIconModule],
  template: `
    <div class="mx-auto flex w-full max-w-2xl flex-col gap-y-8 p-4 pb-24 sm:p-8 sm:pb-24">
      <header class="flex flex-col gap-y-1">
        <h1 class="text-2xl font-bold tracking-tight">Categories</h1>
        <p class="text-neutral-500 dark:text-neutral-400">
          Click a name to rename it. Type at the bottom of a list to add one.
        </p>
      </header>

      @if (store.hasRetired()) {
        <button
          class="-mt-4 self-start text-sm font-medium text-neutral-500 underline underline-offset-4 dark:text-neutral-400"
          type="button"
          (click)="showRetired.set(!showRetired())"
        >
          {{ showRetired() ? 'Hide retired' : 'Show retired' }}
        </button>
      }

      @for (section of sections; track section.kind) {
        <section class="flex flex-col">
          <h2 class="pb-1 text-xs font-semibold tracking-widest text-neutral-500 uppercase dark:text-neutral-400">
            {{ section.label }}
          </h2>

          <ul class="divide-y divide-neutral-200 dark:divide-neutral-800">
            @for (category of visible(section.kind); track category.id) {
              <li
                class="group flex items-center gap-x-2 py-1.5"
                [class.opacity-55]="!category.isActive"
              >
                @if (editingId() === category.id) {
                  <input
                    #editor
                    class="min-w-0 flex-auto rounded-md border border-neutral-400 px-2 py-1 dark:border-neutral-600"
                    [value]="category.name"
                    (keydown.enter)="commit(category, editor.value)"
                    (keydown.escape)="editingId.set(null)"
                    (blur)="commit(category, editor.value)"
                  />
                } @else {
                  <button
                    class="min-w-0 flex-auto truncate rounded-md px-2 py-1 text-left hover:bg-neutral-100 disabled:hover:bg-transparent dark:hover:bg-neutral-900"
                    type="button"
                    [disabled]="category.isDefault"
                    (click)="editingId.set(category.id)"
                  >
                    {{ category.name }}
                  </button>
                  @if (category.isDefault) {
                    <span class="shrink-0 text-2xs font-semibold tracking-wide text-neutral-400 uppercase">Pitaka</span>
                  }
                  @if (!category.isActive) {
                    <span class="shrink-0 text-2xs font-semibold tracking-wide text-neutral-400 uppercase">Retired</span>
                  }
                  @if (!category.isDefault) {
                    <span class="flex shrink-0 gap-x-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
                      <button class="rounded-md p-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-900"
                        type="button" [attr.aria-label]="category.isActive ? 'Retire' : 'Reactivate'"
                        (click)="store.toggleActive(category.id)">
                        <mat-icon class="size-4 text-neutral-500" [svgIcon]="category.isActive ? 'archive' : 'archive-restore'" />
                      </button>
                      <button class="rounded-md p-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-900"
                        type="button" aria-label="Delete" (click)="store.delete(category.id)">
                        <mat-icon class="size-4 text-neutral-500" svgIcon="trash-2" />
                      </button>
                    </span>
                  }
                }
              </li>
            }

            <li class="flex items-center gap-x-2 py-1.5">
              <mat-icon class="size-4 shrink-0 text-neutral-400" svgIcon="plus" />
              <input
                #adder
                class="min-w-0 flex-auto bg-transparent px-1 py-1 placeholder:text-neutral-400 focus:outline-none"
                placeholder="Add a {{ section.label.toLowerCase() }} category"
                (keydown.enter)="create(section.kind, adder)"
              />
            </li>
          </ul>
        </section>
      }
    </div>
  `,
})
export class VariantB {
  protected readonly store = inject(PrototypeStore);

  protected readonly showRetired = signal(false);
  protected readonly editingId = signal<number | null>(null);
  protected readonly sections = [
    { kind: 'expense' as const, label: 'Expense' },
    { kind: 'income' as const, label: 'Income' },
  ];

  protected visible(kind: 'income' | 'expense'): PrototypeCategory[] {
    const rows = kind === 'expense' ? this.store.expense() : this.store.income();
    return this.showRetired() ? rows : rows.filter((c) => c.isActive);
  }

  protected commit(category: PrototypeCategory, value: string): void {
    if (this.editingId() !== category.id) return;
    const name = value.trim();
    if (name && name !== category.name) this.store.rename(category.id, name);
    this.editingId.set(null);
  }

  protected create(kind: 'income' | 'expense', input: HTMLInputElement): void {
    const name = input.value.trim();
    if (!name) return;
    this.store.create(name, kind);
    input.value = '';
  }
}
