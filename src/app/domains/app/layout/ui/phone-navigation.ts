import { Component } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { RouterLink, RouterLinkActive } from '@angular/router';

@Component({
  selector: 'app-phone-navigation',
  imports: [MatIcon, MatMenu, MatMenuItem, MatMenuTrigger, RouterLink, RouterLinkActive],
  template: `
    <nav
      class="grid grid-cols-5 border-t border-divider bg-surface px-1 pb-[max(.25rem,env(safe-area-inset-bottom))]"
      aria-label="Primary"
    >
      @for (item of destinations; track item.route) {
        <a
          class="flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-xs text-secondary"
          routerLinkActive="bg-soft text-text"
          [routerLink]="item.route"
          [routerLinkActiveOptions]="{ exact: false }"
        >
          <mat-icon
            class="size-5"
            [svgIcon]="item.icon"
          />
          <span>{{ item.label }}</span>
        </a>
      }
      <button
        class="flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-xs text-secondary"
        type="button"
        [matMenuTriggerFor]="moreMenu"
      >
        <mat-icon
          class="size-5"
          svgIcon="ellipsis"
        />
        <span>More</span>
      </button>
    </nav>
    <mat-menu
      #moreMenu="matMenu"
      xPosition="before"
      yPosition="above"
    >
      @for (item of moreDestinations; track item.route) {
        <a
          mat-menu-item
          [routerLink]="item.route"
        >
          <mat-icon [svgIcon]="item.icon" />
          <span>{{ item.label }}</span>
        </a>
      }
    </mat-menu>
  `,
})
export class PhoneNavigation {
  protected readonly destinations = [
    { label: 'Accounts', route: '/app/accounts', icon: 'wallet-cards' },
    { label: 'Transactions', route: '/app/transactions', icon: 'receipt-text' },
    { label: 'Budgets', route: '/app/budgets', icon: 'gauge' },
    { label: 'Goals', route: '/app/goals', icon: 'target' },
  ] as const;

  protected readonly moreDestinations = [
    { label: 'Schedules', route: '/app/schedules', icon: 'calendar-clock' },
    { label: 'Categories', route: '/app/categories', icon: 'shapes' },
    { label: 'Tags', route: '/app/tags', icon: 'tag' },
    { label: 'Profile', route: '/app/profile', icon: 'user-round' },
  ] as const;
}
