/**
 * PROTOTYPE — throwaway. Variant B: a plain multi-select, plus a separate
 * "new tag" field beneath it. No new primitives — `mat-select` is already all
 * over this form; the create path is an ordinary text input and a button.
 */
import { Component, computed, inject, model, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { StubTagsService } from './stub-tags';

@Component({
  selector: 'proto-variant-b',
  imports: [MatFormFieldModule, MatSelectModule, MatInputModule, MatButtonModule],
  template: `
    <div class="flex flex-col gap-y-2">
      <mat-form-field class="w-full">
        <mat-label>Tags</mat-label>
        <mat-select
          multiple
          [value]="selected()"
          (valueChange)="selected.set($event)"
        >
          @for (tag of tags(); track tag.id) {
            <mat-option [value]="tag.id">{{ tag.name }}</mat-option>
          }
          @if (tags().length === 0) {
            <mat-option disabled>No tags yet</mat-option>
          }
        </mat-select>
        <mat-hint>{{ summary() }}</mat-hint>
      </mat-form-field>

      @if (adding()) {
        <div class="flex items-start gap-x-2">
          <mat-form-field class="w-full">
            <mat-label>New tag</mat-label>
            <input
              matInput
              [value]="draft()"
              (input)="draft.set($any($event.target).value)"
              (keydown.enter)="create($event)"
            />
            @if (error()) {
              <mat-hint class="text-red-700">{{ error() }}</mat-hint>
            }
          </mat-form-field>
          <button
            matButton="filled"
            type="button"
            class="mt-2"
            [disabled]="draft().trim() === '' || pending()"
            (click)="create($event)"
          >
            {{ pending() ? 'Adding…' : 'Add' }}
          </button>
        </div>
      } @else {
        <button
          matButton
          type="button"
          class="self-start"
          (click)="adding.set(true)"
        >
          + New tag
        </button>
      }
    </div>
  `,
})
export class VariantBSelect {
  static readonly variantName = 'Multi-select + new-tag field';

  private stub = inject(StubTagsService);

  readonly selected = model<readonly number[]>([]);

  protected readonly tags = this.stub.tags;
  protected readonly draft = signal('');
  protected readonly adding = signal(false);
  protected readonly pending = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly summary = computed(() => {
    const count = this.selected().length;
    if (this.tags().length === 0) return 'You have no tags yet.';
    return count === 0 ? 'None chosen' : `${count} chosen`;
  });

  protected async create(event: Event): Promise<void> {
    event.preventDefault();
    const name = this.draft().trim();
    if (name === '' || this.pending()) return;
    this.error.set(null);
    this.pending.set(true);
    try {
      const created = await this.stub.create(name);
      this.selected.update((ids) => [...ids, created.id]);
      this.draft.set('');
      this.adding.set(false);
    } catch (rejection: any) {
      this.error.set(`You already have a tag called “${rejection.existing.name}”.`);
    } finally {
      this.pending.set(false);
    }
  }
}
