import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  MATERIAL_ANIMATIONS,
  provideNativeDateAdapter,
} from '@angular/material/core';
import { provideRouter } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { provideDialogDefaults } from '@/app/core/dialog';
import { provideIcons } from '@/app/core/icons';
import { formatPeso } from '@/app/core/money';
import { CategoriesService } from '@/app/domains/app/categories/categories.service';
import { pressEscape, withOverlayContainer } from '@/testing/overlay';
import { Budget, BudgetWithSpend } from '../../data/budget';
import { BudgetsService } from '../../data/budgets.service';
import BudgetList from './budget-list';

/** A live monthly Budget on Groceries, a little over half spent. */
const GROCERIES: BudgetWithSpend = {
  id: 1,
  name: 'Groceries',
  amountLimit: 20000,
  period: 'monthly',
  startDate: new Date(2026, 0, 1),
  endDate: null,
  categoryId: 10,
  amountSpent: 12400,
  cycleStart: new Date(2026, 7, 1),
  cycleEnd: new Date(2026, 7, 31),
};

/**
 * A live weekly Budget over all spending, spent past its ceiling — sorts after
 * "Groceries" by name.
 */
const TRANSPORT: BudgetWithSpend = {
  id: 2,
  name: 'Transport',
  amountLimit: 3000,
  period: 'weekly',
  startDate: new Date(2026, 5, 1),
  endDate: null,
  categoryId: null,
  amountSpent: 3200,
  cycleStart: new Date(2026, 7, 24),
  cycleEnd: new Date(2026, 7, 30),
};

/** Starts in December — not yet started as of the "today" in context. */
const HOLIDAYS: BudgetWithSpend = {
  id: 3,
  name: 'Holidays',
  amountLimit: 50000,
  period: 'yearly',
  startDate: new Date(2026, 11, 1),
  endDate: null,
  categoryId: 10,
  amountSpent: 0,
  cycleStart: new Date(2026, 11, 1),
  cycleEnd: new Date(2026, 11, 31),
};

/** Ended in the past — finished — and its final Cycle came in under. */
const SUMMER: BudgetWithSpend = {
  id: 4,
  name: 'Summer trip',
  amountLimit: 40000,
  period: 'monthly',
  startDate: new Date(2026, 3, 1),
  endDate: new Date(2026, 6, 31),
  categoryId: 10,
  amountSpent: 38000,
  cycleStart: new Date(2026, 6, 1),
  cycleEnd: new Date(2026, 6, 31),
};

const CATEGORY_NAMES: ReadonlyMap<number, string> = new Map([[10, 'Food']]);

describe('BudgetList', () => {
  const overlay = withOverlayContainer();
  // "today" is 2026-08-31 (see currentDate). The fixtures' start/end dates sit
  // whole months either side of it, so their Live / Not-started / Finished
  // grouping is the same in every timezone — no pin needed.

  function setup(
    list: BudgetsService['list'],
    overrides: {
      create?: BudgetsService['create'];
      adjust?: BudgetsService['adjust'];
      remove?: BudgetsService['remove'];
      names?: CategoriesService['names'];
    } = {}
  ) {
    TestBed.configureTestingModule({
      imports: [BudgetList],
      providers: [
        provideIcons(),
        provideRouter([]),
        provideDialogDefaults(),
        provideNativeDateAdapter(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        {
          provide: BudgetsService,
          useValue: {
            list,
            create: overrides.create ?? (() => of(GROCERIES)),
            adjust: overrides.adjust ?? (() => of(GROCERIES)),
            remove: overrides.remove ?? (() => of(undefined)),
          },
        },
        {
          provide: CategoriesService,
          useValue: {
            names: overrides.names ?? (() => of(CATEGORY_NAMES)),
            // The create dialog's form reads this for its expense-Category picker.
            list: () => of([{ id: 10, name: 'Food', kind: 'expense' }]),
          },
        },
      ],
    });

    const fixture = TestBed.createComponent(BudgetList);
    fixture.detectChanges();

    return {
      fixture,
      text: () => (fixture.nativeElement as HTMLElement).textContent ?? '',
      dialog: () => overlay().querySelector<HTMLElement>('[role="dialog"]'),
      dialogText: () => overlay().textContent ?? '',
    };
  }

  async function settle(fixture: ComponentFixture<BudgetList>) {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function clickButton(fixture: ComponentFixture<BudgetList>, label: string) {
    const button = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button')
    ).find((element) => (element.textContent ?? '').includes(label));
    if (!button) {
      throw new Error(`No button labelled "${label}"`);
    }
    button.click();
    fixture.detectChanges();
  }

  function overlayButton(label: string): HTMLButtonElement {
    const button = Array.from(overlay().querySelectorAll('button')).find(
      (element) => (element.textContent ?? '').includes(label)
    );
    if (!button) {
      throw new Error(`No overlay button labelled "${label}"`);
    }
    return button;
  }

  function typeInto(selector: string, value: string) {
    const input = overlay().querySelector<HTMLInputElement>(selector);
    if (!input) {
      throw new Error(`No overlay input matching "${selector}"`);
    }
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  async function pickOption(
    fixture: ComponentFixture<BudgetList>,
    selectSelector: string,
    optionText: string
  ) {
    overlay().querySelector<HTMLElement>(selectSelector)!.click();
    await settle(fixture);
    const option = Array.from(
      overlay().querySelectorAll<HTMLElement>('mat-option')
    ).find((element) => (element.textContent ?? '').trim() === optionText);
    if (!option) {
      throw new Error(`No option "${optionText}"`);
    }
    option.click();
    await settle(fixture);
  }

  it('shows that it is working while the load is in flight, then the list', async () => {
    const pending = new Subject<BudgetWithSpend[]>();
    const { fixture, text } = setup(() => pending.asObservable());

    expect(text()).toContain('Loading your budgets…');

    pending.next([GROCERIES]);
    pending.complete();
    await settle(fixture);

    expect(text()).not.toContain('Loading your budgets…');
    expect(text()).toContain('Groceries');
  });

  it('groups Budgets as Live, Not yet started, Finished — in that order — and by name within a group', () => {
    const { text } = setup(() =>
      of([SUMMER, HOLIDAYS, TRANSPORT, GROCERIES])
    );

    const body = text();
    expect(body).toContain('Live');
    expect(body).toContain('Not yet started');
    expect(body).toContain('Finished');

    // Section order.
    expect(body.indexOf('Live')).toBeLessThan(body.indexOf('Not yet started'));
    expect(body.indexOf('Not yet started')).toBeLessThan(
      body.indexOf('Finished')
    );

    // Within Live: "Groceries" before "Transport".
    expect(body.indexOf('Groceries')).toBeLessThan(body.indexOf('Transport'));
    // Cross-group placement.
    expect(body.indexOf('Transport')).toBeLessThan(body.indexOf('Holidays'));
    expect(body.indexOf('Holidays')).toBeLessThan(body.indexOf('Summer trip'));
  });

  it('shows only the groups that have Budgets', () => {
    const { text } = setup(() => of([GROCERIES]));

    expect(text()).toContain('Live');
    expect(text()).not.toContain('Not yet started');
    expect(text()).not.toContain('Finished');
  });

  it('shows a row with the name, ceiling, Period, Category name and start date', () => {
    const { text } = setup(() => of([GROCERIES]));

    const body = text();
    expect(body).toContain('Groceries');
    expect(body).toContain(formatPeso(20000));
    expect(body).toContain('Monthly');
    expect(body).toContain('Food');
    expect(body).toContain('Starts');
    expect(body).toContain('2026');
  });

  it('reads a Budget with no Category as "All spending"', () => {
    const { text } = setup(() => of([TRANSPORT]));

    expect(text()).toContain('All spending');
  });

  it('shows a live Budget spent against its ceiling, and what is left', () => {
    const { text } = setup(() => of([GROCERIES]));

    const body = text();
    expect(body).toContain(`${formatPeso(12400)} of ${formatPeso(20000)}`);
    expect(body).toContain(`${formatPeso(7600)} left`);
  });

  it('spells out the Cycle the Spent figure covers', () => {
    const { text } = setup(() => of([GROCERIES]));

    // cycleStart 1 Aug 2026, cycleEnd 31 Aug 2026.
    expect(text()).toContain('1 Aug');
    expect(text()).toContain('31 Aug 2026');
  });

  it('shows an overspent Budget by how much it is over — not clamped, and not "left"', () => {
    const { text } = setup(() => of([TRANSPORT]));

    const body = text();
    // amountSpent 3200 against a 3000 ceiling.
    expect(body).toContain(`${formatPeso(200)} over`);
    expect(body).not.toContain('left');
  });

  it('marks the overspend with the semantic expense token, but it reads without colour', () => {
    const { fixture } = setup(() => of([TRANSPORT]));

    const over = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('span')
    ).find((el) => (el.textContent ?? '').includes('over'));
    expect(over).toBeTruthy();
    // Colour is carried by the token, and the word "over" carries it too.
    expect(over!.className).toContain('text-expense');
    expect(over!.textContent).toContain('over');
  });

  it('tells a not-yet-started Budget when it starts, not "₱0 spent"', () => {
    const { text } = setup(() => of([HOLIDAYS]));

    const body = text();
    expect(body).toContain('Starts');
    expect(body).not.toContain(formatPeso(0));
    expect(body).not.toContain('left');
    // No spend block at all until it is live — not even the Cycle window.
    expect(body.toLowerCase()).not.toContain('cycle');
  });

  it('renders a finished Budget as history — final Cycle total, and "under" not "left"', () => {
    const { text } = setup(() => of([SUMMER]));

    const body = text();
    expect(body).toContain('Final cycle');
    expect(body).toContain(`${formatPeso(38000)} of ${formatPeso(40000)}`);
    // Framed as history: nothing more can be spent against it, so "under" the
    // ceiling rather than "left" to spend — but the figure is still there, so
    // the person does not have to subtract.
    expect(body).toContain(`${formatPeso(2000)} under`);
    expect(body).not.toContain(`${formatPeso(2000)} left`);
  });

  it('tells a Profile with no Budgets what a Budget is for', () => {
    const { text } = setup(() => of([]));

    expect(text()).toContain('No budgets yet');
    expect(text().toLowerCase()).toContain('ceiling');
  });

  it('explains a failed load and retries from the top when asked', async () => {
    let attempt = 0;
    const list = vi.fn(() => {
      attempt += 1;
      return attempt === 1
        ? throwError(
            () =>
              new ApiError(
                'Could not reach the server. Check your connection and try again.',
                0
              )
          )
        : of([GROCERIES]);
    });
    const { fixture, text } = setup(list as unknown as BudgetsService['list']);

    expect(text()).toContain('Could not reach the server.');

    clickButton(fixture, 'Try again');
    await settle(fixture);

    expect(list).toHaveBeenCalledTimes(2);
    expect(text()).not.toContain('Could not reach the server.');
    expect(text()).toContain('Groceries');
  });

  it('falls back to a plain message when the failure is not an ApiError', () => {
    const { text } = setup(() => throwError(() => new Error('boom')));

    expect(text()).toContain(
      'Something went wrong loading your budgets. Please try again.'
    );
  });

  describe('create, in a dialog', () => {
    async function openDialog(fixture: ComponentFixture<BudgetList>) {
      clickButton(fixture, 'New budget');
      await settle(fixture);
    }

    /** Fill and submit the new-budget form the dialog renders. */
    async function submitNewBudget(fixture: ComponentFixture<BudgetList>) {
      typeInto('#budget-name', 'Dining out');
      typeInto('#budget-amount', '8000');
      await pickOption(fixture, 'mat-select', 'Monthly');
      // Category left as the default "All spending".
      overlayButton('Create budget').click();
      await settle(fixture);
    }

    it('opens the new-budget form in a dialog, without reflowing the list', async () => {
      const { fixture, text, dialog, dialogText } = setup(() => of([GROCERIES]));
      const before = text();

      await openDialog(fixture);

      expect(dialog()).not.toBeNull();
      expect(dialogText()).toContain('New budget');
      expect(dialogText()).toContain('Name');
      expect(dialogText()).toContain('Period');
      expect(text()).toContain(before);
    });

    it('opens the same dialog from the empty state', async () => {
      const { fixture, dialog, dialogText } = setup(() => of([]));

      await openDialog(fixture);

      expect(dialog()).not.toBeNull();
      expect(dialogText()).toContain('New budget');
    });

    it('dismisses on Cancel without calling the service', async () => {
      const create = vi.fn();
      const { fixture, dialog } = setup(() => of([GROCERIES]), {
        create: create as unknown as BudgetsService['create'],
      });

      await openDialog(fixture);
      overlayButton('Cancel').click();
      await settle(fixture);

      expect(dialog()).toBeNull();
      expect(create).not.toHaveBeenCalled();
    });

    it('closes on Escape', async () => {
      const { fixture, dialog } = setup(() => of([GROCERIES]));

      await openDialog(fixture);
      pressEscape();
      await settle(fixture);

      expect(dialog()).toBeNull();
    });

    it('on a successful create, closes the dialog, then re-reads so the Budget lands with its Cycle figures (ADR 0006)', async () => {
      let attempt = 0;
      // The write endpoint hands back the bare Budget…
      const createdBare: Budget = {
        id: 9,
        name: 'Dining out',
        amountLimit: 8000,
        period: 'monthly',
        startDate: new Date(2026, 7, 1),
        endDate: null,
        categoryId: null,
      };
      // …and only the re-read carries the Spent figure and Cycle window.
      const createdRow: BudgetWithSpend = {
        ...createdBare,
        amountSpent: 0,
        cycleStart: new Date(2026, 7, 1),
        cycleEnd: new Date(2026, 7, 31),
      };
      const list = vi.fn(() => {
        attempt += 1;
        return attempt === 1 ? of([GROCERIES]) : of([GROCERIES, createdRow]);
      });
      const create = vi.fn(() => of(createdBare));
      const { fixture, text, dialog } = setup(
        list as unknown as BudgetsService['list'],
        { create: create as unknown as BudgetsService['create'] }
      );

      await openDialog(fixture);
      await submitNewBudget(fixture);

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Dining out',
          amountLimit: 8000,
          period: 'monthly',
          categoryId: null,
        })
      );
      expect(dialog()).toBeNull();
      expect(text()).toContain('Dining out');
      expect(list).toHaveBeenCalledTimes(2);
    });

    it('on a failed create, keeps the dialog open with the reason shown', async () => {
      const create = vi.fn(() => throwError(() => new Error('offline')));
      const { fixture, dialog, dialogText } = setup(() => of([GROCERIES]), {
        create: create as unknown as BudgetsService['create'],
      });

      await openDialog(fixture);
      await submitNewBudget(fixture);

      expect(dialog()).not.toBeNull();
      expect(dialogText()).toContain('Something went wrong creating your budget');
    });
  });

  /** Open the row's actions menu and click one of its items. */
  async function openRowAction(
    fixture: ComponentFixture<BudgetList>,
    item: string
  ) {
    const trigger = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      'button[aria-label="Budget actions"]'
    );
    if (!trigger) {
      throw new Error('No row actions menu');
    }
    trigger.click();
    await settle(fixture);

    const menuItem = Array.from(overlay().querySelectorAll('button')).find(
      (element) => (element.textContent ?? '').trim() === item
    );
    if (!menuItem) {
      throw new Error(`No menu item "${item}"`);
    }
    menuItem.click();
    await settle(fixture);
  }

  describe('adjust, in a dialog', () => {
    it('opens the adjust form prefilled from the row, without reflowing the list', async () => {
      const { fixture, text, dialog, dialogText } = setup(() => of([GROCERIES]));
      const before = text();

      await openRowAction(fixture, 'Adjust');

      expect(dialog()).not.toBeNull();
      expect(dialogText()).toContain('Adjust budget');
      expect(
        overlay().querySelector<HTMLInputElement>('#budget-name')!.value
      ).toBe('Groceries');
      expect(text()).toContain(before);
    });

    it('dismisses on Cancel without calling the service', async () => {
      const adjust = vi.fn();
      const { fixture, dialog } = setup(() => of([GROCERIES]), {
        adjust: adjust as unknown as BudgetsService['adjust'],
      });

      await openRowAction(fixture, 'Adjust');
      overlayButton('Cancel').click();
      await settle(fixture);

      expect(dialog()).toBeNull();
      expect(adjust).not.toHaveBeenCalled();
    });

    it('on a successful adjust, closes the dialog then re-reads so the row lands with its new Cycle figures (ADR 0006)', async () => {
      const adjustedBare: Budget = {
        id: 1,
        name: 'Groceries',
        amountLimit: 30000,
        period: 'monthly',
        startDate: new Date(2026, 0, 1),
        endDate: null,
        categoryId: 10,
      };
      const adjustedRow: BudgetWithSpend = {
        ...adjustedBare,
        amountSpent: 12400,
        cycleStart: new Date(2026, 7, 1),
        cycleEnd: new Date(2026, 7, 31),
      };
      let attempt = 0;
      const list = vi.fn(() => {
        attempt += 1;
        return attempt === 1 ? of([GROCERIES]) : of([adjustedRow]);
      });
      const adjust = vi.fn(() => of(adjustedBare));
      const { fixture, text, dialog } = setup(
        list as unknown as BudgetsService['list'],
        { adjust: adjust as unknown as BudgetsService['adjust'] }
      );

      await openRowAction(fixture, 'Adjust');
      typeInto('#budget-amount', '30000');
      overlayButton('Save changes').click();
      await settle(fixture);

      expect(adjust).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ amountLimit: 30000 })
      );
      expect(dialog()).toBeNull();
      expect(list).toHaveBeenCalledTimes(2);
      expect(text()).toContain(`${formatPeso(30000)}`);
    });

    it('on a failed adjust, keeps the dialog open with the reason shown', async () => {
      const adjust = vi.fn(() => throwError(() => new Error('offline')));
      const { fixture, dialog, dialogText } = setup(() => of([GROCERIES]), {
        adjust: adjust as unknown as BudgetsService['adjust'],
      });

      await openRowAction(fixture, 'Adjust');
      typeInto('#budget-amount', '30000');
      overlayButton('Save changes').click();
      await settle(fixture);

      expect(dialog()).not.toBeNull();
      expect(dialogText()).toContain(
        'Something went wrong adjusting your budget'
      );
    });
  });

  describe('remove, behind a confirm', () => {
    it('asks before removing and does not call the service until confirmed', async () => {
      const remove = vi.fn(() => of(undefined));
      const { fixture, text } = setup(() => of([GROCERIES]), {
        remove: remove as unknown as BudgetsService['remove'],
      });

      await openRowAction(fixture, 'Remove');

      expect(text()).toContain('gone for good');
      expect(remove).not.toHaveBeenCalled();
    });

    it('says the Budget is gone for good, not archived', async () => {
      const { fixture, text } = setup(() => of([GROCERIES]));

      await openRowAction(fixture, 'Remove');

      expect(text().toLowerCase()).toContain("aren’t archived".toLowerCase());
    });

    it('backs out on Cancel without calling the service', async () => {
      const remove = vi.fn(() => of(undefined));
      const { fixture, text } = setup(() => of([GROCERIES]), {
        remove: remove as unknown as BudgetsService['remove'],
      });

      await openRowAction(fixture, 'Remove');
      clickButton(fixture, 'Cancel');
      await settle(fixture);

      expect(text()).not.toContain('gone for good');
      expect(remove).not.toHaveBeenCalled();
    });

    it('removes on confirm, then re-reads the list (ADR 0006)', async () => {
      const remove = vi.fn(() => of(undefined));
      let attempt = 0;
      const list = vi.fn(() => {
        attempt += 1;
        return attempt === 1 ? of([GROCERIES, HOLIDAYS]) : of([HOLIDAYS]);
      });
      const { fixture, text } = setup(
        list as unknown as BudgetsService['list'],
        { remove: remove as unknown as BudgetsService['remove'] }
      );

      await openRowAction(fixture, 'Remove');
      clickButton(fixture, 'Remove');
      await settle(fixture);

      expect(remove).toHaveBeenCalledWith(1);
      expect(list).toHaveBeenCalledTimes(2);
      expect(text()).not.toContain('Groceries');
      expect(text()).toContain('Holidays');
    });

    it('pins the row a notice with a retry when the removal fails', async () => {
      let attempt = 0;
      const remove = vi.fn(() => {
        attempt += 1;
        return attempt === 1
          ? throwError(() => new ApiError('The server did not accept that.', 500))
          : of(undefined);
      });
      const { fixture, text } = setup(() => of([GROCERIES]), {
        remove: remove as unknown as BudgetsService['remove'],
      });

      await openRowAction(fixture, 'Remove');
      clickButton(fixture, 'Remove');
      await settle(fixture);

      expect(text()).toContain('The server did not accept that.');

      clickButton(fixture, 'Try again');
      await settle(fixture);

      expect(remove).toHaveBeenCalledTimes(2);
    });
  });
});
