// PROTOTYPE — throwaway. Floating variant switcher: arrows, label, and ← / →.
import { Component, HostListener, inject, input } from '@angular/core';
import { Router } from '@angular/router';

@Component({
  selector: 'prototype-switcher',
  template: `
    <div
      class="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-x-1 rounded-full bg-neutral-900 py-1 pr-1 pl-1 text-white shadow-lg ring-1 ring-white/20 dark:bg-white dark:text-neutral-900"
    >
      <button
        class="size-8 rounded-full hover:bg-white/15 dark:hover:bg-black/10"
        type="button"
        aria-label="Previous variant"
        (click)="step(-1)"
      >
        ‹
      </button>
      <span class="px-2 text-sm font-semibold whitespace-nowrap">
        {{ current() }} — {{ names()[current()] }}
      </span>
      <button
        class="size-8 rounded-full hover:bg-white/15 dark:hover:bg-black/10"
        type="button"
        aria-label="Next variant"
        (click)="step(1)"
      >
        ›
      </button>
    </div>
  `,
})
export class PrototypeSwitcher {
  private router = inject(Router);

  readonly current = input.required<string>();
  readonly names = input.required<Record<string, string>>();

  @HostListener('document:keydown', ['$event'])
  protected onKey(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    if (
      target?.closest('input, textarea, [contenteditable], .cdk-overlay-container')
    ) {
      return;
    }
    if (event.key === 'ArrowLeft') this.step(-1);
    if (event.key === 'ArrowRight') this.step(1);
  }

  protected step(delta: number): void {
    const keys = Object.keys(this.names());
    const at = keys.indexOf(this.current());
    const next = keys[(at + delta + keys.length) % keys.length];
    void this.router.navigate([], {
      queryParams: { variant: next },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
