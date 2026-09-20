import { Component, computed, DestroyRef, inject, signal, ViewEncapsulation } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';

// THROWAWAY: Three brand directions on /auth/sign-in?variant=A|B|C.
// Question: which identity makes everyday money feel approachable in both schemes?
@Component({
  selector: 'pitaka-branding-prototype',
  templateUrl: './branding-prototype.html',
  styleUrl: './branding-prototype.css',
  encapsulation: ViewEncapsulation.None,
  host: { '(window:keydown)': 'onKey($event)' },
})
export class BrandingPrototype {
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private params = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });
  protected variant = computed(() => {
    const value = this.params().get('variant');
    return value === 'B' || value === 'C' ? value : 'A';
  });
  protected names = { A: 'Everyday Sage', B: 'Ink & Paper', C: 'Pocket Pop' };
  protected appearance = signal('system');
  private media = window.matchMedia('(prefers-color-scheme: dark)');
  private systemDark = signal(this.media.matches);
  protected dark = computed(
    () => this.appearance() === 'dark' || (this.appearance() === 'system' && this.systemDark()),
  );
  constructor() {
    const listener = (event: MediaQueryListEvent) => this.systemDark.set(event.matches);
    this.media.addEventListener('change', listener);
    inject(DestroyRef).onDestroy(() => this.media.removeEventListener('change', listener));
  }
  protected cycle(step: number) {
    const keys = ['A', 'B', 'C'];
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { variant: keys[(keys.indexOf(this.variant()) + step + 3) % 3] },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
  protected onKey(event: KeyboardEvent) {
    if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable]'))
      return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      this.cycle(event.key === 'ArrowLeft' ? -1 : 1);
    }
  }
}
