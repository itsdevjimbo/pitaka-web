import {
  Component,
  computed,
  HostListener,
  inject,
  isDevMode,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute, Router } from '@angular/router';

type Variant = 'A' | 'B' | 'C';
type Section = 'name' | 'email' | 'password';

const VARIANTS: readonly Variant[] = ['A', 'B', 'C'];
const VARIANT_NAMES: Record<Variant, string> = {
  A: 'Calm stack',
  B: 'Identity dashboard',
  C: 'Task rail',
};

/**
 * PROTOTYPE: Three variants of the Profile screen, switchable via `?variant=`,
 * on the authenticated `/app/profile-prototype` route. Layout only; no writes.
 */
@Component({
  selector: 'profile-prototype',
  templateUrl: './profile-prototype.html',
  imports: [MatButtonModule, MatIconModule],
  host: {
    class: 'flex flex-auto flex-col',
  },
})
export default class ProfilePrototype {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly queryParams = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });

  protected readonly showSwitcher = isDevMode();
  protected readonly activeSection = signal<Section>('email');
  protected readonly variant = computed<Variant>(() => {
    const requested = this.queryParams().get('variant');
    return requested === 'B' || requested === 'C' ? requested : 'A';
  });
  protected readonly variantName = computed(
    () => VARIANT_NAMES[this.variant()]
  );

  protected chooseSection(section: Section): void {
    this.activeSection.set(section);
  }

  protected previousVariant(): void {
    this.cycleVariant(-1);
  }

  protected nextVariant(): void {
    this.cycleVariant(1);
  }

  @HostListener('document:keydown', ['$event'])
  protected onKeydown(event: KeyboardEvent): void {
    if (!this.showSwitcher || this.isEditing(event.target)) {
      return;
    }
    if (event.key === 'ArrowLeft') {
      this.previousVariant();
    } else if (event.key === 'ArrowRight') {
      this.nextVariant();
    }
  }

  private cycleVariant(direction: -1 | 1): void {
    const current = VARIANTS.indexOf(this.variant());
    const next = (current + direction + VARIANTS.length) % VARIANTS.length;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { variant: VARIANTS[next] },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private isEditing(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) {
      return false;
    }
    return (
      target.matches('input, textarea, select') || target.isContentEditable
    );
  }
}
