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
    ],
  },
];
