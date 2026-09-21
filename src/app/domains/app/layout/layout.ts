import { Component, computed, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatSidenav, MatSidenavContainer, MatSidenavContent } from '@angular/material/sidenav';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { Media } from '@/app/core/media';
import { PhoneNavigation } from './ui/phone-navigation';
import { AppSidebar } from './ui/sidebar';
import { User } from './ui/user';

@Component({
  selector: 'app-layout',
  imports: [
    RouterLink,
    RouterOutlet,
    MatSidenavContainer,
    MatSidenav,
    MatSidenavContent,
    AppSidebar,
    PhoneNavigation,
    User,
  ],
  template: `
    <mat-sidenav-container>
      @if (!isMobile()) {
        <mat-sidenav
          class="w-70 border-r border-divider bg-surface print:hidden"
          mode="side"
          [opened]="true"
          [disableClose]="true"
          fixedInViewport
        >
          <app-sidebar />
        </mat-sidenav>
      }

      <mat-sidenav-content
        class="flex flex-col lg:h-dvh lg:overflow-hidden print:ml-0! print:h-auto print:overflow-visible"
      >
        @if (isMobile()) {
          <header class="flex min-h-16 items-center border-b border-divider bg-surface px-4 print:hidden">
            <a
              class="flex min-h-11 items-center gap-2 no-underline"
              routerLink="/app/accounts"
              aria-label="Pitaka home"
            >
              <img
                src="/images/logo/logo.svg"
                class="size-8 dark:hidden"
                alt=""
              />
              <img
                src="/images/logo/logo-on-dark.svg"
                class="hidden size-8 dark:block"
                alt=""
              />
              <span class="font-display text-xl text-text">Pitaka</span>
            </a>
            <user class="ml-auto block max-w-56" />
          </header>
        }

        <!-- Content -->
        <main
          id="app-main"
          class="flex flex-col lg:min-h-0 lg:flex-auto lg:overflow-auto print:overflow-visible"
        >
          <router-outlet />
        </main>

        @if (isMobile()) {
          <app-phone-navigation class="sticky bottom-0 z-40 block print:hidden" />
        }
      </mat-sidenav-content>
    </mat-sidenav-container>
  `,
})
export class AppLayout {
  // Dependencies
  private media = inject(Media);
  private router = inject(Router);

  // State
  protected isMobile = computed(() => this.media.match(`(max-width: 1023px)`)());

  constructor() {
    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => {
        queueMicrotask(() => {
          const heading = document.querySelector<HTMLElement>('#app-main h1');
          heading?.setAttribute('tabindex', '-1');
          heading?.focus();
        });
      });
  }
}
