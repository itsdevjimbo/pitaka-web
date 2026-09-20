import { Component, computed, HostListener, inject, isDevMode, signal } from '@angular/core';
import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import FamilyReview from './family-review';
import AuthReview from './auth-review';

@Component({
  selector: 'screen-prototype',
  imports: [DecimalPipe, NgTemplateOutlet, RouterLink, FamilyReview, AuthReview],
  templateUrl: './screens.html',
})
export default class ScreenPrototype {
  readonly router = inject(Router);
  readonly route = inject(ActivatedRoute);
  readonly review = isDevMode();
  readonly variant = signal('A');
  readonly composition = signal('selected');
  readonly scheme = signal('system');
  readonly osDark = signal(matchMedia('(prefers-color-scheme: dark)').matches);
  readonly dark = computed(() => this.scheme() === 'dark' || (this.scheme() === 'system' && this.osDark()));
  readonly scenario = signal('everyday');
  readonly screen = signal('accounts');
  readonly search = signal('');
  readonly accountStatus = signal('Active');
  readonly direction = signal('All');
  readonly more = signal(false);
  readonly userMenu = signal(false);
  readonly filters = signal(false);
  readonly notice = signal('');
  readonly editor = signal('');
  readonly selectedAccount = signal('');
  readonly formDirection = signal('Expense');
  readonly loaded = signal(false);
  readonly names: Record<string, string> = { A: 'Card overview', B: 'Summary + workspace', C: 'Compact ledger' };
  readonly paths: Record<string, string> = {
    accounts: '/app/accounts',
    account: '/app/accounts/everyday',
    transactions: '/app/transactions',
    goal: '/app/goals/rainy-day',
    signin: '/auth/sign-in',
    budgets: '/app/budgets',
    goals: '/app/goals',
    schedules: '/app/schedules',
    categories: '/app/categories',
    tags: '/app/tags',
    profile: '/app/profile',
    signup: '/auth/sign-up',
    forgot: '/auth/forgot-password',
    reset: '/auth/reset-password',
    confirm: '/auth/confirm-email',
    emailchange: '/auth/confirm-email-change',
  };
  readonly titles: Record<string, string> = {
    budgets: 'Budgets',
    goals: 'Goals',
    schedules: 'Schedules',
    categories: 'Categories',
    tags: 'Tags',
    profile: 'Profile',
  };
  readonly descriptions: Record<string, string> = {
    budgets: 'Keep this Cycle’s spending in view.',
    goals: 'Make room for what matters.',
    schedules: 'See what will be generated next.',
    categories: 'How your income and expenses are filed.',
    tags: 'Find connections across Transactions.',
    profile: 'Your identity, email, and password.',
  };
  readonly isAuth = computed(() =>
    ['signin', 'signup', 'forgot', 'reset', 'confirm', 'emailchange'].includes(this.screen()),
  );
  readonly isFamily = computed(() => Object.hasOwn(this.titles, this.screen()));
  readonly selectedVariant = computed(() =>
    ['budgets', 'goals'].includes(this.screen()) ? 'C' : ['account', 'goal'].includes(this.screen()) ? 'B' : 'A',
  );
  readonly navigation = [
    { label: 'Accounts', screen: 'accounts', icon: '▣' },
    { label: 'Transactions', screen: 'transactions', icon: '⇄' },
    { label: 'Budgets', screen: 'budgets', icon: '◷' },
    { label: 'Goals', screen: 'goals', icon: '◎' },
    { label: 'Schedules', screen: 'schedules', icon: '▦' },
    { label: 'Categories', screen: 'categories', icon: '⊞' },
    { label: 'Tags', screen: 'tags', icon: '◇' },
  ];
  readonly accounts = computed(() => {
    if (this.scenario() === 'empty') return [];
    if (this.scenario() === 'retired')
      return [{ name: 'Old payroll account', kind: 'Bank account', balance: 4200, retired: true }];
    const base = [
      { name: 'Everyday Bank', kind: 'Bank account', balance: 48200.5, retired: false },
      { name: 'Cash', kind: 'Cash', balance: 2850, retired: false },
      { name: 'Travel fund', kind: 'Wallet', balance: 15400, retired: false },
      { name: 'Investments', kind: 'Investment', balance: 85000, retired: false },
    ];
    if (this.scenario() === 'stress')
      return [
        {
          name: 'Family emergency savings and long-term household expenses',
          kind: 'Bank account',
          balance: 123456789.12,
          retired: false,
        },
        { name: 'Everyday Bank', kind: 'Bank account', balance: -18450.75, retired: false },
        ...base.slice(1),
        ...Array.from({ length: 7 }, (_, i) => ({
          name: `Savings account ${i + 1}`,
          kind: 'Bank account',
          balance: 1000 * (i + 1),
          retired: false,
        })),
      ];
    return base;
  });
  readonly visibleAccounts = computed(() =>
    this.accounts().filter((a) => this.accountStatus() === 'All' || a.retired === (this.accountStatus() === 'Retired')),
  );
  readonly total = computed(() => this.visibleAccounts().reduce((sum, a) => sum + a.balance, 0));
  readonly accountName = computed(() =>
    this.scenario() === 'stress'
      ? 'Family emergency savings and long-term household expenses'
      : this.scenario() === 'retired'
        ? 'Old payroll account'
        : 'Everyday Bank',
  );
  readonly accountBalance = computed(() =>
    this.scenario() === 'stress'
      ? 123456789.12
      : this.scenario() === 'empty'
        ? 0
        : this.scenario() === 'retired'
          ? 4200
          : 48200.5,
  );
  readonly canRecord = computed(
    () =>
      ['accounts', 'transactions', 'account'].includes(this.screen()) &&
      !(this.screen() === 'account' && this.scenario() === 'retired'),
  );
  readonly allRows = [
    {
      name: 'Monthly salary',
      category: 'Salary',
      account: 'Everyday Bank',
      date: '20 Sep 2026',
      amount: 48000,
      direction: 'Income',
      note: 'September salary',
      tags: 'Work',
    },
    {
      name: 'Groceries for the week',
      category: 'Food',
      account: 'Everyday Bank',
      date: '20 Sep 2026',
      amount: 2840.75,
      direction: 'Expense',
      note: 'Market and household supplies',
      tags: 'Essentials',
    },
    {
      name: 'Everyday Bank → Cash',
      category: '',
      account: 'Everyday Bank',
      date: '19 Sep 2026',
      amount: 2000,
      direction: 'Transfer',
      note: 'Cash for the weekend',
      tags: '',
    },
    {
      name: 'Travel fund → Everyday Bank',
      category: '',
      account: 'Travel fund',
      date: '19 Sep 2026',
      amount: 3500,
      direction: 'Transfer',
      note: 'Unused travel money',
      tags: '',
    },
    {
      name: 'Electricity and water',
      category: 'Utilities',
      account: 'Everyday Bank',
      date: '18 Sep 2026',
      amount: 1625.5,
      direction: 'Expense',
      note: 'September bills',
      tags: 'Home',
    },
    {
      name: 'Project payment',
      category: 'Freelance',
      account: 'Everyday Bank',
      date: '17 Sep 2026',
      amount: 12500,
      direction: 'Income',
      note: 'Design project',
      tags: 'Work',
    },
  ];
  readonly rows = computed(() => {
    if (this.scenario() === 'empty') return [];
    const base =
      this.scenario() === 'stress' || this.loaded()
        ? [...this.allRows, ...this.allRows, ...this.allRows]
        : this.allRows;
    return base.filter(
      (r) =>
        (this.direction() === 'All' || r.direction === this.direction()) &&
        `${r.name} ${r.note} ${r.account} ${r.tags}`.toLowerCase().includes(this.search().toLowerCase()),
    );
  });
  constructor() {
    this.route.queryParamMap.subscribe((q) => {
      this.scheme.set(q.get('scheme') || 'system');
      this.scenario.set(q.get('case') || 'everyday');
      this.accountStatus.set(q.get('status') || (q.get('case') === 'retired' ? 'Retired' : 'Active'));
      this.search.set(q.get('search') || '');
      this.direction.set(q.get('direction') || 'All');
      const path = this.router.url.split('?')[0];
      this.screen.set(Object.entries(this.paths).find(([, value]) => value === path)?.[0] || 'accounts');
      this.composition.set(q.get('variant') || 'selected');
      this.variant.set(['A', 'B', 'C'].includes(this.composition()) ? this.composition() : this.selectedVariant());
    });
    const media = matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', (e) => this.osDark.set(e.matches));
  }
  set(key: string, value: string) {
    this.router.navigate([], {
      queryParams: { [key]: value, ...(key === 'case' ? { status: null } : {}) },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
  go(screen: string) {
    this.more.set(false);
    this.userMenu.set(false);
    this.notice.set('');
    if (!this.paths[screen]) {
      this.notice.set(
        `${screen[0].toUpperCase() + screen.slice(1)} is in the next review stage. This study covers the first five representative screens.`,
      );
      return;
    }
    this.router.navigate([this.paths[screen]], {
      queryParams: { variant: this.composition(), scheme: this.scheme(), case: this.scenario() },
    });
  }
  cycle(offset: number) {
    this.set('variant', ['A', 'B', 'C'][(['A', 'B', 'C'].indexOf(this.variant()) + offset + 3) % 3]);
  }
  @HostListener('window:keydown', ['$event']) keyboard(e: KeyboardEvent) {
    if ((e.target as HTMLElement).closest('input,textarea,select,[contenteditable],dialog') || this.editor()) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      this.cycle(e.key === 'ArrowLeft' ? -1 : 1);
    }
    if (e.key === 'Escape') {
      this.more.set(false);
      this.userMenu.set(false);
    }
  }
  sign(row: (typeof this.allRows)[number]) {
    if (row.direction === 'Income') return '+';
    if (row.direction === 'Expense') return '−';
    return this.screen() === 'account' ? (row.account === 'Everyday Bank' ? '−' : '+') : '';
  }
  rowTitle(row: (typeof this.allRows)[number]) {
    return this.screen() === 'account' ? row.name.replace('Everyday Bank', this.accountName()) : row.name;
  }
  phonePreview() {
    const url = new URL(location.href);
    url.searchParams.set('width', 'phone');
    location.assign(url.href);
  }
  money(value: number) {
    return `${value < 0 ? '−' : ''}₱${Math.abs(value).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  open(title: string, dialog: HTMLDialogElement) {
    this.editor.set(title);
    dialog.showModal();
  }
  record(dialog: HTMLDialogElement) {
    this.selectedAccount.set(this.screen() === 'account' ? this.accountName() : '');
    this.open(
      this.scenario() === 'empty' || this.scenario() === 'retired'
        ? 'New account'
        : this.screen() === 'account'
          ? 'Record transaction'
          : 'Choose an Account',
      dialog,
    );
  }
  close(dialog: HTMLDialogElement) {
    dialog.close();
    this.editor.set('');
  }
  save(event: Event, dialog: HTMLDialogElement) {
    event.preventDefault();
    this.close(dialog);
    this.notice.set('Layout preview complete. Sample data has not changed.');
  }
}
