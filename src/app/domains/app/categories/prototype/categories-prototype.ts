// PROTOTYPE — throwaway route for #95. Three structurally different takes on
// the Categories screen on one route, switchable with `?variant=A|B|C` or the
// floating bar (← / → also work). Not production: no API, no tests, no error
// handling. Delete with the `prototype/categories-list` branch.
import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { map } from 'rxjs';
import { PrototypeStore } from './prototype-store';
import { PrototypeSwitcher } from './prototype-switcher';
import { VariantA } from './variant-a';
import { VariantB } from './variant-b';
import { VariantC } from './variant-c';

const NAMES: Record<string, string> = {
  A: 'Accounts precedent (dialogs)',
  B: 'Inline rows (no dialog)',
  C: 'Two panes, search first',
};

@Component({
  selector: 'prototype-categories',
  imports: [VariantA, VariantB, VariantC, PrototypeSwitcher],
  providers: [PrototypeStore],
  template: `
    @switch (variant()) {
      @case ('B') { <prototype-variant-b /> }
      @case ('C') { <prototype-variant-c /> }
      @default { <prototype-variant-a /> }
    }
    <prototype-switcher [current]="variant()" [names]="names" />
  `,
})
export default class CategoriesPrototype {
  private route = inject(ActivatedRoute);

  protected readonly names = NAMES;
  protected readonly variant = toSignal(
    this.route.queryParamMap.pipe(map((params) => params.get('variant') ?? 'A')),
    { initialValue: 'A' }
  );
}
