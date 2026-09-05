import { Routes } from '@angular/router';

const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./layout'),
    children: [
      {
        path: '',
        pathMatch: 'full',
        redirectTo: 'sign-in',
      },
      {
        path: 'sign-in',
        loadComponent: () => import('./features/sign-in/sign-in'),
      },
      {
        path: 'sign-up',
        loadComponent: () => import('./features/sign-up/sign-up'),
      },
      {
        // Asking for a reset link is a guest action — a live session makes it
        // meaningless — so it sits inside `guestGuard` with sign-in and sign-up,
        // unlike the two link-landing screens (ADR 0015).
        path: 'forgot-password',
        loadComponent: () =>
          import('./features/forgot-password/forgot-password'),
      },
    ],
  },
];

export default routes;
