import { Route } from '@angular/router';
import { authGuard } from '@/app/core/session';

export const routes: Route[] = [
  // Auth. `guestGuard` sits on the individual child routes, not here — the
  // two link-landing screens, confirm-email and reset-password, must not
  // assume the absence of a session (ADR 0015).
  {
    path: 'auth',
    loadChildren: () => import('./domains/auth/routes'),
  },

  // App
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'app',
  },
  {
    path: 'app',
    canActivate: [authGuard],
    loadChildren: () => import('./domains/app/routes'),
  },

  // PROTOTYPE — throwaway route for wayfinder #117, deliberately outside
  // `authGuard` so the variants can be judged without a session. Dies with the
  // `prototype/tag-entry-control` branch.
  {
    path: 'tag-entry-prototype',
    loadComponent: () =>
      import('./domains/app/transactions/prototype/tag-entry-prototype'),
  },

  // Fallback
  {
    path: '**',
    redirectTo: '',
  },
];
