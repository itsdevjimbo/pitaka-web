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
        loadComponent: () => import('./accounts/accounts'),
      },
      {
        path: 'accounts/:id',
        loadComponent: () => import('./accounts/account-detail'),
      },
    ],
  },
];

export default routes;
