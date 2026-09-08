/**
 * PROTOTYPE — throwaway. Variant C: a trigger button that opens a checklist
 * panel — search at the top, a checkbox per Tag, and a create row that appears
 * only when what was typed matches nothing. The form line itself stays one row
 * high no matter how many Tags are on the Transaction.
 */
import { Component, computed, inject, model, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { StubTagsService } from './stub-tags';

@Component({
  selector: 'proto-variant-c',
  imports: [MatButtonModule, MatCheckboxModule, MatFormFieldModule, MatInputModule],
  template: `
    <div class="relative flex flex-col gap-y-1">
      <span class="text-xs font-medium text-neutral-600 dark:text-neutral-400">
        Tags
      </span>
      <button
        matButton="outlined"
        type="button"
        class="w-full justify-between"
        (click)="open.set(!open())"
      >
        {{ triggerLabel() }}
      </button>

      @if (selectedTags().length) {
        <p class="text-xs text-neutral-600 dark:text-neutral-400">
          {{ selectedNames() }}
        </p>
      }

      @if (open()) {
        <div
          class="absolute top-full z-10 mt-1 w-full rounded-lg border border-neutral-200 bg-white p-2 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
        >
          <mat-form-field class="w-full">
            <mat-label>Search tags</mat-label>
            <input
              matInput
              [value]="query()"
              (input)="query.set($any($event.target).value)"
              (keydown.enter)="create($event)"
            />
          </mat-form-field>

          <div class="max-h-56 overflow-y-auto">
            @for (tag of matches(); track tag.id) {
              <mat-checkbox
                class="block"
                [checked]="selected().includes(tag.id)"
                (change)="toggle(tag.id)"
              >
                {{ tag.name }}
              </mat-checkbox>
            } @empty {
              <p class="px-2 py-3 text-sm text-neutral-600 dark:text-neutral-400">
                @if (stubTags().length === 0) {
                  You have no tags yet.
                } @else {
                  Nothing matches “{{ query().trim() }}”.
                }
              </p>
            }
          </div>

          @if (canCreate()) {
            <button
              matButton
              type="button"
              class="w-full"
              [disabled]="pending()"
              (click)="create($event)"
            >
              {{ pending() ? 'Creating…' : 'Create “' + query().trim() + '”' }}
            </button>
          }
          @if (error()) {
            <p class="px-2 py-1 text-xs text-red-700 dark:text-red-300">{{ error() }}</p>
          }
        </div>
      }
    </div>
  `,
})
export class VariantCPicker {
  static readonly variantName = 'Checklist popover';

  private stub = inject(StubTagsService);

  readonly selected = model<readonly number[]>([]);

  protected readonly stubTags = this.stub.tags;
  protected readonly open = signal(false);
  protected readonly query = signal('');
  protected readonly pending = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly selectedTags = computed(() =>
    this.stub.tags().filter((tag) => this.selected().includes(tag.id))
  );

  protected readonly selectedNames = computed(() =>
    this.selectedTags()
      .map((tag) => tag.name)
      .join(', ')
  );

  protected readonly triggerLabel = computed(() => {
    const count = this.selected().length;
    return count === 0 ? 'Choose tags' : `${count} tag${count === 1 ? '' : 's'}`;
  });

  protected readonly matches = computed(() => {
    const q = this.query().trim().toLowerCase();
    return this.stub
      .tags()
      .filter((tag) => q === '' || tag.name.toLowerCase().includes(q));
  });

  protected readonly canCreate = computed(() => {
    const q = this.query().trim().toLowerCase();
    return q !== '' && !this.stub.tags().some((t) => t.name.toLowerCase() === q);
  });

  protected toggle(id: number): void {
    this.selected.update((ids) =>
      ids.includes(id) ? ids.filter((existing) => existing !== id) : [...ids, id]
    );
  }

  protected async create(event: Event): Promise<void> {
    event.preventDefault();
    if (!this.canCreate() || this.pending()) return;
    const name = this.query().trim();
    this.error.set(null);
    this.pending.set(true);
    try {
      const created = await this.stub.create(name);
      this.selected.update((ids) => [...ids, created.id]);
      this.query.set('');
    } catch (rejection: any) {
      this.error.set(`“${rejection.existing.name}” already exists — tick it above.`);
    } finally {
      this.pending.set(false);
    }
  }
}
