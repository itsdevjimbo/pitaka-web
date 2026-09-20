import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS, provideNativeDateAdapter } from '@angular/material/core';
import { provideRouter } from '@angular/router';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { provideDialogDefaults } from '@/app/core/dialog';
import { provideIcons } from '@/app/core/icons';
import { Account, AccountsService } from '@/app/domains/app/accounts';
import { CategoriesService, Category } from '@/app/domains/app/categories';
import { pressEscape, withOverlayContainer } from '@/testing/overlay';
import { NewSchedule, Schedule } from '../../data/schedule';
import { SchedulesService } from '../../data/schedules.service';
import ScheduleList from './schedule-list';

const ACCOUNTS: Account[] = [
  { id: 1, name: 'BPI Savings', type: 'Bank', currentBalance: 0, isActive: true },
  { id: 2, name: 'Old GCash', type: 'Wallet', currentBalance: 0, isActive: false },
];
const CATEGORIES: Category[] = [
  { id: 10, name: 'Salary', kind: 'income', isActive: true, isDefault: false },
  { id: 11, name: 'Housing', kind: 'expense', isActive: false, isDefault: false },
  { id: 12, name: 'Groceries', kind: 'expense', isActive: true, isDefault: false },
];

function schedule(over: Partial<Schedule>): Schedule {
  return {
    id: 1,
    accountId: 1,
    categoryId: 10,
    name: 'Salary',
    direction: 'income',
    amount: 82000,
    description: null,
    frequency: 'monthly',
    firstGeneration: new Date(2026, 0, 15),
    lastGeneration: null,
    nextGeneration: new Date(2026, 9, 15),
    status: 'active',
    generatedTransactionCount: 14,
    canDelete: false,
    ...over,
  };
}

const ALL: Schedule[] = [
  schedule({ id: 1, name: 'Later salary', nextGeneration: new Date(2026, 9, 15) }),
  schedule({ id: 2, name: 'Sooner salary', nextGeneration: new Date(2026, 8, 15) }),
  schedule({ id: 3, name: 'Gym', status: 'paused', direction: 'expense', amount: 2200 }),
  schedule({ id: 4, name: 'Retainer', status: 'completed', generatedTransactionCount: 12 }),
  schedule({ id: 5, name: 'Old plan', status: 'cancelled', generatedTransactionCount: 4 }),
];

describe('ScheduleList', () => {
  const overlay = withOverlayContainer();

  function setup(
    list: SchedulesService['list'],
    overrides: {
      create?: SchedulesService['create'];
      accounts?: Account[];
      categories?: Category[];
      refreshCategories?: CategoriesService['refreshList'];
    } = {},
  ) {
    const accounts = overrides.accounts ?? ACCOUNTS;
    const categories = overrides.categories ?? CATEGORIES;
    TestBed.configureTestingModule({
      imports: [ScheduleList],
      providers: [
        provideRouter([]),
        provideIcons(),
        provideDialogDefaults(),
        provideNativeDateAdapter(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        {
          provide: SchedulesService,
          useValue: {
            list,
            create: overrides.create ?? (() => of(ALL[0])),
          },
        },
        { provide: AccountsService, useValue: { all: () => of(accounts) } },
        {
          provide: CategoriesService,
          useValue: {
            all: () => of(categories),
            list: () => of(categories.filter((category) => category.isActive)),
            refreshList: overrides.refreshCategories ?? (() => of(categories.filter((category) => category.isActive))),
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(ScheduleList);
    fixture.detectChanges();
    return {
      fixture,
      text: () => (fixture.nativeElement as HTMLElement).textContent ?? '',
      dialog: () => overlay().querySelector<HTMLElement>('[role="dialog"]'),
      dialogText: () => overlay().textContent ?? '',
    };
  }

  async function settle(fixture: ComponentFixture<ScheduleList>) {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function click(fixture: ComponentFixture<ScheduleList>, label: string) {
    const button = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')).find((candidate) =>
      (candidate.textContent ?? '').includes(label),
    );
    if (!button) throw new Error(`No button labelled "${label}"`);
    button.click();
    fixture.detectChanges();
  }

  function overlayButton(label: string): HTMLButtonElement {
    const button = Array.from(overlay().querySelectorAll('button')).find((candidate) =>
      (candidate.textContent ?? '').includes(label),
    );
    if (!button) throw new Error(`No overlay button labelled "${label}"`);
    return button;
  }

  function typeInto(selector: string, value: string) {
    const input = overlay().querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
    if (!input) throw new Error(`No overlay input matching "${selector}"`);
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  async function pickOption(fixture: ComponentFixture<ScheduleList>, selector: string, optionText: string) {
    overlay().querySelector<HTMLElement>(selector)!.click();
    await settle(fixture);
    const option = Array.from(overlay().querySelectorAll<HTMLElement>('mat-option')).find(
      (candidate) => (candidate.textContent ?? '').trim() === optionText,
    );
    if (!option) throw new Error(`No option "${optionText}"`);
    option.click();
    await settle(fixture);
  }

  it('renders skeleton cards while the initial collections are loading', () => {
    const pending = new Subject<Schedule[]>();
    const { fixture, text } = setup(() => pending);

    expect(text()).toContain('Loading Schedules');
    expect(fixture.nativeElement.querySelectorAll('[data-schedule-skeleton]').length).toBe(3);
  });

  it('shows Active Schedules by next generation with their card facts', () => {
    const { text } = setup(() => of(ALL));

    expect(text().indexOf('Sooner salary')).toBeLessThan(text().indexOf('Later salary'));
    expect(text()).toContain('Next generation: 15 Sep 2026');
    expect(text()).toContain('Income');
    expect(text()).toContain('₱82,000.00');
    expect(text()).toContain('Monthly');
    expect(text()).toContain('BPI Savings');
    expect(text()).toContain('Salary');
    expect(text()).toContain('14 surviving generated Transactions');
  });

  it('switches among Upcoming, Paused, and Past with truthful lifecycle timing', () => {
    const { fixture, text } = setup(() => of(ALL));

    click(fixture, 'Paused');
    expect(text()).toContain('Gym');
    expect(text()).toContain('Generation paused');
    expect(text()).not.toContain('Next generation:');

    click(fixture, 'Past');
    expect(text()).toContain('Retainer');
    expect(text()).toContain('Completed');
    expect(text()).toContain('Old plan');
    expect(text()).toContain('Cancelled');
    expect(text()).not.toContain('Next generation:');
  });

  it('shows each lifecycle count as a Material badge beside its menu label', () => {
    const { fixture } = setup(() => of(ALL));
    const buttons = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(
        'nav[aria-label="Schedule lifecycle"] button',
      ),
    );

    expect(buttons.map((button) => button.querySelector('.mat-badge-content')?.textContent?.trim())).toEqual([
      '2',
      '1',
      '2',
    ]);
  });

  it('warns about a retired Account and labels a retired Category', () => {
    const retired = schedule({ accountId: 2, categoryId: 11, direction: 'expense' });
    const { text } = setup(() => of([retired]));

    expect(text()).toContain('Old GCash');
    expect(text()).toContain('Housing');
    expect(text()).toContain('Retired');
    expect(text()).toContain('This Account is retired. Generation is blocked.');
    expect(text()).toContain('Reactivating the Account resumes generation and may create one overdue Transaction.');
    expect(text()).not.toContain('Next generation:');
  });

  it('shows the initial failure wording and retries', () => {
    const attempts = new BehaviorSubject(0);
    const list = vi.fn(() => {
      const attempt = attempts.value;
      attempts.next(attempt + 1);
      return attempt === 0 ? throwError(() => new ApiError('Offline', 0)) : of(ALL);
    });
    const { fixture, text } = setup(list);

    expect(text()).toContain('Schedules couldn’t be loaded');
    click(fixture, 'Retry');
    expect(text()).toContain('Sooner salary');
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('retains cards after a refresh failure and clears stale state after recovery', () => {
    const list = vi
      .fn()
      .mockReturnValueOnce(of(ALL))
      .mockReturnValueOnce(throwError(() => new ApiError('Offline', 0)))
      .mockReturnValueOnce(of([ALL[1]]));
    const { fixture, text } = setup(list as SchedulesService['list']);

    click(fixture, 'Refresh');
    expect(text()).toContain('Sooner salary');
    expect(text()).toContain('Schedules couldn’t be refreshed. Shown information may be out of date.');

    click(fixture, 'Retry');
    expect(text()).toContain('Sooner salary');
    expect(text()).not.toContain('may be out of date');
  });

  it.each([
    ['Paused', 'No paused Schedules'],
    ['Past', 'No past Schedules'],
  ])('shows the %s view empty state while retaining navigation', (view, message) => {
    const { fixture, text } = setup(() => of([ALL[0]]));

    click(fixture, view);
    expect(text()).toContain(message);
    expect(text()).toContain('Upcoming');
    expect(text()).toContain('Paused');
    expect(text()).toContain('Past');
  });

  it('shows the all-empty state with a Create Schedule action and no history control', () => {
    const { fixture, text } = setup(() => of([]));

    expect(text()).toContain('No Schedules yet');
    expect(fixture.nativeElement.querySelector('a')).toBeNull();
    expect(text()).toContain('Create Schedule');
  });

  describe('create, in a dialog', () => {
    async function openDialog(fixture: ComponentFixture<ScheduleList>) {
      click(fixture, 'Create Schedule');
      await settle(fixture);
    }

    async function fillValidSchedule(fixture: ComponentFixture<ScheduleList>) {
      typeInto('#schedule-name', 'Market allowance');
      typeInto('#schedule-amount', '6500');
      typeInto('#schedule-description', 'Household plan');
      await pickOption(fixture, '#schedule-direction', 'Expense');
      await pickOption(fixture, '#schedule-account', 'BPI Savings');
      await pickOption(fixture, '#schedule-category', 'Groceries');
      await pickOption(fixture, '#schedule-frequency', 'Monthly');
      typeInto('#schedule-first-generation', '2099-10-01');
      typeInto('#schedule-last-generation', '2099-12-01');
      await settle(fixture);
    }

    it('opens the shared form from the heading', async () => {
      const listed = setup(() => of(ALL));
      await openDialog(listed.fixture);

      expect(listed.dialog()).not.toBeNull();
      expect(listed.dialogText()).toContain('Create Schedule');
      expect(listed.dialogText()).toContain('Name');
      expect(listed.dialogText()).toContain('Amount');
      expect(listed.dialogText()).toContain('Account');
      expect(listed.dialogText()).toContain('Category');
      expect(listed.dialogText()).toContain('Description');
      expect(listed.dialogText()).toContain('Direction');
      expect(listed.dialogText()).toContain('Frequency');
      expect(listed.dialogText()).not.toContain('Cadence');
      expect(listed.dialogText()).toContain('First generation');
      expect(listed.dialogText()).toContain('Last generation');
    });

    it('opens the same shared form from the first-use empty state', async () => {
      const empty = setup(() => of([]));
      await openDialog(empty.fixture);
      expect(empty.dialog()).not.toBeNull();
      expect(empty.dialogText()).toContain('Create Schedule');
    });

    it('keeps a backdrop click inert and closes on Escape', async () => {
      const { fixture, dialog } = setup(() => of(ALL));
      const opener = Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button'),
      ).find((button) => (button.textContent ?? '').includes('Create Schedule'))!;
      opener.focus();
      opener.click();
      await settle(fixture);

      expect(overlay().contains(document.activeElement)).toBe(true);

      overlay().querySelector<HTMLElement>('.cdk-overlay-backdrop')!.click();
      await settle(fixture);
      expect(dialog()).not.toBeNull();

      pressEscape();
      await settle(fixture);
      expect(dialog()).toBeNull();
      expect(document.activeElement).toBe(opener);
    });

    it('keeps the complete form in the shared responsive dialog at phone width', async () => {
      const originalWidth = window.innerWidth;
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 360 });
      try {
        const { fixture, dialog } = setup(() => of(ALL));
        await openDialog(fixture);

        expect(dialog()).not.toBeNull();
        expect(overlay().querySelector('.app-dialog-panel')).not.toBeNull();
        for (const selector of [
          '#schedule-name',
          '#schedule-direction',
          '#schedule-amount',
          '#schedule-account',
          '#schedule-category',
          '#schedule-frequency',
          '#schedule-first-generation',
          '#schedule-last-generation',
          '#schedule-description',
        ]) {
          expect(overlay().querySelector(selector), selector).not.toBeNull();
        }
        expect(overlayButton('Cancel')).not.toBeNull();
        expect(overlayButton('Create Schedule')).not.toBeNull();
      } finally {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth });
      }
    });

    it('offers active Accounts and only active Categories matching the direction', async () => {
      const { fixture } = setup(() => of(ALL));
      await openDialog(fixture);

      overlay().querySelector<HTMLElement>('#schedule-account')!.click();
      await settle(fixture);
      expect(overlay().textContent).toContain('BPI Savings');
      expect(overlay().textContent).not.toContain('Old GCash');
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await settle(fixture);

      await pickOption(fixture, '#schedule-direction', 'Expense');
      overlay().querySelector<HTMLElement>('#schedule-category')!.click();
      await settle(fixture);
      expect(overlay().textContent).toContain('Groceries');
      expect(overlay().textContent).not.toContain('Housing');
      expect(overlay().textContent).not.toContain('Salary');
    });

    it('creates the Schedule, closes the dialog, and refreshes the list', async () => {
      const created = schedule({
        id: 22,
        name: 'Market allowance',
        direction: 'expense',
        amount: 6500,
        description: 'Household plan',
        categoryId: 12,
        firstGeneration: new Date(2099, 9, 1),
        lastGeneration: new Date(2099, 11, 1),
        nextGeneration: new Date(2099, 9, 1),
      });
      const list = vi
        .fn()
        .mockReturnValueOnce(of(ALL))
        .mockReturnValueOnce(of([...ALL, created]));
      const create = vi.fn((_value: NewSchedule) => of(created));
      const { fixture, dialog, text } = setup(list as SchedulesService['list'], {
        create: create as SchedulesService['create'],
      });

      await openDialog(fixture);
      await fillValidSchedule(fixture);
      overlayButton('Create Schedule').click();
      await settle(fixture);

      expect(create).toHaveBeenCalledWith({
        accountId: 1,
        categoryId: 12,
        name: 'Market allowance',
        direction: 'expense',
        amount: 6500,
        description: 'Household plan',
        frequency: 'monthly',
        firstGeneration: expect.any(Date),
        lastGeneration: expect.any(Date),
      });
      const submitted = create.mock.calls[0][0];
      expect([
        submitted.firstGeneration.getFullYear(),
        submitted.firstGeneration.getMonth(),
        submitted.firstGeneration.getDate(),
      ]).toEqual([2099, 9, 1]);
      expect([
        submitted.lastGeneration?.getFullYear(),
        submitted.lastGeneration?.getMonth(),
        submitted.lastGeneration?.getDate(),
      ]).toEqual([2099, 11, 1]);
      expect(dialog()).toBeNull();
      expect(list).toHaveBeenCalledTimes(2);
      expect(text()).toContain('Market allowance');
    });

    it('keeps entered values and attributes duplicate-name failures', async () => {
      const create = vi.fn(() =>
        throwError(
          () =>
            new ApiError('A Schedule with this name already exists.', 409, {
              name: ['A Schedule with this name already exists.'],
            }),
        ),
      );
      const { fixture, dialog, dialogText } = setup(() => of(ALL), {
        create: create as SchedulesService['create'],
      });

      await openDialog(fixture);
      await fillValidSchedule(fixture);
      overlayButton('Create Schedule').click();
      await settle(fixture);

      expect(dialog()).not.toBeNull();
      expect(dialogText()).toContain('A Schedule with this name already exists.');
      expect(overlay().querySelector<HTMLInputElement>('#schedule-name')!.value).toBe('Market allowance');
      expect(overlay().querySelector<HTMLTextAreaElement>('#schedule-description')!.value).toBe('Household plan');
    });

    it('shows retired-Category server rejection beside Category and preserves the form', async () => {
      const refreshCategories = vi.fn(() =>
        of([
          ...CATEGORIES.filter((category) => category.id !== 12 && category.isActive),
          { id: 13, name: 'Utilities', kind: 'expense' as const, isActive: true, isDefault: false },
        ]),
      );
      const create = vi.fn(() =>
        throwError(() => new ApiError('Validation failed.', 400, { categoryId: ['Choose an active Category.'] })),
      );
      const { fixture, dialog, dialogText } = setup(() => of(ALL), {
        create: create as SchedulesService['create'],
        refreshCategories,
      });

      await openDialog(fixture);
      await fillValidSchedule(fixture);
      overlayButton('Create Schedule').click();
      await settle(fixture);

      expect(dialog()).not.toBeNull();
      expect(dialogText()).toContain('Choose an active Category.');
      expect(overlay().querySelector<HTMLInputElement>('#schedule-name')!.value).toBe('Market allowance');
      expect(refreshCategories).toHaveBeenCalledOnce();
      expect(overlayButton('Create Schedule').disabled).toBe(true);

      overlay().querySelector<HTMLElement>('#schedule-category')!.click();
      await settle(fixture);
      expect(overlay().textContent).not.toContain('Groceries');
      expect(overlay().textContent).toContain('Utilities');
      const utilities = Array.from(overlay().querySelectorAll<HTMLElement>('mat-option')).find(
        (option) => (option.textContent ?? '').trim() === 'Utilities',
      )!;
      utilities.click();
      await settle(fixture);
      expect(overlayButton('Create Schedule').disabled).toBe(false);
    });

    it('refreshes and explains an unattributed state conflict before another submission', async () => {
      const list = vi.fn().mockReturnValue(of(ALL));
      const refreshCategories = vi.fn(() => of(CATEGORIES.filter((category) => category.isActive)));
      const create = vi.fn(() => throwError(() => new ApiError('The filing destination changed.', 409)));
      const { fixture, dialog, dialogText } = setup(list as SchedulesService['list'], {
        create: create as SchedulesService['create'],
        refreshCategories,
      });

      await openDialog(fixture);
      await fillValidSchedule(fixture);
      overlayButton('Create Schedule').click();
      await settle(fixture);

      expect(dialog()).not.toBeNull();
      expect(dialogText()).toContain('Review the refreshed values and try again.');
      expect(list).toHaveBeenCalledTimes(2);
      expect(refreshCategories).toHaveBeenCalledOnce();
      expect(overlay().querySelector<HTMLInputElement>('#schedule-name')!.value).toBe('Market allowance');
    });

    it('explains each date minimum without a permanent UTC hint', async () => {
      const { fixture, dialogText } = setup(() => of(ALL));
      await openDialog(fixture);

      typeInto('#schedule-first-generation', '2000-01-01');
      overlay().querySelector<HTMLInputElement>('#schedule-first-generation')!.dispatchEvent(new Event('blur'));
      await settle(fixture);
      expect(dialogText()).toMatch(/Choose \d{1,2} \w{3} \d{4} or later/);
      expect(dialogText()).not.toContain('UTC');

      typeInto('#schedule-first-generation', '2099-10-01');
      typeInto('#schedule-last-generation', '2099-10-01');
      overlay().querySelector<HTMLInputElement>('#schedule-last-generation')!.dispatchEvent(new Event('blur'));
      await settle(fixture);
      expect(dialogText()).toContain('Choose 2 Oct 2099 or later');
    });

    it('uses the UTC calendar minimum when UTC and local dates differ', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-09-19T18:30:00.000Z'));
      try {
        const { fixture, dialogText } = setup(() => of(ALL));
        await openDialog(fixture);

        typeInto('#schedule-first-generation', '2026-09-19');
        overlay().querySelector<HTMLInputElement>('#schedule-first-generation')!.dispatchEvent(new Event('blur'));
        await settle(fixture);

        expect(dialogText()).toContain('Choose 20 Sep 2026 or later');
      } finally {
        vi.useRealTimers();
      }
    });

    it('shows a pending state and prevents another submission', async () => {
      const pending = new Subject<Schedule>();
      const create = vi.fn((_value: NewSchedule) => pending.asObservable());
      const { fixture, dialogText } = setup(() => of(ALL), {
        create: create as SchedulesService['create'],
      });

      await openDialog(fixture);
      await fillValidSchedule(fixture);
      const submit = overlayButton('Create Schedule');
      submit.click();
      fixture.detectChanges();

      expect(dialogText()).toContain('Creating…');
      expect(submit.disabled).toBe(true);
      submit.click();
      expect(create).toHaveBeenCalledTimes(1);

      pending.next(ALL[0]);
      pending.complete();
      await settle(fixture);
    });

    it('disables create actions while the list is stale', async () => {
      const list = vi
        .fn()
        .mockReturnValueOnce(of(ALL))
        .mockReturnValueOnce(throwError(() => new ApiError('Offline', 0)));
      const { fixture } = setup(list as SchedulesService['list']);

      click(fixture, 'Refresh');
      const createButton = Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button'),
      ).find((button) => (button.textContent ?? '').includes('Create Schedule'))!;

      expect(createButton.disabled).toBe(true);
    });

    it('shows the stale warning and disables both Create actions when an empty list refresh fails', () => {
      const list = vi
        .fn()
        .mockReturnValueOnce(of([]))
        .mockReturnValueOnce(throwError(() => new ApiError('Offline', 0)));
      const { fixture, text } = setup(list as SchedulesService['list']);

      click(fixture, 'Refresh');

      expect(text()).toContain('Schedules couldn’t be refreshed. Shown information may be out of date.');
      const createButtons = Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button'),
      ).filter((button) => (button.textContent ?? '').includes('Create Schedule'));
      expect(createButtons).toHaveLength(2);
      expect(createButtons.every((button) => button.disabled)).toBe(true);
    });
  });
});
