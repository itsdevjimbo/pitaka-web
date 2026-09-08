/** PROTOTYPE — throwaway. The floating variant switcher. */
import { Component, HostListener, inject, input } from '@angular/core';
import { Router } from '@angular/router';

@Component({
  selector: 'proto-switcher',
  template: `
    <div
      class="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-x-3 rounded-full bg-neutral-900 px-3 py-2 text-sm font-medium text-white shadow-xl"
    >
      <button
        type="button"
        class="px-2"
        aria-label="Previous variant"
        (click)="cycle(-1)"
      >
        ←
      </button>
      <span class="min-w-56 text-center">
        {{ current().toUpperCase() }} — {{ label() }}
      </span>
      <button
        type="button"
        class="px-2"
        aria-label="Next variant"
        (click)="cycle(1)"
      >
        →
      </button>
    </div>
  `,
})
export class PrototypeSwitcher {
  private router = inject(Router);

  readonly variants = input.required<readonly string[]>();
  readonly current = input.required<string>();
  readonly label = input.required<string>();

  @HostListener('document:keydown', ['$event'])
  protected onKey(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    const tag = target?.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) return;
    if (event.key === 'ArrowLeft') this.cycle(-1);
    if (event.key === 'ArrowRight') this.cycle(1);
  }

  protected cycle(step: number): void {
    const variants = this.variants();
    const index = variants.indexOf(this.current());
    const next = variants[(index + step + variants.length) % variants.length];
    void this.router.navigate([], {
      queryParams: { variant: next },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
