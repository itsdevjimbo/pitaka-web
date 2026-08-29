import { Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import {
  MatSidenav,
  MatSidenavContainer,
  MatSidenavContent,
} from '@angular/material/sidenav';
import { RouterOutlet } from '@angular/router';
import { Media } from '@/app/core/media';
import { SchemeSwitcher } from '@/app/domains/app/layout/ui/scheme-switcher';
import { AppSidebar } from '@/app/domains/app/layout/ui/sidebar';

@Component({
  selector: 'app-layout',
  imports: [
    MatIconModule,
    MatButtonModule,
    RouterOutlet,
    MatSidenavContainer,
    MatSidenav,
    MatSidenavContent,
    AppSidebar,
    SchemeSwitcher,
  ],
  template: `
    <mat-sidenav-container>
      <mat-sidenav
        class="w-70 border-r border-neutral-200 scheme-dark dark:border-neutral-800 dark:bg-neutral-900 print:hidden"
        [mode]="isMobile() ? 'over' : 'side'"
        [opened]="!isMobile()"
        [disableClose]="!isMobile()"
        fixedInViewport
        #sidenav="matSidenav"
      >
        <app-sidebar />
      </mat-sidenav>

      <mat-sidenav-content
        class="flex flex-col lg:h-dvh lg:overflow-hidden print:ml-0! print:h-auto print:overflow-visible"
      >
        <!-- Toolbar -->
        <div class="flex items-center border-b px-4 py-2.5 print:hidden">
          <button
            matIconButton
            (click)="sidenav.toggle()"
          >
            <mat-icon svgIcon="panel-left" />
          </button>

          <!-- Spacer -->
          <div class="flex-auto"></div>

          <scheme-switcher />
        </div>

        <!-- Content -->
        <div
          class="flex flex-col lg:min-h-0 lg:flex-auto lg:overflow-auto print:overflow-visible"
        >
          <router-outlet />
        </div>
      </mat-sidenav-content>
    </mat-sidenav-container>
  `,
})
export class AppLayout {
  // Dependencies
  private media = inject(Media);

  // State
  protected isMobile = computed(() =>
    this.media.match(`(max-width: 1023px)`)()
  );
}
