/**
 * PROTOTYPE — throwaway, for wayfinder ticket #117.
 *
 * Four variants of the Tag entry control, switchable via `?variant=a|b|c|d`,
 * on the throwaway route `/app/tag-entry-prototype`.
 *
 * Sub-shape B by necessity: the real hosts are two *dialogs* over an Account
 * detail screen, opened by live data and closed by a live mutation — there is
 * no page to mount variants inside without wiring the prototype to real
 * writes. So both host forms are reproduced here at dialog width, with the
 * fields either form really has around the Tag control, to keep the density
 * honest. Tags come from an in-memory stub, never the API.
 */
import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { ActivatedRoute } from '@angular/router';
import { PrototypeSwitcher } from './prototype-switcher';
import { StubTagsService } from './stub-tags';
import { VariantAChips } from './variant-a-chips';
import { VariantBSelect } from './variant-b-select';
import { VariantCPicker } from './variant-c-picker';
import { VariantDText } from './variant-d-text';

const VARIANTS = ['a', 'b', 'c', 'd'] as const;

const LABELS: Record<string, string> = {
  a: VariantAChips.variantName,
  b: VariantBSelect.variantName,
  c: VariantCPicker.variantName,
  d: VariantDText.variantName,
};

@Component({
  selector: 'transactions-tag-entry-prototype',
  imports: [
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    PrototypeSwitcher,
    VariantAChips,
    VariantBSelect,
    VariantCPicker,
    VariantDText,
  ],
  template: `
    <div class="flex flex-col gap-y-6 p-4 sm:p-6">
      <header class="flex flex-wrap items-center gap-3">
        <h1 class="text-lg font-semibold">Tag entry — prototype (#117)</h1>
        <button
          matButton="outlined"
          type="button"
          (click)="toggleCollection()"
        >
          {{ tags().length === 0 ? 'Use 30 tags' : 'Use zero tags' }}
        </button>
        <span class="text-sm text-neutral-600 dark:text-neutral-400">
          Selected ids: {{ recordSelected().join(', ') || '—' }}
          &nbsp;/&nbsp; refile: {{ refileSelected().join(', ') || '—' }}
        </span>
      </header>

      <div class="flex flex-col gap-6 lg:flex-row">
        <!-- Record: the Tag control at the end of a form that is already tall -->
        <section
          class="w-full max-w-lg rounded-2xl border border-neutral-200 p-4 shadow-sm sm:p-6 dark:border-neutral-700"
        >
          <h2 class="mb-4 text-base font-semibold">Record a transaction</h2>
          <div class="flex flex-col gap-y-4">
            <mat-form-field class="w-full">
              <mat-label>Amount</mat-label>
              <input
                matInput
                type="number"
                value="450"
              />
            </mat-form-field>
            <mat-form-field class="w-full">
              <mat-label>Category</mat-label>
              <mat-select value="1">
                <mat-option value="1">Food</mat-option>
                <mat-option value="2">Transport</mat-option>
              </mat-select>
            </mat-form-field>

            @switch (variant()) {
              @case ('a') {
                <proto-variant-a [(selected)]="recordSelected" />
              }
              @case ('b') {
                <proto-variant-b [(selected)]="recordSelected" />
              }
              @case ('c') {
                <proto-variant-c [(selected)]="recordSelected" />
              }
              @case ('d') {
                <proto-variant-d [(selected)]="recordSelected" />
              }
            }

            <div class="mt-2 flex justify-end gap-x-3">
              <button
                matButton
                type="button"
              >
                Cancel
              </button>
              <button
                matButton="filled"
                type="button"
              >
                Record
              </button>
            </div>
          </div>
        </section>

        <!-- Refile: the same control, arriving with Tags already on it -->
        <section
          class="w-full max-w-lg rounded-2xl border border-neutral-200 p-4 shadow-sm sm:p-6 dark:border-neutral-700"
        >
          <h2 class="mb-4 text-base font-semibold">Refile a transaction</h2>
          <p class="mb-4 text-sm text-neutral-600 dark:text-neutral-400">
            Expense · ₱450.00
          </p>
          <div class="flex flex-col gap-y-4">
            <mat-form-field class="w-full">
              <mat-label>Note</mat-label>
              <input
                matInput
                value="Lunch with the team"
              />
            </mat-form-field>

            @switch (variant()) {
              @case ('a') {
                <proto-variant-a [(selected)]="refileSelected" />
              }
              @case ('b') {
                <proto-variant-b [(selected)]="refileSelected" />
              }
              @case ('c') {
                <proto-variant-c [(selected)]="refileSelected" />
              }
              @case ('d') {
                <proto-variant-d [(selected)]="refileSelected" />
              }
            }

            <div class="mt-2 flex justify-end gap-x-3">
              <button
                matButton
                type="button"
              >
                Cancel
              </button>
              <button
                matButton="filled"
                type="button"
              >
                Save
              </button>
            </div>
          </div>
        </section>
      </div>

      <proto-switcher
        [variants]="variants"
        [current]="variant()"
        [label]="label()"
      />
    </div>
  `,
})
export default class TagEntryPrototype {
  private route = inject(ActivatedRoute);
  private stub = inject(StubTagsService);

  protected readonly variants = VARIANTS;
  protected readonly tags = this.stub.tags;

  private readonly params = toSignal(this.route.queryParamMap, {
    requireSync: true,
  });

  protected readonly variant = computed(() => {
    const asked = this.params().get('variant')?.toLowerCase() ?? 'a';
    return (VARIANTS as readonly string[]).includes(asked) ? asked : 'a';
  });

  protected readonly label = computed(() => LABELS[this.variant()]);

  /** Record starts empty; refile arrives with two Tags already on it. */
  protected readonly recordSelected = signal<readonly number[]>([]);
  protected readonly refileSelected = signal<readonly number[]>([1, 8]);

  protected toggleCollection(): void {
    if (this.tags().length === 0) {
      this.stub.useSeeded();
    } else {
      this.stub.useEmpty();
    }
  }
}
