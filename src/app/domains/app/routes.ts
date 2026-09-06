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
        path: 'transactions',
        loadComponent: () =>
          import('./transactions/features/transactions-list/transactions-list'),
      },
      // PROTOTYPE — #95, throwaway. Delete with the `prototype/categories-list`
      // branch; never merge to main.
      {
        path: 'categories-prototype',
        loadComponent: () =>
          import('./categories/prototype/categories-prototype'),
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
