import { Component, computed, inject } from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatPseudoCheckbox } from '@angular/material/core';
import { MatIcon } from '@angular/material/icon';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { Scheme } from './models/theming';
import { Theming } from './theming';

@Component({
  selector: 'app-appearance-menu',
  imports: [MatIcon, MatIconButton, MatMenu, MatMenuItem, MatMenuTrigger, MatPseudoCheckbox],
  template: `
    <button
      matIconButton
      type="button"
      aria-label="Appearance"
      [matMenuTriggerFor]="appearanceMenu"
    >
      <mat-icon svgIcon="sun-moon" />
    </button>
    <mat-menu #appearanceMenu="matMenu">
      @for (item of choices; track item.value) {
        <button
          mat-menu-item
          type="button"
          (click)="choose(item.value)"
        >
          <span class="flex min-w-36 items-center gap-2">
            <span class="flex-auto">{{ item.label }}</span>
            <mat-pseudo-checkbox
              appearance="minimal"
              [state]="scheme() === item.value ? 'checked' : 'unchecked'"
            />
          </span>
        </button>
      }
    </mat-menu>
    @if (notice(); as message) {
      <p
        class="fixed right-4 bottom-4 z-100 rounded-2xl bg-raised px-4 py-3 text-sm text-text shadow-lg"
        role="status"
      >
        {{ message }}
      </p>
    }
  `,
})
export class AppearanceMenu {
  private readonly theming = inject(Theming);

  protected readonly scheme = computed(() => this.theming.scheme());
  protected readonly notice = this.theming.persistenceNotice;
  protected readonly choices: readonly { label: string; value: Scheme }[] = [
    { label: 'System', value: 'system' },
    { label: 'Light', value: 'light' },
    { label: 'Dark', value: 'dark' },
  ];

  protected choose(scheme: Scheme): void {
    this.theming.setScheme(scheme);
  }
}
