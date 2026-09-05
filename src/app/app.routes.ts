import { Route } from '@angular/router';
import { authGuard } from '@/app/core/session';

export const routes: Route[] = [
  // Auth. `guestGuard` sits on the individual child routes, not here — the
  // two link-landing screens (confirm-email, and reset once #71 lands) must
  // not assume the absence of a session (ADR 0015).
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

  // Fallback
  {
    path: '**',
    redirectTo: '',
  },
];
