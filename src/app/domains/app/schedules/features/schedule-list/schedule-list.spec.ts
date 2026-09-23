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
import { withPinnedTimezone } from '@/testing/timezone';
import { NewSchedule, Schedule, ScheduleUpdate } from '../../data/schedule';
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
      update?: SchedulesService['update'];
      setStatus?: SchedulesService['setStatus'];
      extend?: SchedulesService['extend'];
      delete?: SchedulesService['delete'];
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
            update: overrides.update ?? (() => of(ALL[0])),
            setStatus: overrides.setStatus ?? (() => of(ALL[0])),
            extend: overrides.extend ?? (() => of(ALL[0])),
            delete: overrides.delete ?? (() => of(undefined)),
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
    if (!button) {
      throw new Error(`No button labelled "${label}"`);
    }
    button.click();
    fixture.detectChanges();
  }

  function clickExact(fixture: ComponentFixture<ScheduleList>, label: string) {
    const button = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')).find(
      (candidate) => (candidate.textContent ?? '').trim() === label,
    );
    if (!button) {
      throw new Error(`No button labelled exactly "${label}"`);
    }
    button.click();
    fixture.detectChanges();
  }

  function overlayButton(label: string): HTMLButtonElement {
    const button = Array.from(overlay().querySelectorAll('button')).find((candidate) =>
      (candidate.textContent ?? '').includes(label),
    );
    if (!button) {
      throw new Error(`No overlay button labelled "${label}"`);
    }
    return button;
  }

  function typeInto(selector: string, value: string) {
    const input = overlay().querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
    if (!input) {
      throw new Error(`No overlay input matching "${selector}"`);
    }
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  async function pickOption(fixture: ComponentFixture<ScheduleList>, selector: string, optionText: string) {
    overlay().querySelector<HTMLElement>(selector)!.click();
    await settle(fixture);
    const option = Array.from(overlay().querySelectorAll<HTMLElement>('mat-option')).find(
      (candidate) => (candidate.textContent ?? '').trim() === optionText,
    );
    if (!option) {
      throw new Error(`No option "${optionText}"`);
    }
    option.click();
    await settle(fixture);
  }

  it('renders skeleton cards while the initial collections are loading', () => {
    const pending = new Subject<Schedule[]>();
    const { fixture, text } = setup(() => pending);

    expect(text()).toContain('Loading Schedules');
    expect(fixture.nativeElement.querySelector('[role="status"]')).not.toBeNull();
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

  it('offers Edit on Active and Paused cards but not Completed or Cancelled cards', () => {
    const { fixture } = setup(() => of(ALL));
    const rowFor = (name: string) =>
      Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('li[schedules-schedule-row]'),
      ).find((row) => (row.textContent ?? '').includes(name))!;

    expect(rowFor('Sooner salary').textContent).toContain('Edit');
    click(fixture, 'Paused');
    expect(rowFor('Gym').textContent).toContain('Edit');
    click(fixture, 'Past');
    expect(rowFor('Retainer').textContent).not.toContain('Edit');
    expect(rowFor('Old plan').textContent).not.toContain('Edit');
  });

  it('places card actions after the Schedule details', () => {
    const { fixture } = setup(() => of(ALL));
    const card = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('li[schedules-schedule-row]')!;
    const details = card.querySelector('[aria-label^="View generated Transactions"]')!;
    const pause = Array.from(card.querySelectorAll('button')).find(
      (button) => (button.textContent ?? '').trim() === 'Pause',
    )!;

    expect(details.compareDocumentPosition(pause)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  describe('pause and resume', () => {
    it('offers Pause for Active and Resume for Paused and Cancelled Schedules', () => {
      const { fixture } = setup(() => of(ALL));
      const rowFor = (name: string) =>
        Array.from(
          (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('li[schedules-schedule-row]'),
        ).find((row) => (row.textContent ?? '').includes(name))!;

      expect(rowFor('Sooner salary').textContent).toContain('Pause');
      click(fixture, 'Paused');
      expect(rowFor('Gym').textContent).toContain('Resume');
      click(fixture, 'Past');
      expect(rowFor('Old plan').textContent).toContain('Resume');
      expect(rowFor('Retainer').textContent).not.toContain('Resume');
    });

    it('uses the approved confirmation text and cancellation sends no write', async () => {
      const setStatus = vi.fn(() => of(ALL[0]));
      const { fixture, dialogText } = setup(() => of(ALL), {
        setStatus: setStatus as SchedulesService['setStatus'],
      });

      clickExact(fixture, 'Pause');
      await settle(fixture);
      expect(dialog()).not.toBeNull();
      expect(dialogText()).toContain('Pause ‘Sooner salary’?');
      expect(dialogText()).toContain('No Transactions will be generated while paused. You can resume later.');
      expect(document.activeElement?.textContent?.trim()).toBe('Cancel');
      overlayButton('Cancel').click();
      await settle(fixture);
      expect(dialog()).toBeNull();
      expect(setStatus).not.toHaveBeenCalled();
    });

    it('uses the shared responsive dialog and closes on Escape at phone width', async () => {
      const originalWidth = window.innerWidth;
      const setStatus = vi.fn(() => of(ALL[0]));
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 360 });
      try {
        const { fixture, dialog } = setup(() => of(ALL), {
          setStatus: setStatus as SchedulesService['setStatus'],
        });

        clickExact(fixture, 'Pause');
        await settle(fixture);
        expect(dialog()).not.toBeNull();
        expect(overlay().querySelector('.app-dialog-panel')).not.toBeNull();

        pressEscape();
        await settle(fixture);
        expect(dialog()).toBeNull();
        expect(setStatus).not.toHaveBeenCalled();
      } finally {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth });
      }
    });

    it('moves an Active Schedule to Paused after a successful pause', async () => {
      const paused = schedule({ ...ALL[1], status: 'paused' });
      const list = vi
        .fn()
        .mockReturnValueOnce(of(ALL))
        .mockReturnValueOnce(of([paused]));
      const setStatus = vi.fn(() => of(paused));
      const { fixture, text } = setup(list as SchedulesService['list'], {
        setStatus: setStatus as SchedulesService['setStatus'],
      });

      clickExact(fixture, 'Pause');
      await settle(fixture);
      overlayButton('Pause').click();
      await settle(fixture);

      expect(setStatus).toHaveBeenCalledWith(2, 'paused');
      expect(text()).toContain('Sooner salary');
      expect(text()).toContain('Generation paused');
      expect(list).toHaveBeenCalledTimes(2);
    });

    it('keeps confirmation controls pending, then moves a paused Schedule to Upcoming after success', async () => {
      const write = new Subject<Schedule>();
      const resumed = schedule({ ...ALL[2], status: 'active', nextGeneration: new Date(2026, 10, 15) });
      const list = vi
        .fn()
        .mockReturnValueOnce(of(ALL))
        .mockReturnValueOnce(of([ALL[0], ALL[1], resumed, ALL[3], ALL[4]]));
      const setStatus = vi.fn(() => write);
      const { fixture, dialog, dialogText, text } = setup(list as SchedulesService['list'], {
        setStatus: setStatus as SchedulesService['setStatus'],
      });

      click(fixture, 'Paused');
      click(fixture, 'Resume');
      await settle(fixture);
      expect(dialogText()).toContain('Resume ‘Gym’?');
      expect(dialogText()).toContain(
        'Generation resumes on the original cadence. Missed occurrences won’t be generated.',
      );
      overlayButton('Resume').click();
      await settle(fixture);
      expect(setStatus).toHaveBeenCalledWith(3, 'active');
      expect(overlayButton('Resuming…').disabled).toBe(true);
      expect(overlayButton('Cancel').disabled).toBe(true);
      pressEscape();
      await settle(fixture);
      expect(dialog()).toBeNull();

      write.next(resumed);
      write.complete();
      await settle(fixture);
      expect(text()).toContain('Gym');
      expect(text()).toContain('Next generation: 15 Nov 2026');
      expect(list).toHaveBeenCalledTimes(2);
    });

    it('keeps a dismissed write pending and makes a later failure actionable on the card', async () => {
      const write = new Subject<Schedule>();
      const setStatus = vi.fn(() => write);
      const { fixture, dialog, text } = setup(() => of(ALL), {
        setStatus: setStatus as SchedulesService['setStatus'],
      });

      clickExact(fixture, 'Pause');
      await settle(fixture);
      overlayButton('Pause').click();
      await settle(fixture);
      pressEscape();
      await settle(fixture);
      expect(dialog()).toBeNull();

      const pauseButton = () =>
        Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button')).find(
          (button) => (button.textContent ?? '').trim() === 'Pause',
        )!;
      expect(pauseButton().disabled).toBe(true);

      write.error(new ApiError('Pause failed. Try again.', 500));
      await settle(fixture);
      expect(text()).toContain('Pause failed. Try again.');
      expect(pauseButton().disabled).toBe(false);
    });

    it('resumes an existing Cancelled Schedule after confirmation', async () => {
      const resumed = schedule({ ...ALL[4], status: 'active', nextGeneration: new Date(2026, 11, 1) });
      const setStatus = vi.fn(() => of(resumed));
      const list = vi
        .fn()
        .mockReturnValueOnce(of(ALL))
        .mockReturnValueOnce(of([resumed]));
      const { fixture, text } = setup(list as SchedulesService['list'], {
        setStatus: setStatus as SchedulesService['setStatus'],
      });

      click(fixture, 'Past');
      click(fixture, 'Resume');
      await settle(fixture);
      overlayButton('Resume').click();
      await settle(fixture);

      expect(setStatus).toHaveBeenCalledWith(5, 'active');
      expect(list).toHaveBeenCalledTimes(2);
      expect(text()).toContain('Old plan');
      expect(text()).toContain('Next generation: 1 Dec 2026');
    });

    it('disables Resume for a retired Account and explains reactivation', () => {
      const paused = schedule({ id: 31, accountId: 2, name: 'Old wallet plan', status: 'paused' });
      const setStatus = vi.fn(() => of(paused));
      const { fixture, text } = setup(() => of([paused]), {
        setStatus: setStatus as SchedulesService['setStatus'],
      });

      click(fixture, 'Paused');
      const resume = Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button'),
      ).find((button) => (button.textContent ?? '').includes('Resume'))!;
      expect(resume.disabled).toBe(true);
      expect(text()).toContain('Reactivate this Account before resuming the Schedule.');
      resume.click();
      expect(setStatus).not.toHaveBeenCalled();
    });

    it('keeps a failed request actionable in the confirmation dialog', async () => {
      const setStatus = vi.fn(() => throwError(() => new ApiError('Pause failed. Try again.', 500)));
      const { fixture, dialog, dialogText } = setup(() => of(ALL), {
        setStatus: setStatus as SchedulesService['setStatus'],
      });

      clickExact(fixture, 'Pause');
      await settle(fixture);
      overlayButton('Pause').click();
      await settle(fixture);

      expect(dialog()).not.toBeNull();
      expect(dialogText()).toContain('Pause failed. Try again.');
      expect(overlayButton('Pause').disabled).toBe(false);
    });

    it('gates another lifecycle write after an uncertain timeout until refresh', async () => {
      const pending = new Subject<Schedule>();
      const setStatus = vi.fn(() => pending.asObservable());
      const { fixture, dialogText, text } = setup(() => of(ALL), {
        setStatus: setStatus as SchedulesService['setStatus'],
      });

      clickExact(fixture, 'Pause');
      await settle(fixture);
      vi.useFakeTimers();
      try {
        overlayButton('Pause').click();
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(15_000);
        fixture.detectChanges();

        expect(dialogText()).toContain('couldn’t confirm whether this Schedule changed');
        expect(overlayButton('Pause').disabled).toBe(true);
        expect(text()).toContain('Refresh before making changes.');
        expect(setStatus).toHaveBeenCalledOnce();
      } finally {
        vi.useRealTimers();
      }
    });

    it('refreshes a state conflict and explains the current state before retry', async () => {
      const conflict = new ApiError('This Schedule changed in another request.', 409);
      const changed = schedule({ ...ALL[1], status: 'paused' });
      const list = vi
        .fn()
        .mockReturnValueOnce(of(ALL))
        .mockReturnValueOnce(of([changed]));
      const setStatus = vi.fn(() => throwError(() => conflict));
      const { fixture, dialog, text } = setup(list as SchedulesService['list'], {
        setStatus: setStatus as SchedulesService['setStatus'],
      });

      clickExact(fixture, 'Pause');
      await settle(fixture);
      overlayButton('Pause').click();
      await settle(fixture);

      expect(dialog()).toBeNull();
      expect(list).toHaveBeenCalledTimes(2);
      expect(text()).toContain('This Schedule changed in another request.');
      expect(text()).toContain('It is currently paused.');
      expect(text()).toContain('Review the refreshed Schedule before trying again.');
    });
  });

  describe('delete an unused Schedule', () => {
    const UNUSED = schedule({
      id: 51,
      name: 'Unused allowance',
      generatedTransactionCount: 0,
      canDelete: true,
    });
    const NO_LONGER_DELETABLE = schedule({ ...UNUSED, canDelete: false });

    it('confirms with the Schedule name and cancellation leaves it unchanged', async () => {
      const deleteSchedule = vi.fn(() => of(undefined));
      const { fixture, text } = setup(() => of([UNUSED]), {
        delete: deleteSchedule as SchedulesService['delete'],
      });

      const opener = Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button'),
      ).find((button) => button.textContent?.trim() === 'Delete')!;
      opener.focus();
      opener.click();
      fixture.detectChanges();
      await settle(fixture);

      const confirmation = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('[role="alertdialog"]');
      expect(confirmation).not.toBeNull();
      expect(confirmation!.textContent).toContain('Delete ‘Unused allowance’?');
      expect(confirmation!.textContent).toContain('This permanently deletes this Schedule.');
      expect(document.activeElement?.textContent?.trim()).toBe('Cancel');

      clickExact(fixture, 'Cancel');
      await settle(fixture);

      expect((fixture.nativeElement as HTMLElement).querySelector('[role="alertdialog"]')).toBeNull();
      expect(document.activeElement?.textContent?.trim()).toBe('Delete');
      expect(text()).toContain('Unused allowance');
      expect(deleteSchedule).not.toHaveBeenCalled();
    });

    it('keeps the accessible confirmation usable at phone width', async () => {
      const originalWidth = window.innerWidth;
      const deleteSchedule = vi.fn(() => of(undefined));
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 360 });
      try {
        const { fixture } = setup(() => of([UNUSED]), {
          delete: deleteSchedule as SchedulesService['delete'],
        });

        clickExact(fixture, 'Delete');
        await settle(fixture);
        const confirmation = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('[role="alertdialog"]');
        expect(confirmation).not.toBeNull();
        expect(confirmation!.querySelectorAll('button').length).toBe(2);

        clickExact(fixture, 'Cancel');
        expect((fixture.nativeElement as HTMLElement).querySelector('[role="alertdialog"]')).toBeNull();
        expect(deleteSchedule).not.toHaveBeenCalled();
      } finally {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth });
      }
    });

    it('uses canDelete instead of surviving history to determine eligibility', () => {
      const neverUsed = schedule({
        id: 51,
        name: 'Never used',
        generatedTransactionCount: 0,
        canDelete: true,
      });
      const historyRemoved = schedule({ ...NO_LONGER_DELETABLE, id: 52, name: 'History removed' });
      const { fixture } = setup(() => of([neverUsed, historyRemoved]));

      const rows = Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('li[schedules-schedule-row]'),
      );
      const neverUsedRow = rows.find((row) => row.textContent?.includes('Never used'))!;
      const historyRemovedRow = rows.find((row) => row.textContent?.includes('History removed'))!;
      const deleteButton = (row: HTMLElement) =>
        Array.from(row.querySelectorAll<HTMLButtonElement>('button')).find(
          (button) => button.textContent?.trim() === 'Delete',
        )!;

      expect(neverUsedRow.textContent).toContain('0 surviving generated Transactions');
      expect(deleteButton(neverUsedRow).disabled).toBe(false);
      expect(historyRemovedRow.textContent).toContain('0 surviving generated Transactions');
      expect(deleteButton(historyRemovedRow).disabled).toBe(true);
      expect(historyRemovedRow.textContent).toContain(
        'This Schedule can’t be deleted because it has generated a Transaction.',
      );
    });

    it('keeps submitted controls pending, then closes and refreshes after deletion', async () => {
      const list = vi
        .fn()
        .mockReturnValueOnce(of([UNUSED]))
        .mockReturnValueOnce(of([]));
      const pending = new Subject<void>();
      const deleteSchedule = vi.fn(() => pending);
      const { fixture, text } = setup(list as SchedulesService['list'], {
        delete: deleteSchedule as SchedulesService['delete'],
      });

      clickExact(fixture, 'Delete');
      await settle(fixture);
      clickExact(fixture, 'Delete');
      await settle(fixture);

      expect(deleteSchedule).toHaveBeenCalledWith(51);
      const confirmation = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('[role="alertdialog"]')!;
      expect(confirmation.textContent).toContain('Deleting…');
      const confirmationButtons = confirmation.querySelectorAll<HTMLButtonElement>('button');
      expect(Array.from(confirmationButtons).every((button) => button.disabled)).toBe(true);
      const rowButtons = (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
        'li[schedules-schedule-row] button',
      );
      expect(Array.from(rowButtons).every((button) => button.disabled)).toBe(true);

      pending.next();
      pending.complete();
      await settle(fixture);

      expect((fixture.nativeElement as HTMLElement).querySelector('[role="alertdialog"]')).toBeNull();
      expect(list).toHaveBeenCalledTimes(2);
      expect((fixture.nativeElement as HTMLElement).querySelector('li[schedules-schedule-row]')).toBeNull();
      expect(text()).toContain('Unused allowance deleted.');
      expect(text()).toContain('No Schedules yet');
      expect(document.activeElement?.textContent?.trim()).toBe('Schedules');
    });

    it('keeps a failed deletion actionable in the confirmation dialog', async () => {
      const deleteSchedule = vi.fn(() => throwError(() => new ApiError('Deletion failed. Try again.', 500)));
      const { fixture, text } = setup(() => of([UNUSED]), {
        delete: deleteSchedule as SchedulesService['delete'],
      });

      clickExact(fixture, 'Delete');
      await settle(fixture);
      clickExact(fixture, 'Delete');
      await settle(fixture);

      const confirmation = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('[role="alertdialog"]');
      expect(confirmation).not.toBeNull();
      expect(confirmation!.textContent).toContain('Deletion failed. Try again.');
      expect(
        Array.from(confirmation!.querySelectorAll<HTMLButtonElement>('button')).find(
          (button) => button.textContent?.trim() === 'Delete',
        )!.disabled,
      ).toBe(false);
      expect(text()).toContain('Unused allowance');
    });

    it('refreshes instead of replaying a deletion with an uncertain outcome', async () => {
      const pending = new Subject<void>();
      const list = vi.fn().mockReturnValue(of([UNUSED]));
      const deleteSchedule = vi.fn(() => pending.asObservable());
      const { fixture, text } = setup(list as SchedulesService['list'], {
        delete: deleteSchedule as SchedulesService['delete'],
      });

      clickExact(fixture, 'Delete');
      await settle(fixture);
      vi.useFakeTimers();
      try {
        clickExact(fixture, 'Delete');
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(15_000);
        fixture.detectChanges();

        expect(deleteSchedule).toHaveBeenCalledOnce();
        expect(list).toHaveBeenCalledTimes(2);
        expect(text()).toContain('couldn’t confirm whether this Schedule was deleted');
        expect((fixture.nativeElement as HTMLElement).querySelector('[role="alertdialog"]')).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it('refreshes a deletion conflict and explains the authoritative server state', async () => {
      const list = vi
        .fn()
        .mockReturnValueOnce(of([UNUSED]))
        .mockReturnValueOnce(of([NO_LONGER_DELETABLE]));
      const deleteSchedule = vi.fn(() =>
        throwError(() => new ApiError('This Schedule has generated a Transaction and cannot be deleted.', 409)),
      );
      const { fixture, text } = setup(list as SchedulesService['list'], {
        delete: deleteSchedule as SchedulesService['delete'],
      });

      clickExact(fixture, 'Delete');
      await settle(fixture);
      clickExact(fixture, 'Delete');
      await settle(fixture);

      expect((fixture.nativeElement as HTMLElement).querySelector('[role="alertdialog"]')).toBeNull();
      expect(list).toHaveBeenCalledTimes(2);
      expect(text()).toContain('Unused allowance');
      expect(text()).toContain('This Schedule has generated a Transaction and cannot be deleted.');
      expect(text()).toContain('Review the refreshed Schedule before trying again.');
      expect(text()).toContain('This Schedule can’t be deleted because it has generated a Transaction.');
    });

    it('disables an open deletion confirmation when list information becomes stale', async () => {
      const list = vi
        .fn()
        .mockReturnValueOnce(of([UNUSED]))
        .mockReturnValueOnce(throwError(() => new ApiError('Offline', 0)));
      const deleteSchedule = vi.fn(() => of(undefined));
      const { fixture } = setup(list as SchedulesService['list'], {
        delete: deleteSchedule as SchedulesService['delete'],
      });

      clickExact(fixture, 'Delete');
      await settle(fixture);
      click(fixture, 'Refresh');
      await settle(fixture);
      const confirmation = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('[role="alertdialog"]')!;
      const deleteButton = Array.from(confirmation.querySelectorAll<HTMLButtonElement>('button')).find(
        (button) => button.textContent?.trim() === 'Delete',
      )!;

      expect(deleteButton.disabled).toBe(true);
      deleteButton.click();
      await settle(fixture);
      expect((fixture.nativeElement as HTMLElement).querySelector('[role="alertdialog"]')).not.toBeNull();
      expect(deleteSchedule).not.toHaveBeenCalled();
    });

    it('explains revoked deletion eligibility while confirmation is open', async () => {
      const list = vi
        .fn()
        .mockReturnValueOnce(of([UNUSED]))
        .mockReturnValueOnce(of([NO_LONGER_DELETABLE]));
      const deleteSchedule = vi.fn(() => of(undefined));
      const { fixture } = setup(list as SchedulesService['list'], {
        delete: deleteSchedule as SchedulesService['delete'],
      });

      clickExact(fixture, 'Delete');
      await settle(fixture);
      click(fixture, 'Refresh');
      await settle(fixture);

      const confirmation = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('[role="alertdialog"]')!;
      const deleteButton = Array.from(confirmation.querySelectorAll<HTMLButtonElement>('button')).find(
        (button) => button.textContent?.trim() === 'Delete',
      )!;
      expect(deleteButton.disabled).toBe(true);
      expect(confirmation.textContent).toContain(
        'This Schedule can’t be deleted because it has generated a Transaction.',
      );
      deleteButton.click();
      expect(deleteSchedule).not.toHaveBeenCalled();
    });
  });

  describe('extend a Completed Schedule', () => {
    const pinTimezone = withPinnedTimezone();
    beforeEach(() => pinTimezone('Asia/Manila'));

    const completed = schedule({
      id: 41,
      name: 'Quarterly dues',
      direction: 'expense',
      frequency: 'monthly',
      firstGeneration: new Date(2026, 0, 31),
      lastGeneration: new Date(2026, 7, 31),
      nextGeneration: new Date(2026, 7, 31),
      status: 'completed',
    });

    async function openExtend(fixture: ComponentFixture<ScheduleList>) {
      click(fixture, 'Past');
      click(fixture, 'Extend');
      await settle(fixture);
    }

    async function withSystemTime(instant: string, run: () => Promise<void>) {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(instant));
      try {
        await run();
      } finally {
        vi.useRealTimers();
      }
    }

    it('offers Extend only for Completed Schedules and explains the next cadence occurrence', async () => {
      await withSystemTime('2026-09-20T01:00:00.000Z', async () => {
        const { fixture, dialog, dialogText } = setup(() => of([completed, ALL[4]]));
        click(fixture, 'Past');
        const rows = Array.from(
          (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('li[schedules-schedule-row]'),
        );
        expect(rows.find((row) => row.textContent?.includes('Quarterly dues'))?.textContent).toContain('Extend');
        expect(rows.find((row) => row.textContent?.includes('Old plan'))?.textContent).not.toContain('Extend');

        click(fixture, 'Extend');
        await settle(fixture);
        expect(dialog()).not.toBeNull();
        expect(dialogText()).toContain('Extend ‘Quarterly dues’');
        expect(dialogText()).toContain('Last generation');
        expect(dialogText()).toContain('Continue indefinitely');
        expect(dialogText()).toContain(
          'Your Schedule will continue from 30 Sep 2026. Missed occurrences won’t be generated.',
        );
        expect(dialogText()).toContain('An occurrence on this date is included.');
        expect(overlayButton('Extend and resume')).not.toBeNull();
      });
    });

    it('submits a finite end, closes, refreshes, and shows the active Schedule', async () => {
      await withSystemTime('2026-09-20T01:00:00.000Z', async () => {
        const resumed = schedule({
          ...completed,
          status: 'active',
          lastGeneration: new Date(2026, 11, 31),
          nextGeneration: new Date(2026, 8, 30),
        });
        const list = vi
          .fn()
          .mockReturnValueOnce(of([completed]))
          .mockReturnValueOnce(of([resumed]));
        const extend = vi.fn((_id: number, _lastGeneration: Date | null) => of(resumed));
        const { fixture, dialog, text } = setup(list as SchedulesService['list'], {
          extend: extend as SchedulesService['extend'],
        });

        await openExtend(fixture);
        typeInto('#extend-schedule-last-generation', '2026-12-31');
        await settle(fixture);
        overlayButton('Extend and resume').click();
        await settle(fixture);

        expect(extend).toHaveBeenCalledWith(41, expect.any(Date));
        const submitted = extend.mock.calls[0][1] as Date;
        expect([submitted.getFullYear(), submitted.getMonth(), submitted.getDate()]).toEqual([2026, 11, 31]);
        expect(dialog()).toBeNull();
        expect(list).toHaveBeenCalledTimes(2);
        expect(text()).toContain('Next generation: 30 Sep 2026');
      });
    });

    it('sends explicit indefinite continuation and keeps controls pending', async () => {
      const pending = new Subject<Schedule>();
      const extend = vi.fn(() => pending.asObservable());
      const { fixture, dialogText } = setup(() => of([completed]), {
        extend: extend as SchedulesService['extend'],
      });

      await openExtend(fixture);
      overlay().querySelector<HTMLInputElement>('#extend-schedule-indefinite')!.click();
      await settle(fixture);
      overlayButton('Extend and resume').click();
      fixture.detectChanges();

      expect(extend).toHaveBeenCalledWith(41, null);
      expect(dialogText()).toContain('Extending…');
      expect(overlayButton('Extending…').disabled).toBe(true);
      expect(overlayButton('Cancel').disabled).toBe(true);
      pressEscape();
      await settle(fixture);
      expect(dialogText()).toContain('Saving in progress. Wait for it to finish before closing.');

      pending.next({ ...completed, status: 'active', lastGeneration: null });
      pending.complete();
      await settle(fixture);
    });

    it('validates the finite inclusive end against the next eligible occurrence', async () => {
      await withSystemTime('2026-09-20T01:00:00.000Z', async () => {
        const { fixture, dialogText } = setup(() => of([completed]));
        await openExtend(fixture);
        typeInto('#extend-schedule-last-generation', '2026-09-29');
        overlay().querySelector<HTMLInputElement>('#extend-schedule-last-generation')!.dispatchEvent(new Event('blur'));
        await settle(fixture);

        expect(dialogText()).toContain('Choose 30 Sep 2026 or later');
        expect(overlayButton('Extend and resume').disabled).toBe(false);
      });
    });

    it('uses UTC today for the preview when the local calendar is already tomorrow', async () => {
      await withSystemTime('2026-09-19T18:30:00.000Z', async () => {
        const daily = schedule({
          ...completed,
          frequency: 'daily',
          firstGeneration: new Date(2026, 8, 1),
          lastGeneration: new Date(2026, 8, 18),
          nextGeneration: new Date(2026, 8, 18),
        });
        const { fixture, dialogText } = setup(() => of([daily]));
        await openExtend(fixture);

        expect(dialogText()).toContain('Your Schedule will continue from 19 Sep 2026.');
      });
    });

    it('advances beyond the old inclusive end before previewing continuation', async () => {
      await withSystemTime('2026-09-19T18:30:00.000Z', async () => {
        const daily = schedule({
          ...completed,
          frequency: 'daily',
          firstGeneration: new Date(2026, 8, 1),
          lastGeneration: new Date(2026, 8, 19),
          nextGeneration: new Date(2026, 8, 19),
        });
        const { fixture, dialogText } = setup(() => of([daily]));
        await openExtend(fixture);

        expect(dialogText()).toContain('Your Schedule will continue from 20 Sep 2026.');
        typeInto('#extend-schedule-last-generation', '2026-09-19');
        overlay().querySelector<HTMLInputElement>('#extend-schedule-last-generation')!.dispatchEvent(new Event('blur'));
        await settle(fixture);
        expect(dialogText()).toContain('Choose 20 Sep 2026 or later');
      });
    });

    it('uses the shared responsive dialog and restores focus after Escape', async () => {
      const originalWidth = window.innerWidth;
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 360 });
      try {
        const { fixture, dialog } = setup(() => of([completed]));
        click(fixture, 'Past');
        const opener = Array.from(
          (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button'),
        ).find((button) => button.textContent?.includes('Extend'))!;
        opener.focus();
        opener.click();
        await settle(fixture);
        expect(dialog()).not.toBeNull();
        expect(overlay().querySelector('.app-dialog-panel')).not.toBeNull();

        pressEscape();
        await settle(fixture);
        expect(dialog()).toBeNull();
        expect(document.activeElement).toBe(opener);
      } finally {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth });
      }
    });

    it('keeps the finite end after a validation error', async () => {
      const validationExtend = vi.fn(() =>
        throwError(() => new ApiError('Validation failed.', 400, { lastGeneration: ['Choose 1 Jan 2027 or later'] })),
      );
      const validation = setup(() => of([completed]), {
        extend: validationExtend as SchedulesService['extend'],
      });
      await openExtend(validation.fixture);
      typeInto('#extend-schedule-last-generation', '2026-12-31');
      await settle(validation.fixture);
      overlayButton('Extend and resume').click();
      await settle(validation.fixture);
      expect(validation.dialog()).not.toBeNull();
      expect(validation.dialogText()).toContain('Choose 1 Jan 2027 or later');
      expect(overlay().querySelector<HTMLInputElement>('#extend-schedule-last-generation')!.value).toBe('2026-12-31');
    });

    it('closes and refreshes after a state conflict', async () => {
      const list = vi.fn().mockReturnValue(of([completed]));
      const conflictExtend = vi.fn(() => throwError(() => new ApiError('This Schedule changed.', 409)));
      const conflict = setup(list as SchedulesService['list'], {
        extend: conflictExtend as SchedulesService['extend'],
      });
      await openExtend(conflict.fixture);
      overlay().querySelector<HTMLInputElement>('#extend-schedule-indefinite')!.click();
      await settle(conflict.fixture);
      overlayButton('Extend and resume').click();
      await settle(conflict.fixture);
      expect(conflict.dialog()).toBeNull();
      expect(list).toHaveBeenCalledTimes(2);
      expect(conflict.text()).toContain('This Schedule changed.');
      expect(conflict.text()).toContain('Review the refreshed Schedule before trying again.');
    });

    it('disables Extend for a retired Account and explains reactivation', () => {
      const retired = { ...completed, accountId: 2 };
      const extend = vi.fn(() => of(completed));
      const retiredList = setup(() => of([retired]), { extend: extend as SchedulesService['extend'] });
      click(retiredList.fixture, 'Past');
      const retiredButton = Array.from(
        (retiredList.fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button'),
      ).find((button) => button.textContent?.includes('Extend'))!;
      expect(retiredButton.disabled).toBe(true);
      expect(retiredList.text()).toContain('Reactivate this Account before extending the Schedule.');
    });

    it('disables Extend while information is stale', () => {
      const list = vi
        .fn()
        .mockReturnValueOnce(of([completed]))
        .mockReturnValueOnce(throwError(() => new ApiError('Offline', 0)));
      const stale = setup(list as SchedulesService['list']);
      click(stale.fixture, 'Refresh');
      click(stale.fixture, 'Past');
      const staleButton = Array.from(
        (stale.fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button'),
      ).find((button) => button.textContent?.includes('Extend'))!;
      expect(staleButton.disabled).toBe(true);
    });
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
    expect(text()).toContain('Couldn’t refresh. These Schedules may be out of date');

    click(fixture, 'Retry');
    expect(text()).toContain('Sooner salary');
    expect(text()).not.toContain('may be out of date');
  });

  it('keeps generated history accessible while the Schedule list is stale', () => {
    const list = vi
      .fn()
      .mockReturnValueOnce(of([ALL[0]]))
      .mockReturnValueOnce(throwError(() => new ApiError('Offline', 0)));
    const { fixture } = setup(list as SchedulesService['list']);

    click(fixture, 'Refresh');
    const link = (fixture.nativeElement as HTMLElement).querySelector<HTMLAnchorElement>(
      'a[aria-label="View generated Transactions for Later salary"]',
    );

    expect(link).not.toBeNull();
    expect(link!.getAttribute('href')).toBe('/app/transactions?schedule=1&scheduleName=Later%20salary');
    expect(link!.getAttribute('aria-disabled')).toBeNull();
  });

  it('disables Edit while the list is stale', () => {
    const list = vi
      .fn()
      .mockReturnValueOnce(of([ALL[0]]))
      .mockReturnValueOnce(throwError(() => new ApiError('Offline', 0)));
    const { fixture } = setup(list as SchedulesService['list']);

    click(fixture, 'Refresh');
    const edit = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => (button.textContent ?? '').includes('Edit'),
    )!;

    expect(edit.disabled).toBe(true);
    const pause = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => (button.textContent ?? '').trim() === 'Pause',
    )!;
    expect(pause.disabled).toBe(true);
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

    it('keeps invalid Submit enabled, reveals errors, and focuses the first invalid field', async () => {
      const create = vi.fn(() => of(ALL[0]));
      const { fixture } = setup(() => of(ALL), { create: create as SchedulesService['create'] });

      click(fixture, 'Create Schedule');
      await settle(fixture);
      const submit = overlayButton('Create Schedule');
      expect(submit.disabled).toBe(false);

      overlay().querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
      await settle(fixture);

      expect(create).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(overlay().querySelector('#schedule-name'));
      expect(overlay().textContent).toContain('You must enter a name');
    });

    it('asks before discarding a changed Schedule editor', async () => {
      const { fixture, dialogText } = setup(() => of(ALL));

      click(fixture, 'Create Schedule');
      await settle(fixture);
      typeInto('#schedule-name', 'Monthly allowance');
      await settle(fixture);
      overlayButton('Cancel').click();
      await settle(fixture);

      expect(dialogText()).toContain('Discard changes?');
      expect(document.activeElement?.textContent).toContain('Keep editing');
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

    it('keeps the previous ledger and gates actions when the post-create refresh fails', async () => {
      const created = schedule({ id: 22, name: 'Market allowance' });
      const list = vi
        .fn()
        .mockReturnValueOnce(of(ALL))
        .mockReturnValueOnce(throwError(() => new ApiError('Offline', 0)));
      const { fixture, dialog, text } = setup(list as SchedulesService['list'], {
        create: (() => of(created)) as SchedulesService['create'],
      });

      await openDialog(fixture);
      await fillValidSchedule(fixture);
      overlayButton('Create Schedule').click();
      await settle(fixture);

      expect(dialog()).toBeNull();
      expect(text()).toContain('Saved, but couldn’t refresh');
      expect(text()).toContain('Sooner salary');
      const createButton = Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button'),
      ).find((button) => (button.textContent ?? '').includes('Create Schedule'))!;
      expect(createButton.disabled).toBe(true);
    });

    it('announces routine success once and dismisses it after five seconds', async () => {
      const created = schedule({ id: 22, name: 'Market allowance' });
      const list = vi
        .fn()
        .mockReturnValueOnce(of(ALL))
        .mockReturnValueOnce(of([...ALL, created]));
      const { fixture, text } = setup(list as SchedulesService['list'], {
        create: (() => of(created)) as SchedulesService['create'],
      });

      await openDialog(fixture);
      await fillValidSchedule(fixture);
      vi.useFakeTimers();
      try {
        overlayButton('Create Schedule').click();
        await Promise.resolve();
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(0);
        fixture.detectChanges();
        expect(text()).toContain('Market allowance created.');

        await vi.advanceTimersByTimeAsync(5_000);
        fixture.detectChanges();
        expect(text()).not.toContain('Market allowance created.');
        expect(text()).toContain('Market allowance');
      } finally {
        vi.useRealTimers();
      }
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
      overlayButton('Cancel').click();
      await settle(fixture);
      expect(dialogText()).toContain('Saving in progress. Wait for it to finish before closing.');

      pending.next(ALL[0]);
      pending.complete();
      await settle(fixture);
    });

    it('releases a timed-out create with refresh-before-retry guidance', async () => {
      const pending = new Subject<Schedule>();
      const create = vi.fn((_value: NewSchedule) => pending.asObservable());
      const { fixture, dialog, dialogText } = setup(() => of(ALL), {
        create: create as SchedulesService['create'],
      });

      await openDialog(fixture);
      await fillValidSchedule(fixture);
      vi.useFakeTimers();
      try {
        overlayButton('Create Schedule').click();
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(15_000);
        fixture.detectChanges();

        expect(dialogText()).toContain('couldn’t confirm whether this Schedule was created');
        expect(overlayButton('Create Schedule').disabled).toBe(true);
        expect(create).toHaveBeenCalledOnce();

        overlayButton('Cancel').click();
        fixture.detectChanges();
        overlayButton('Discard changes').click();
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(0);
        fixture.detectChanges();
        expect(dialog()).toBeNull();
        const pageCreate = Array.from(
          (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button'),
        ).find((button) => (button.textContent ?? '').includes('Create Schedule'))!;
        expect(pageCreate.disabled).toBe(true);

        click(fixture, 'Retry');
        expect(pageCreate.disabled).toBe(false);
      } finally {
        vi.useRealTimers();
      }
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

      expect(text()).toContain('Couldn’t refresh. These Schedules may be out of date');
      const createButtons = Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button'),
      ).filter((button) => (button.textContent ?? '').includes('Create Schedule'));
      expect(createButtons).toHaveLength(2);
      expect(createButtons.every((button) => button.disabled)).toBe(true);
    });
  });

  describe('edit, in a dialog', () => {
    const pinTimezone = withPinnedTimezone();

    function editableSchedule(overrides: Partial<Schedule> = {}) {
      return schedule({
        id: 31,
        name: 'Rent',
        direction: 'expense',
        amount: 18500,
        description: 'Current lease',
        categoryId: 11,
        frequency: 'monthly',
        firstGeneration: new Date(2026, 6, 1),
        lastGeneration: new Date(2027, 5, 1),
        nextGeneration: new Date(2026, 9, 1),
        ...overrides,
      });
    }

    it('prefills editable details and presents structural details as fixed', async () => {
      const editable = editableSchedule();
      const { fixture, dialog, dialogText } = setup(() => of([editable]));

      click(fixture, 'Edit');
      await settle(fixture);

      expect(dialog()).not.toBeNull();
      expect(dialogText()).toContain('Edit Schedule');
      expect(overlay().querySelector<HTMLInputElement>('#edit-schedule-name')!.value).toBe('Rent');
      expect(overlay().querySelector<HTMLInputElement>('#edit-schedule-amount')!.value).toBe('18500');
      expect(overlay().querySelector<HTMLTextAreaElement>('#edit-schedule-description')!.value).toBe('Current lease');
      expect(overlay().querySelector<HTMLInputElement>('#edit-schedule-last-generation')!.value).toBe('6/1/2027');
      expect(dialogText()).toContain('BPI Savings');
      expect(dialogText()).toContain('Expense');
      expect(dialogText()).toContain('Monthly');
      expect(dialogText()).toContain('1 Jul 2026');
      expect(overlay().querySelector('#edit-schedule-account')).toBeNull();
      expect(overlay().querySelector('#edit-schedule-direction')).toBeNull();
      expect(overlay().querySelector('#edit-schedule-frequency')).toBeNull();
      expect(overlay().querySelector('#edit-schedule-first-generation')).toBeNull();
    });

    it('warns and explicitly saves a shortened end that completes the Schedule', async () => {
      const editable = editableSchedule();
      const completed = editableSchedule({
        name: 'Apartment rent',
        amount: 19000,
        categoryId: 12,
        description: 'New lease',
        lastGeneration: new Date(2026, 7, 1),
        status: 'completed',
      });
      const list = vi
        .fn()
        .mockReturnValueOnce(of([editable]))
        .mockReturnValueOnce(of([completed]));
      const update = vi.fn((_id: number, _value: ScheduleUpdate) => of(completed));
      const { fixture, dialog, dialogText, text } = setup(list as SchedulesService['list'], {
        update: update as SchedulesService['update'],
      });

      click(fixture, 'Edit');
      await settle(fixture);
      typeInto('#edit-schedule-name', 'Apartment rent');
      typeInto('#edit-schedule-amount', '19000');
      typeInto('#edit-schedule-description', 'New lease');
      await pickOption(fixture, '#edit-schedule-category', 'Groceries');
      typeInto('#edit-schedule-last-generation', '2026-08-01');
      await settle(fixture);

      expect(dialogText()).toContain('This change will complete the Schedule. Existing Transactions won’t change.');
      expect(overlayButton('Save and complete')).not.toBeNull();
      overlayButton('Save and complete').click();
      await settle(fixture);

      expect(update).toHaveBeenCalledWith(31, {
        name: 'Apartment rent',
        amount: 19000,
        categoryId: 12,
        description: 'New lease',
        lastGeneration: expect.any(Date),
      });
      const submitted = update.mock.calls[0][1].lastGeneration!;
      expect([submitted.getFullYear(), submitted.getMonth(), submitted.getDate()]).toEqual([2026, 7, 1]);
      expect(dialog()).toBeNull();
      expect(list).toHaveBeenCalledTimes(2);
      click(fixture, 'Past');
      expect(text()).toContain('Apartment rent');
      expect(text()).toContain('Completed');
    });

    it('retains and labels the saved retired Category, allows clearing it, and withholds other retired choices', async () => {
      const editable = editableSchedule();
      const categories = [
        ...CATEGORIES,
        { id: 13, name: 'Old utilities', kind: 'expense' as const, isActive: false, isDefault: false },
      ];
      const update = vi.fn((_id: number, _value: ScheduleUpdate) => of({ ...editable, categoryId: null }));
      const { fixture } = setup(() => of([editable]), {
        categories,
        update: update as SchedulesService['update'],
      });

      click(fixture, 'Edit');
      await settle(fixture);
      overlay().querySelector<HTMLElement>('#edit-schedule-category')!.click();
      await settle(fixture);
      const optionLabels = Array.from(overlay().querySelectorAll<HTMLElement>('mat-option')).map((option) =>
        (option.textContent ?? '').replace(/\s+/g, ' ').trim(),
      );
      expect(optionLabels).toContain('Housing · Retired');
      expect(optionLabels).toContain('Groceries');
      expect(optionLabels).not.toContain('Old utilities · Retired');

      const clear = Array.from(overlay().querySelectorAll<HTMLElement>('mat-option')).find(
        (option) => (option.textContent ?? '').trim() === 'Uncategorized',
      )!;
      clear.click();
      await settle(fixture);
      overlayButton('Save changes').click();
      await settle(fixture);

      expect(update.mock.calls[0][1].categoryId).toBeNull();
    });

    it('keeps the dialog values and attributes duplicate-name failures', async () => {
      const editable = editableSchedule();
      const update = vi.fn(() =>
        throwError(
          () =>
            new ApiError('A Schedule with this name already exists.', 409, {
              name: ['A Schedule with this name already exists.'],
            }),
        ),
      );
      const { fixture, dialog, dialogText } = setup(() => of([editable]), {
        update: update as SchedulesService['update'],
      });

      click(fixture, 'Edit');
      await settle(fixture);
      typeInto('#edit-schedule-name', 'Other rent');
      typeInto('#edit-schedule-description', 'Keep this text');
      overlayButton('Save changes').click();
      await settle(fixture);

      expect(dialog()).not.toBeNull();
      expect(dialogText()).toContain('A Schedule with this name already exists.');
      expect(overlay().querySelector<HTMLInputElement>('#edit-schedule-name')!.value).toBe('Other rent');
      expect(overlay().querySelector<HTMLTextAreaElement>('#edit-schedule-description')!.value).toBe('Keep this text');
    });

    it('refreshes and explains an unattributed state conflict while preserving values', async () => {
      const editable = editableSchedule();
      const completed = editableSchedule({ status: 'completed' });
      const list = vi
        .fn()
        .mockReturnValueOnce(of([editable]))
        .mockReturnValueOnce(of([completed]))
        .mockReturnValueOnce(of([completed]));
      const refreshCategories = vi.fn(() => of(CATEGORIES.filter((category) => category.isActive)));
      const update = vi.fn(() => throwError(() => new ApiError('The Schedule changed.', 409)));
      const { fixture, dialogText } = setup(list as SchedulesService['list'], {
        update: update as SchedulesService['update'],
        refreshCategories,
      });

      click(fixture, 'Edit');
      await settle(fixture);
      typeInto('#edit-schedule-name', 'Keep my edit');
      overlayButton('Save changes').click();
      await settle(fixture);

      expect(dialogText()).toContain('Review the refreshed information and try again.');
      expect(dialogText()).toContain('This Schedule is now Completed.');
      expect(list).toHaveBeenCalledTimes(2);
      expect(refreshCategories).toHaveBeenCalledOnce();
      expect(overlay().querySelector<HTMLInputElement>('#edit-schedule-name')!.value).toBe('Keep my edit');
      expect(overlayButton('Save changes').disabled).toBe(true);

      pressEscape();
      await settle(fixture);
      expect(dialogText()).toContain('Discard changes?');
      overlayButton('Discard changes').click();
      await settle(fixture);
      expect(list).toHaveBeenCalledTimes(2);
    });

    it('blocks retry when the Schedule is absent from refreshed state after a conflict', async () => {
      const editable = editableSchedule();
      const list = vi
        .fn()
        .mockReturnValueOnce(of([editable]))
        .mockReturnValueOnce(of([]));
      const update = vi.fn(() => throwError(() => new ApiError('The Schedule changed.', 409)));
      const { fixture, dialogText } = setup(list as SchedulesService['list'], {
        update: update as SchedulesService['update'],
      });

      click(fixture, 'Edit');
      await settle(fixture);
      overlayButton('Save changes').click();
      await settle(fixture);

      expect(dialogText()).toContain('Current Schedule information is unavailable.');
      expect(overlayButton('Save changes').disabled).toBe(true);
      expect(update).toHaveBeenCalledOnce();
    });

    it.each([
      ['daily', [2026, 8, 1], '9/19/2026', '9/20/2026'],
      ['weekly', [2026, 8, 1], '9/21/2026', '9/22/2026'],
      ['monthly', [2026, 0, 31], '9/29/2026', '9/30/2026'],
      ['yearly', [2024, 1, 29], '2/27/2027', '2/28/2027'],
    ] as const)(
      'anchors a paused %s Schedule to First generation when deciding whether the end completes it',
      async (frequency, firstParts, beforeEligible, onEligible) => {
        pinTimezone('America/Los_Angeles');
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-09-20T00:30:00.000Z'));
        try {
          const firstGeneration = new Date(firstParts[0], firstParts[1], firstParts[2]);
          const paused = editableSchedule({
            status: 'paused',
            frequency,
            firstGeneration,
            nextGeneration: new Date(2026, 8, 1),
          });
          const { fixture, dialogText } = setup(() => of([paused]));
          click(fixture, 'Paused');
          click(fixture, 'Edit');
          await settle(fixture);

          typeInto('#edit-schedule-last-generation', beforeEligible);
          await settle(fixture);
          expect(dialogText()).toContain('This change will complete the Schedule.');
          expect(overlayButton('Save and complete')).not.toBeNull();

          typeInto('#edit-schedule-last-generation', onEligible);
          await settle(fixture);
          expect(dialogText()).not.toContain('This change will complete the Schedule.');
          expect(overlayButton('Save changes')).not.toBeNull();
        } finally {
          vi.useRealTimers();
        }
      },
    );

    it('refreshes Category eligibility after rejection and requires another choice', async () => {
      const editable = editableSchedule({ categoryId: 11 });
      const refreshCategories = vi.fn(() =>
        of([
          { id: 10, name: 'Salary', kind: 'income' as const, isActive: true, isDefault: false },
          { id: 14, name: 'Utilities', kind: 'expense' as const, isActive: true, isDefault: false },
        ]),
      );
      const update = vi.fn(() =>
        throwError(() => new ApiError('Validation failed.', 400, { categoryId: ['Choose an active Category.'] })),
      );
      const { fixture, dialogText } = setup(() => of([editable]), {
        update: update as SchedulesService['update'],
        refreshCategories,
      });

      click(fixture, 'Edit');
      await settle(fixture);
      await pickOption(fixture, '#edit-schedule-category', 'Groceries');
      overlayButton('Save changes').click();
      await settle(fixture);

      expect(dialogText()).toContain('Choose an active Category.');
      expect(refreshCategories).toHaveBeenCalledOnce();
      expect(overlayButton('Save changes').disabled).toBe(true);
      overlay().querySelector<HTMLElement>('#edit-schedule-category')!.click();
      await settle(fixture);
      expect(overlay().textContent).not.toContain('Groceries');
      expect(overlay().textContent).toContain('Utilities');
    });

    it('validates the earliest Last generation and treats an occurrence on the end as eligible', async () => {
      const editable = editableSchedule();
      const { fixture, dialogText } = setup(() => of([editable]));

      click(fixture, 'Edit');
      await settle(fixture);
      typeInto('#edit-schedule-last-generation', '2026-07-01');
      overlay().querySelector<HTMLInputElement>('#edit-schedule-last-generation')!.dispatchEvent(new Event('blur'));
      await settle(fixture);
      expect(dialogText()).toContain('Choose 2 Jul 2026 or later');

      typeInto('#edit-schedule-last-generation', '2026-10-01');
      await settle(fixture);
      expect(dialogText()).not.toContain('This change will complete the Schedule.');
      expect(overlayButton('Save changes')).not.toBeNull();
    });

    it('keeps one update pending and prevents another submission', async () => {
      const editable = editableSchedule();
      const pending = new Subject<Schedule>();
      const update = vi.fn((_id: number, _value: ScheduleUpdate) => pending.asObservable());
      const { fixture, dialogText } = setup(() => of([editable]), {
        update: update as SchedulesService['update'],
      });

      click(fixture, 'Edit');
      await settle(fixture);
      const submit = overlayButton('Save changes');
      submit.click();
      fixture.detectChanges();

      expect(dialogText()).toContain('Saving…');
      expect(submit.disabled).toBe(true);
      submit.click();
      expect(update).toHaveBeenCalledOnce();
      overlayButton('Cancel').click();
      await settle(fixture);
      expect(dialogText()).toContain('Saving in progress. Wait for it to finish before closing.');

      pending.next(editable);
      pending.complete();
      await settle(fixture);
    });

    it('uses the shared responsive, keyboard-accessible dialog behavior', async () => {
      const originalWidth = window.innerWidth;
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 360 });
      try {
        const { fixture, dialog } = setup(() => of([editableSchedule()]));
        const opener = Array.from(
          (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button'),
        ).find((button) => (button.textContent ?? '').includes('Edit'))!;
        opener.focus();
        opener.click();
        await settle(fixture);

        expect(dialog()).not.toBeNull();
        expect(overlay().querySelector('.app-dialog-panel')).not.toBeNull();
        expect(overlay().contains(document.activeElement)).toBe(true);
        overlay().querySelector<HTMLElement>('.cdk-overlay-backdrop')!.click();
        await settle(fixture);
        expect(dialog()).not.toBeNull();

        pressEscape();
        await settle(fixture);
        expect(dialog()).toBeNull();
        expect(document.activeElement).toBe(opener);
      } finally {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth });
      }
    });
  });
});
