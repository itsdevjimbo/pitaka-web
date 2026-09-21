import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AppearanceMenu } from '@/app/core/theming';

@Component({
  selector: 'auth-layout',
  imports: [RouterOutlet, AppearanceMenu],
  template: `
    <header class="fixed top-3 right-3 z-50">
      <app-appearance-menu />
    </header>
    <router-outlet />
  `,
})
export default class AuthLayout {}
