import { Route } from '@angular/router';

export const routes: Route[] = [
  // Auth
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
    loadChildren: () => import('./domains/app/routes'),
  },

  // Fallback
  {
    path: '**',
    redirectTo: '',
  },
];
