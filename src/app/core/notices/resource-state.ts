import { Component, input, output } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';

export type ResourceStateKind = 'loading' | 'initial-error' | 'stale' | 'saved-stale';

/** Shared, accessible read-state feedback. Screens keep ownership of the read and retry. */
@Component({
  selector: 'app-resource-state',
  imports: [MatButton, MatIcon],
  template: `
    @switch (kind()) {
      @case ('loading') {
        <div
          class="grid gap-3"
          role="status"
          aria-live="polite"
        >
          <span>{{ message() || 'Loading…' }}</span>
          <span
            class="h-16 animate-pulse rounded-2xl bg-soft motion-reduce:animate-none"
            aria-hidden="true"
          ></span>
          <span
            class="h-16 animate-pulse rounded-2xl bg-soft motion-reduce:animate-none"
            aria-hidden="true"
          ></span>
        </div>
      }
      @case ('initial-error') {
        <section
          class="rounded-2xl bg-danger-container p-4 text-danger"
          role="alert"
        >
          <p>{{ message() || 'Couldn’t load this information.' }}</p>
          <button
            class="mt-3"
            matButton
            type="button"
            (click)="retry.emit()"
          >
            Retry
          </button>
        </section>
      }
      @case ('stale') {
        <section
          class="flex flex-wrap items-center gap-3 rounded-2xl bg-warning-container p-4 text-warning"
          role="status"
        >
          <mat-icon svgIcon="triangle-alert" />
          <p class="flex-auto">{{ message() || 'Couldn’t refresh. These figures may be out of date' }}</p>
          <button
            matButton
            type="button"
            (click)="retry.emit()"
          >
            Retry
          </button>
        </section>
      }
      @case ('saved-stale') {
        <section
          class="flex flex-wrap items-center gap-3 rounded-2xl bg-warning-container p-4 text-warning"
          role="status"
        >
          <mat-icon svgIcon="triangle-alert" />
          <p class="flex-auto">Saved, but couldn’t refresh</p>
          <button
            matButton
            type="button"
            (click)="retry.emit()"
          >
            Retry refresh
          </button>
        </section>
      }
    }
  `,
})
export class ResourceState {
  readonly kind = input.required<ResourceStateKind>();
  readonly message = input<string | null>(null);
  readonly retry = output<void>();
}
