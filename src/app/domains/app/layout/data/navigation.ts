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
    label: 'Day to day',
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
    ],
  },

  {
    id: 'plan',
    label: 'Plan ahead',
    children: [
      {
        id: 'budgets',
        label: 'Budgets',
        route: '/app/budgets',
        icon: 'gauge',
        activeOptions: { exact: false },
      },
      {
        id: 'goals',
        label: 'Goals',
        route: '/app/goals',
        icon: 'target',
        activeOptions: { exact: false },
      },
      {
        id: 'schedules',
        label: 'Schedules',
        route: '/app/schedules',
        icon: 'calendar-clock',
        activeOptions: { exact: false },
      },
    ],
  },

  // Reference data and standing instructions — visited deliberately, not part
  // of "where does my money stand" (#107, #206).
  {
    id: 'organize',
    label: 'Organize',
    children: [
      {
        id: 'categories',
        label: 'Categories',
        route: '/app/categories',
        icon: 'shapes',
        activeOptions: { exact: false },
      },
      {
        id: 'tags',
        label: 'Tags',
        route: '/app/tags',
        icon: 'tag',
        activeOptions: { exact: false },
      },
    ],
  },
];
