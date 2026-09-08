/**
 * PROTOTYPE — throwaway. Variant D: the baseline. One plain text field,
 * comma-separated, resolved on blur — existing names match, unknown ones are
 * created. No new primitive at all; the whole control is an `<input>`.
 */
import { Component, computed, inject, model, signal } from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { StubTagsService } from './stub-tags';

@Component({
  selector: 'proto-variant-d',
  imports: [MatFormFieldModule, MatInputModule],
  template: `
    <mat-form-field class="w-full">
      <mat-label>Tags</mat-label>
      <input
        matInput
        placeholder="groceries, coffee"
        [value]="text()"
        (input)="text.set($any($event.target).value)"
        (blur)="resolve()"
      />
      <mat-hint>
        @if (pending()) {
          Resolving…
        } @else if (note()) {
          {{ note() }}
        } @else {
          Separate with commas. Unknown names become new tags.
        }
      </mat-hint>
    </mat-form-field>
  `,
})
export class VariantDText {
  static readonly variantName = 'Comma-separated text';

  private stub = inject(StubTagsService);

  readonly selected = model<readonly number[]>([]);

  protected readonly text = signal('');

  constructor() {
    // Refile arrives with Tags already on it: show their names, as the real
    // form would.
    this.text.set(this.names().map((tag) => tag.name).join(', '));
  }
  protected readonly pending = signal(false);
  protected readonly note = signal<string | null>(null);

  protected readonly names = computed(() =>
    this.stub.tags().filter((tag) => this.selected().includes(tag.id))
  );

  protected async resolve(): Promise<void> {
    const names = this.text()
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name !== '');
    if (names.length === 0) {
      this.selected.set([]);
      return;
    }
    this.pending.set(true);
    const ids: number[] = [];
    let created = 0;
    for (const name of names) {
      const existing = this.stub
        .tags()
        .find((tag) => tag.name.toLowerCase() === name.toLowerCase());
      if (existing) {
        ids.push(existing.id);
        continue;
      }
      try {
        const fresh = await this.stub.create(name);
        ids.push(fresh.id);
        created += 1;
      } catch (rejection: any) {
        // Raced with itself: the 409 hands back the tag that already exists.
        ids.push(rejection.existing.id);
      }
    }
    this.selected.set([...new Set(ids)]);
    this.text.set(
      this.stub
        .tags()
        .filter((tag) => ids.includes(tag.id))
        .map((tag) => tag.name)
        .join(', ')
    );
    this.note.set(created > 0 ? `Created ${created} new tag${created === 1 ? '' : 's'}.` : null);
    this.pending.set(false);
  }
}
