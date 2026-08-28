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
        loadComponent: () => import('./features/home/home'),
      },
    ],
  },
];

export default routes;
