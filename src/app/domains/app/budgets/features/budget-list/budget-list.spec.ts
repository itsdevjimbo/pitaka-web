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
import { Budget } from '../../data/budget';
import { BudgetsService } from '../../data/budgets.service';
import BudgetList from './budget-list';

/** A live monthly Budget on Groceries. */
const GROCERIES: Budget = {
  id: 1,
  name: 'Groceries',
  amountLimit: 20000,
  period: 'monthly',
  startDate: new Date(2026, 0, 1),
  endDate: null,
  categoryId: 10,
};

/** A live weekly Budget over all spending — sorts after "Groceries" by name. */
const TRANSPORT: Budget = {
  id: 2,
  name: 'Transport',
  amountLimit: 3000,
  period: 'weekly',
  startDate: new Date(2026, 5, 1),
  endDate: null,
  categoryId: null,
};

/** Starts next month — not yet started as of the pinned "today". */
const HOLIDAYS: Budget = {
  id: 3,
  name: 'Holidays',
  amountLimit: 50000,
  period: 'yearly',
  startDate: new Date(2026, 11, 1),
  endDate: null,
  categoryId: 10,
};

/** Ended in the past — finished. */
const SUMMER: Budget = {
  id: 4,
  name: 'Summer trip',
  amountLimit: 40000,
  period: 'monthly',
  startDate: new Date(2026, 3, 1),
  endDate: new Date(2026, 6, 31),
  categoryId: 10,
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
          useValue: { list, create: overrides.create ?? (() => of(GROCERIES)) },
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
    const pending = new Subject<Budget[]>();
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
    expect(body).toContain('2026');
  });

  it('reads a Budget with no Category as "All spending"', () => {
    const { text } = setup(() => of([TRANSPORT]));

    expect(text()).toContain('All spending');
  });

  it('does not render a Cycle window or a progress bar', () => {
    const { fixture, text } = setup(() => of([GROCERIES]));

    expect(text().toLowerCase()).not.toContain('cycle');
    expect(text()).not.toContain('Spent');
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('progress')
    ).toBeNull();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[role="progressbar"]')
    ).toBeNull();
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

    it('on a successful create, closes the dialog, shows the Budget, then re-reads (ADR 0006)', async () => {
      let attempt = 0;
      const created: Budget = {
        id: 9,
        name: 'Dining out',
        amountLimit: 8000,
        period: 'monthly',
        startDate: new Date(2026, 7, 1),
        endDate: null,
        categoryId: null,
      };
      const list = vi.fn(() => {
        attempt += 1;
        return attempt === 1 ? of([GROCERIES]) : of([GROCERIES, created]);
      });
      const create = vi.fn(() => of(created));
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
});
