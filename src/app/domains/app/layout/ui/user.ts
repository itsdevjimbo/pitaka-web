import { Component, computed, inject } from '@angular/core';
import { MatPseudoCheckbox } from '@angular/material/core';
import { MatIcon } from '@angular/material/icon';
import { MatDivider } from '@angular/material/list';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { Session } from '@/app/core/session';
import { Scheme, Theming } from '@/app/core/theming';

@Component({
  selector: 'user',
  imports: [
    MatDivider,
    MatIcon,
    MatMenu,
    MatMenuItem,
    MatPseudoCheckbox,
    MatMenuTrigger,
  ],
  template: `
    <button
      class="flex w-full cursor-pointer items-center gap-x-3 rounded-xl p-2 text-left hover:bg-neutral-700/10 dark:hover:bg-neutral-300/10"
      [matMenuTriggerFor]="userMenu"
    >
      <span
        class="flex size-9 items-center justify-center rounded-lg bg-neutral-700/10 dark:bg-neutral-300/10"
      >
        <mat-icon
          class="size-5"
          svgIcon="user-round"
        />
      </span>
      <div class="flex min-w-0 flex-auto flex-col select-none">
        <div class="truncate font-medium">{{ profile()?.name }}</div>
        <div class="truncate text-sm text-neutral-500 dark:text-neutral-400">
          {{ profile()?.email }}
        </div>
      </div>
      <mat-icon
        class="size-4"
        svgIcon="ellipsis-vertical"
      />
    </button>

    <mat-menu
      class="min-w-60"
      xPosition="before"
      yPosition="above"
      #userMenu="matMenu"
    >
      <button
        mat-menu-item
        [matMenuTriggerFor]="appearanceMenu"
      >
        <mat-icon svgIcon="sun-moon" />
        Appearance
      </button>
      <mat-divider />
      <button
        mat-menu-item
        (click)="signOut()"
      >
        <mat-icon svgIcon="log-out" />
        Sign out
      </button>
    </mat-menu>

    <mat-menu #appearanceMenu="matMenu">
      @for (item of schemes; track item.value) {
        <button
          mat-menu-item
          (click)="updateScheme(item.value)"
        >
          <mat-pseudo-checkbox
            appearance="minimal"
            class="mr-2"
            [state]="scheme() === item.value ? 'checked' : 'unchecked'"
          />
          <span>{{ item.label }}</span>
        </button>
      }
    </mat-menu>
  `,
})
export class User {
  // Dependencies
  private theming = inject(Theming);
  private session = inject(Session);

  // State
  protected profile = this.session.profile;
  protected scheme = computed(() => this.theming.scheme());
  protected schemes: { label: string; value: Scheme }[] = [
    { label: 'Light', value: 'light' },
    { label: 'Dark', value: 'dark' },
    { label: 'System', value: 'system' },
  ];

  updateScheme(scheme: Scheme) {
    this.theming.scheme.set(scheme);
  }

  /** Leave deliberately: the session clears client-side and returns to sign-in. */
  signOut() {
    this.session.signOut();
  }
}
