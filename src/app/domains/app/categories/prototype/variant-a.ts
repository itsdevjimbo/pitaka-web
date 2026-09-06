// PROTOTYPE — throwaway. Variant A: "the Accounts precedent, applied."
// Two headed sections of bordered card rows, a per-row ⋮ menu, a Show-retired
// checkbox, and create/rename in a MatDialog (ADR 0013). The baseline #95 asks
// whether to keep.
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { DialogShell } from '@/app/core/dialog';
import { PrototypeCategory } from './prototype-data';
import { PrototypeStore } from './prototype-store';

type DialogData = { kind: 'income' | 'expense'; category: PrototypeCategory | null };

@Component({
  selector: 'prototype-category-dialog',
  imports: [DialogShell, FormsModule, MatButtonModule, MatDialogModule],
  template: `
    <app-dialog-shell [heading]="heading">
      <form
        class="flex flex-col gap-y-4 pb-2"
        (ngSubmit)="dialogRef.close(name())"
      >
        <label class="flex flex-col gap-y-1">
          <span class="text-sm font-medium">Name</span>
          <input
            class="rounded-lg border border-neutral-300 px-3 py-2 dark:border-neutral-700"
            autofocus
            [ngModel]="name()"
            (ngModelChange)="name.set($event)"
            name="name"
          />
        </label>
        <div class="flex justify-end gap-x-2">
          <button matButton type="button" (click)="dialogRef.close()">Cancel</button>
          <button matButton="filled" type="submit" [disabled]="!name().trim()">Save</button>
        </div>
      </form>
    </app-dialog-shell>
  `,
})
export class PrototypeCategoryDialog {
  protected readonly dialogRef = inject<MatDialogRef<PrototypeCategoryDialog, string>>(MatDialogRef);
  private data = inject<DialogData>(MAT_DIALOG_DATA);

  protected readonly name = signal(this.data.category?.name ?? '');
  protected readonly heading = this.data.category
    ? `Rename ${this.data.kind} category`
    : `New ${this.data.kind} category`;
}

@Component({
  selector: 'prototype-variant-a',
  imports: [MatButtonModule, MatIconModule, MatMenuModule],
  template: `
    <div class="mx-auto flex w-full max-w-2xl flex-col gap-y-8 p-4 pb-24 sm:p-8 sm:pb-24">
      <header class="flex items-start justify-between gap-x-4">
        <div class="flex flex-col gap-y-1">
          <h1 class="text-2xl font-bold tracking-tight">Categories</h1>
          <p class="text-neutral-500 dark:text-neutral-400">
            How you file what you spend and earn.
          </p>
        </div>
        @if (store.hasRetired()) {
          <div class="flex shrink-0 items-center gap-x-2">
            <input id="a-retired" type="checkbox" class="size-4"
              [checked]="showRetired()" (change)="showRetired.set(!showRetired())" />
            <label for="a-retired" class="text-sm font-medium select-none">Show retired</label>
          </div>
        }
      </header>

      @for (section of sections; track section.kind) {
        <section class="flex flex-col gap-y-3">
          <div class="flex items-center justify-between gap-x-4">
            <h2 class="text-lg font-semibold tracking-tight">{{ section.label }}</h2>
            <button matButton="filled" (click)="add(section.kind)">
              <mat-icon svgIcon="plus" />
              Add
            </button>
          </div>

          <ul class="flex flex-col gap-y-2">
            @for (category of visible(section.kind); track category.id) {
              <li
                class="flex items-center gap-x-3 rounded-xl border border-neutral-200 px-4 py-3 dark:border-neutral-800"
                [class.opacity-55]="!category.isActive"
              >
                <span class="min-w-0 flex-auto truncate font-medium">{{ category.name }}</span>
                @if (category.isDefault) {
                  <span class="shrink-0 rounded bg-neutral-200 px-1.5 py-0.5 text-2xs font-semibold tracking-wide uppercase dark:bg-neutral-700">Default</span>
                }
                @if (!category.isActive) {
                  <span class="shrink-0 rounded bg-neutral-200 px-1.5 py-0.5 text-2xs font-semibold tracking-wide uppercase dark:bg-neutral-700">Retired</span>
                }
                @if (!category.isDefault) {
                  <button matIconButton class="shrink-0" aria-label="Category actions" [matMenuTriggerFor]="menu">
                    <mat-icon svgIcon="ellipsis-vertical" />
                  </button>
                  <mat-menu #menu>
                    <button mat-menu-item (click)="rename(category)">
                      <mat-icon svgIcon="pencil" /><span>Rename</span>
                    </button>
                    <button mat-menu-item (click)="store.toggleActive(category.id)">
                      <mat-icon [svgIcon]="category.isActive ? 'archive' : 'archive-restore'" />
                      <span>{{ category.isActive ? 'Retire' : 'Reactivate' }}</span>
                    </button>
                    <button mat-menu-item (click)="store.delete(category.id)">
                      <mat-icon svgIcon="trash-2" /><span>Delete</span>
                    </button>
                  </mat-menu>
                } @else {
                  <span class="size-10 shrink-0"></span>
                }
              </li>
            }
          </ul>
        </section>
      }
    </div>
  `,
})
export class VariantA {
  protected readonly store = inject(PrototypeStore);
  private dialog = inject(MatDialog);

  protected readonly showRetired = signal(false);
  protected readonly sections = [
    { kind: 'expense' as const, label: 'Expense' },
    { kind: 'income' as const, label: 'Income' },
  ];

  protected visible(kind: 'income' | 'expense'): PrototypeCategory[] {
    const rows = kind === 'expense' ? this.store.expense() : this.store.income();
    return this.showRetired() ? rows : rows.filter((c) => c.isActive);
  }

  protected add(kind: 'income' | 'expense'): void {
    this.dialog
      .open(PrototypeCategoryDialog, { data: { kind, category: null } })
      .afterClosed()
      .subscribe((name) => name && this.store.create(name.trim(), kind));
  }

  protected rename(category: PrototypeCategory): void {
    this.dialog
      .open(PrototypeCategoryDialog, { data: { kind: category.kind, category } })
      .afterClosed()
      .subscribe((name) => name && this.store.rename(category.id, name.trim()));
  }
}
