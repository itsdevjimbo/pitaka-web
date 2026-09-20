import { Component, computed, DestroyRef, inject, signal, ViewEncapsulation } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';

// THROWAWAY: five Pocket Pop mark concepts and five independently selectable font families.
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
  protected marks = [
    {
      key: 'A',
      name: 'Folded wallet',
      note: 'Closest to the original. A familiar wallet with a folded edge and generous clasp.',
      path: 'M11 13L28 6Q34 4 34 11V13 M13 13H35Q41 13 41 20V34Q41 41 34 41H13Q6 41 6 34V20Q6 13 13 13Z M41 24H32Q27 24 27 28Q27 32 32 32H41',
    },
    {
      key: 'B',
      name: 'Open pocket',
      note: 'A soft pocket with an open top. My first pick: friendly, simple, and readable when small.',
      path: 'M8 10H40V28Q40 39 24 43Q8 39 8 28Z M8 16Q24 27 40 16',
    },
    {
      key: 'C',
      name: 'Pocket p',
      note: 'An initial that becomes a pocket. The most distinctive direction; check whether the p reads clearly.',
      path: 'M11 42V10H26Q40 10 40 24Q40 36 26 36H11 M11 18Q24 29 38 18',
    },
    {
      key: 'D',
      name: 'Double pocket',
      note: 'Overlapping rounded pockets suggest keeping everyday money organized.',
      path: 'M7 7H31V24Q31 33 19 37Q7 33 7 24Z M18 15H42V32Q42 41 30 45Q18 41 18 32Z',
    },
    {
      key: 'E',
      name: 'Clasp wallet',
      note: 'A compact wallet. The clasp creates a strong silhouette with very little detail.',
      path: 'M12 10H36Q43 10 43 17V34Q43 41 36 41H12Q5 41 5 34V17Q5 10 12 10Z M43 21H31Q25 21 25 26Q25 31 31 31H43',
    },
  ];
  protected fonts = ['Plus Jakarta Sans', 'Outfit', 'Manrope', 'DM Sans', 'Geist'];
  protected variant = computed(() => this.marks.find((m) => m.key === this.params().get('variant')) ?? this.marks[1]);
  protected font = computed(() => this.fonts.find((f) => f === this.params().get('font')) ?? this.fonts[0]);
  protected fontNote = computed(() =>
    this.font() === 'Outfit'
      ? 'Outfit: peso symbol uses a fallback. Try Geist for UI.'
      : this.font() === 'DM Sans'
        ? 'DM Sans: peso uses a fallback; this file has proportional digits. Try Geist for UI.'
        : 'Native peso symbol and aligned digits available.',
  );
  protected appearance = signal('system');
  protected mono = signal(false);
  protected pairing = signal(false);
  private media = window.matchMedia('(prefers-color-scheme: dark)');
  private systemDark = signal(this.media.matches);
  protected dark = computed(
    () => this.appearance() === 'dark' || (this.appearance() === 'system' && this.systemDark()),
  );
  constructor() {
    const listener = (e: MediaQueryListEvent) => this.systemDark.set(e.matches);
    this.media.addEventListener('change', listener);
    inject(DestroyRef).onDestroy(() => this.media.removeEventListener('change', listener));
  }
  protected choose(key: string, value: string) {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { [key]: value },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
  protected cycle(step: number) {
    this.choose('variant', this.marks[(this.marks.indexOf(this.variant()) + step + 5) % 5].key);
  }
  protected onKey(event: KeyboardEvent) {
    if (event.target instanceof HTMLElement && event.target.closest('input,textarea,select,[contenteditable]')) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      this.cycle(event.key === 'ArrowLeft' ? -1 : 1);
    }
  }
}
