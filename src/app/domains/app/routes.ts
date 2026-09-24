import { Routes } from '@angular/router';
import { AppLayout } from './layout/layout';
import { profileCanDeactivateGuard } from './profile/features/profile/profile.guard';

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
        loadComponent: () => import('./accounts/features/account-list/account-list'),
      },
      {
        path: 'accounts/:id',
        loadComponent: () => import('./accounts/features/account-detail/account-detail'),
      },
      {
        path: 'transactions',
        loadComponent: () => import('./transactions/features/transactions-list/transactions-list'),
      },
      {
        path: 'budgets',
        loadComponent: () => import('./budgets/features/budget-list/budget-list'),
      },
      {
        path: 'goals',
        loadComponent: () => import('./goals/features/goal-list/goal-list'),
      },
      {
        path: 'goals/:id',
        loadComponent: () => import('./goals/features/goal-detail/goal-detail'),
      },
      {
        path: 'categories',
        loadComponent: () => import('./categories/features/categories-list/categories-list'),
      },
      {
        path: 'tags',
        loadComponent: () => import('./tags/features/tags-list/tags-list'),
      },
      {
        path: 'schedules',
        loadComponent: () => import('./schedules/features/schedule-list/schedule-list'),
      },
      {
        path: 'profile',
        canDeactivate: [profileCanDeactivateGuard],
        loadComponent: () => import('./profile/features/profile/profile'),
      },
    ],
  },
];

export default routes;
