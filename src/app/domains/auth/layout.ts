import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AppearanceMenu } from '@/app/core/theming';

@Component({
  selector: 'auth-layout',
  imports: [RouterOutlet, AppearanceMenu],
  template: `
    <header class="fixed top-6 right-4 z-50 sm:top-8 sm:right-[5vw]">
      <app-appearance-menu />
    </header>
    <router-outlet />
  `,
})
export default class AuthLayout {}
