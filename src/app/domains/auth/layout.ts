import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AppearanceMenu } from '@/app/core/theming';

@Component({
  selector: 'auth-layout',
  imports: [RouterOutlet, AppearanceMenu],
  template: `
    <header
      class="fixed top-6 right-4 z-50 flex items-center gap-1 text-sm font-medium text-secondary sm:top-8 sm:right-[5vw]"
    >
      <span>Appearance</span>
      <app-appearance-menu />
    </header>
    <router-outlet />
  `,
})
export default class AuthLayout {}
