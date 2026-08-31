import { Routes } from '@angular/router';
import { AppLayout } from './layout/layout';

const routes: Routes = [
  {
    path: '',
    component: AppLayout,
    children: [
      {
        path: '',
        pathMatch: 'full',
        redirectTo: 'accounts',
      },
      {
        path: 'accounts',
        loadComponent: () =>
          import('./accounts/features/account-list/account-list'),
      },
      {
        path: 'accounts/:id',
        loadComponent: () =>
          import('./accounts/features/account-detail/account-detail'),
      },
      {
        path: 'budgets',
        loadComponent: () =>
          import('./budgets/features/budget-list/budget-list'),
      },
    ],
  },
];

export default routes;
