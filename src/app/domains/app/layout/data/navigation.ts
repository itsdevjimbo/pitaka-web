import { IsActiveMatchOptions } from '@angular/router';

export type NavigationItem = {
  id: string;
  label: string;
  description?: string;
  route?: string;
  icon?: string;
  badge?: string;
  children?: NavigationItem[];
  disabled?: boolean;
  expanded?: boolean;
  activeOptions?: { exact: boolean } | IsActiveMatchOptions;
};

export const NAVIGATION: NavigationItem[] = [
  {
    id: 'main',
    label: 'Main',
    children: [
      {
        id: 'accounts',
        label: 'Accounts',
        route: '/app/accounts',
        icon: 'wallet-cards',
        activeOptions: { exact: false },
      },
      {
        id: 'transactions',
        label: 'Transactions',
        route: '/app/transactions',
        icon: 'receipt-text',
        activeOptions: { exact: false },
      },
      {
        id: 'budgets',
        label: 'Budgets',
        route: '/app/budgets',
        icon: 'gauge',
        activeOptions: { exact: false },
      },
    ],
  },

  // Reference data — visited rarely and deliberately, not part of "where does my
  // money stand". Tags, Schedules and Goals land in this group later (#107).
  {
    id: 'manage',
    label: 'Manage',
    children: [
      {
        id: 'categories',
        label: 'Categories',
        route: '/app/categories',
        icon: 'shapes',
        activeOptions: { exact: false },
      },
    ],
  },
];
