/** PROTOTYPE — throwaway. Variant A: Material chip grid with autocomplete. */
import { Component, computed, inject, model, signal } from '@angular/core';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { StubTagsService } from './stub-tags';

@Component({
  selector: 'proto-variant-a',
  imports: [
    MatFormFieldModule,
    MatChipsModule,
    MatAutocompleteModule,
    MatInputModule,
    MatIconModule,
  ],
  template: `
    <mat-form-field class="w-full">
      <mat-label>Tags</mat-label>
      <mat-chip-grid #grid>
        @for (tag of selectedTags(); track tag.id) {
          <mat-chip-row (removed)="remove(tag.id)">
            {{ tag.name }}
            <button
              matChipRemove
              type="button"
              [attr.aria-label]="'Remove ' + tag.name"
            >
              <span aria-hidden="true">×</span>
            </button>
          </mat-chip-row>
        }
      </mat-chip-grid>
      <input
        placeholder="Add a tag…"
        [matChipInputFor]="grid"
        [matAutocomplete]="auto"
        [value]="query()"
        (input)="query.set($any($event.target).value)"
        (matChipInputTokenEnd)="createFromInput()"
      />
      <mat-autocomplete
        #auto
        (optionSelected)="pick($event.option.value)"
      >
        @for (tag of matches(); track tag.id) {
          <mat-option [value]="tag.id">{{ tag.name }}</mat-option>
        }
        @if (canCreate()) {
          <mat-option [value]="'create'">Create “{{ query().trim() }}”</mat-option>
        }
      </mat-autocomplete>
      <mat-hint>
        @if (pending()) {
          Creating…
        } @else if (error()) {
          {{ error() }}
        } @else {
          Type to search. Enter adds a new tag.
        }
      </mat-hint>
    </mat-form-field>
  `,
})
export class VariantAChips {
  static readonly variantName = 'Chips + autocomplete';

  private stub = inject(StubTagsService);

  readonly selected = model<readonly number[]>([]);

  protected readonly query = signal('');
  protected readonly pending = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly selectedTags = computed(() =>
    this.stub.tags().filter((tag) => this.selected().includes(tag.id))
  );

  protected readonly matches = computed(() => {
    const q = this.query().trim().toLowerCase();
    return this.stub
      .tags()
      .filter(
        (tag) =>
          !this.selected().includes(tag.id) &&
          (q === '' || tag.name.toLowerCase().includes(q))
      )
      .slice(0, 8);
  });

  protected readonly canCreate = computed(() => {
    const q = this.query().trim().toLowerCase();
    return q !== '' && !this.stub.tags().some((t) => t.name.toLowerCase() === q);
  });

  protected pick(value: number | 'create'): void {
    if (value === 'create') {
      void this.createFromInput();
      return;
    }
    this.selected.update((ids) => [...ids, value]);
    this.query.set('');
  }

  protected remove(id: number): void {
    this.selected.update((ids) => ids.filter((existing) => existing !== id));
  }

  protected async createFromInput(): Promise<void> {
    const name = this.query().trim();
    if (name === '') return;
    this.error.set(null);
    this.pending.set(true);
    try {
      const created = await this.stub.create(name);
      this.selected.update((ids) => [...ids, created.id]);
      this.query.set('');
    } catch (rejection: any) {
      // The 409 the API returns on a duplicate. The tag exists; attach it.
      this.selected.update((ids) =>
        ids.includes(rejection.existing.id) ? ids : [...ids, rejection.existing.id]
      );
      this.query.set('');
      this.error.set(`“${name}” already existed — added it.`);
    } finally {
      this.pending.set(false);
    }
  }
}
