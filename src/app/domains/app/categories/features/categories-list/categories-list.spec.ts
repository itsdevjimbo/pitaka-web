import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { provideDialogDefaults } from '@/app/core/dialog';
import { provideIcons } from '@/app/core/icons';
import { withOverlayContainer } from '@/testing/overlay';
import { CategoriesService } from '../../data/categories.service';
import { Category } from '../../data/category';
import { CategoryInUseError } from '../../data/category-errors';
import CategoriesList from './categories-list';

const cat = (over: Partial<Category> & Pick<Category, 'id' | 'name'>): Category => ({
  kind: 'expense',
  isActive: true,
  isDefault: false,
  ...over,
});

const GROCERIES = cat({ id: 1, name: 'Groceries' });
const RENT = cat({ id: 2, name: 'Rent' });
const DINING = cat({ id: 3, name: 'Dining out', isDefault: true });
const MOTORING = cat({ id: 4, name: 'Motoring', isActive: false });
const SALARY = cat({ id: 10, name: 'Salary', kind: 'income' });
const GIFTS = cat({ id: 11, name: 'Gifts', kind: 'income' });

const EVERYTHING = [GROCERIES, RENT, DINING, MOTORING, SALARY, GIFTS];

type Service = Partial<CategoriesService>;

describe('CategoriesList', () => {
  const overlay = withOverlayContainer();

  function setup(readAll: CategoriesService['readAll'], overrides: Service = {}) {
    TestBed.configureTestingModule({
      imports: [CategoriesList],
      providers: [
        provideIcons(),
        provideRouter([]),
        provideDialogDefaults(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        { provide: CategoriesService, useValue: { readAll, ...overrides } },
      ],
    });

    const fixture = TestBed.createComponent(CategoriesList);
    fixture.detectChanges();

    return {
      fixture,
      text: () => (fixture.nativeElement as HTMLElement).textContent ?? '',
      overlayText: () => overlay().textContent ?? '',
      pane: (heading: string) => paneFor(fixture, heading),
    };
  }

  /** The pane section element whose heading is `Expense` or `Income`. */
  function paneFor(fixture: ComponentFixture<CategoriesList>, heading: string) {
    const section = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('section')
    ).find((el) => el.querySelector('h2')?.textContent?.trim() === heading);
    if (!section) {
      throw new Error(`No pane headed "${heading}"`);
    }
    return {
      el: section,
      text: () => section.textContent ?? '',
      button: (label: string) =>
        Array.from(section.querySelectorAll('button')).find((b) =>
          (b.textContent ?? '').includes(label)
        ),
      actionsFor: (name: string) =>
        section.querySelector<HTMLButtonElement>(
          `button[aria-label="Actions for ${name}"]`
        ),
      switchTo: (label: 'Active' | 'Retired' | 'All') => {
        const b = Array.from(section.querySelectorAll('button')).find(
          (el) => (el.textContent ?? '').trim() === label
        );
        if (!b) {
          throw new Error(`No "${label}" switch in the ${heading} pane`);
        }
        b.click();
        fixture.detectChanges();
      },
      search: (value: string) => {
        const input = section.querySelector<HTMLInputElement>(
          'input[type="search"]'
        )!;
        input.value = value;
        input.dispatchEvent(new Event('input'));
        fixture.detectChanges();
      },
    };
  }

  async function settle(fixture: ComponentFixture<CategoriesList>) {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function overlayButton(label: string): HTMLButtonElement {
    const button = Array.from(overlay().querySelectorAll('button')).find((el) =>
      (el.textContent ?? '').includes(label)
    );
    if (!button) {
      throw new Error(`No overlay button labelled "${label}"`);
    }
    return button;
  }

  async function openRowMenu(
    fixture: ComponentFixture<CategoriesList>,
    pane: ReturnType<typeof paneFor>,
    name: string
  ) {
    pane.actionsFor(name)!.click();
    await settle(fixture);
  }

  it('renders an Expense pane and an Income pane, each with its own switch-scoped count', () => {
    const { pane } = setup(() => of(EVERYTHING));

    // Expense active: Dining out, Groceries, Rent — Motoring is retired.
    expect(pane('Expense').text()).toContain('Groceries');
    expect(pane('Expense').text()).toContain('Rent');
    expect(pane('Expense').text()).not.toContain('Motoring');
    expect(
      pane('Expense').el.querySelector('header span')?.textContent?.trim()
    ).toBe('3');

    expect(pane('Income').text()).toContain('Salary');
    expect(pane('Income').text()).toContain('Gifts');
    expect(
      pane('Income').el.querySelector('header span')?.textContent?.trim()
    ).toBe('2');
  });

  it('orders rows alphabetically with retired sunk to the bottom', () => {
    const { pane } = setup(() => of(EVERYTHING));

    pane('Expense').switchTo('All');
    const names = Array.from(
      pane('Expense').el.querySelectorAll('li .font-medium')
    ).map((el) => el.textContent?.trim());

    expect(names).toEqual(['Dining out', 'Groceries', 'Rent', 'Motoring']);
  });

  it('switches between Active, Retired and All', () => {
    const { pane } = setup(() => of(EVERYTHING));

    pane('Expense').switchTo('Retired');
    expect(pane('Expense').text()).toContain('Motoring');
    expect(pane('Expense').text()).not.toContain('Groceries');

    pane('Expense').switchTo('All');
    expect(pane('Expense').text()).toContain('Motoring');
    expect(pane('Expense').text()).toContain('Groceries');
  });

  it('narrows one pane with its search without touching the other', () => {
    const { pane } = setup(() => of(EVERYTHING));

    pane('Expense').search('rent');

    expect(pane('Expense').text()).toContain('Rent');
    expect(pane('Expense').text()).not.toContain('Groceries');
    // Income pane is untouched.
    expect(pane('Income').text()).toContain('Salary');
    expect(pane('Income').text()).toContain('Gifts');
  });

  it('tells a filter-empty search from an empty Retired segment', () => {
    const { pane } = setup(() => of(EVERYTHING));

    pane('Expense').search('zzz');
    expect(pane('Expense').text()).toContain('No categories match “zzz”');

    pane('Expense').search('');
    pane('Income').switchTo('Retired');
    expect(pane('Income').text()).toContain('Nothing retired yet');
    expect(pane('Income').text()).not.toContain('No categories match');
  });

  it('clears the search from the filter-empty state', () => {
    const { fixture, pane } = setup(() => of(EVERYTHING));

    pane('Expense').search('zzz');
    pane('Expense').button('Clear search')!.click();
    fixture.detectChanges();

    expect(pane('Expense').text()).toContain('Groceries');
    expect(pane('Expense').text()).not.toContain('No categories match');
  });

  it('badges a supplied Category and gives it no action menu', () => {
    const { pane } = setup(() => of(EVERYTHING));

    expect(pane('Expense').text()).toContain('Default');
    expect(pane('Expense').actionsFor('Dining out')).toBeNull();
    // A person's own row has a real, focusable trigger sitting in the row.
    const trigger = pane('Expense').actionsFor('Groceries');
    expect(trigger).not.toBeNull();
    expect(trigger!.tagName).toBe('BUTTON');
  });

  it('explains a failed load and retries the whole read', async () => {
    let attempt = 0;
    const readAll = vi.fn(() => {
      attempt += 1;
      return attempt === 1
        ? throwError(() => new ApiError('Could not reach the server.', 0))
        : of(EVERYTHING);
    });
    const { fixture, text } = setup(
      readAll as unknown as CategoriesService['readAll']
    );

    expect(text()).toContain('Could not reach the server.');
    expect(text()).not.toContain('Expense');

    Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button')
    )
      .find((b) => (b.textContent ?? '').includes('Try again'))!
      .click();
    await settle(fixture);

    expect(readAll).toHaveBeenCalledTimes(2);
    expect(text()).toContain('Groceries');
  });

  it('creates through the add field with the pane’s kind, then re-reads', async () => {
    const created = cat({ id: 20, name: 'Holidays' });
    let attempt = 0;
    const readAll = vi.fn(() => {
      attempt += 1;
      return attempt === 1 ? of(EVERYTHING) : of([...EVERYTHING, created]);
    });
    const create = vi.fn(() => of(created));
    const { fixture, pane } = setup(
      readAll as unknown as CategoriesService['readAll'],
      { create: create as unknown as CategoriesService['create'] }
    );

    const input = pane('Expense').el.querySelector<HTMLInputElement>(
      '#add-expense-category'
    )!;
    input.value = 'Holidays';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    pane('Expense')
      .el.querySelector<HTMLButtonElement>(
        'button[aria-label="Add expense category"]'
      )!
      .click();
    await settle(fixture);

    expect(create).toHaveBeenCalledWith({ name: 'Holidays', kind: 'expense' });
    expect(readAll).toHaveBeenCalledTimes(2);
    expect(pane('Expense').text()).toContain('Holidays');
  });

  it('retires directly with no confirmation and acknowledges the move inline', async () => {
    const setActive = vi.fn(() => of({ ...GROCERIES, isActive: false }));
    let attempt = 0;
    const readAll = vi.fn(() => {
      attempt += 1;
      return attempt === 1
        ? of(EVERYTHING)
        : of([
            { ...GROCERIES, isActive: false },
            RENT,
            DINING,
            MOTORING,
            SALARY,
            GIFTS,
          ]);
    });
    const { fixture, pane } = setup(
      readAll as unknown as CategoriesService['readAll'],
      { setActive: setActive as unknown as CategoriesService['setActive'] }
    );

    await openRowMenu(fixture, pane('Expense'), 'Groceries');
    overlayButton('Retire').click();
    await settle(fixture);

    expect(setActive).toHaveBeenCalledWith(1, false);
    expect(readAll).toHaveBeenCalledTimes(2);
    expect(pane('Expense').text()).toContain('Groceries retired');
    // The switch the person set is not flipped for them.
    expect(pane('Expense').text()).not.toContain('Motoring');
  });

  it('keeps the rows and offers an inline retry when the re-read after a write fails', async () => {
    const setActive = vi.fn(() => of({ ...GROCERIES, isActive: false }));
    let attempt = 0;
    const readAll = vi.fn(() => {
      attempt += 1;
      return attempt === 1
        ? of(EVERYTHING)
        : throwError(() => new ApiError('Server error', 500));
    });
    const { fixture, pane, text } = setup(
      readAll as unknown as CategoriesService['readAll'],
      { setActive: setActive as unknown as CategoriesService['setActive'] }
    );

    await openRowMenu(fixture, pane('Expense'), 'Rent');
    overlayButton('Retire').click();
    await settle(fixture);

    expect(text()).toContain('Your change was saved');
    expect(text()).toContain('Rent');
  });

  it('asks on the row before deleting and does not call the service until confirmed', async () => {
    const remove = vi.fn(() => of(undefined));
    const { fixture, pane } = setup(() => of(EVERYTHING), {
      remove: remove as unknown as CategoriesService['remove'],
    });

    await openRowMenu(fixture, pane('Expense'), 'Rent');
    overlayButton('Delete').click();
    await settle(fixture);

    expect(pane('Expense').text()).toContain('This can’t be undone');
    expect(remove).not.toHaveBeenCalled();

    pane('Expense').button('Delete')!.click();
    fixture.detectChanges();
    expect(remove).toHaveBeenCalledWith(2);
  });

  it('offers Retire as the way out when a delete is refused for an in-use active Category', async () => {
    const remove = vi.fn(() =>
      throwError(
        () =>
          new CategoryInUseError('This category is in use and cannot be deleted.')
      )
    );
    const { fixture, pane } = setup(() => of(EVERYTHING), {
      remove: remove as unknown as CategoriesService['remove'],
    });

    await openRowMenu(fixture, pane('Expense'), 'Rent');
    overlayButton('Delete').click();
    await settle(fixture);
    pane('Expense').button('Delete')!.click();
    await settle(fixture);

    expect(pane('Expense').text()).toContain(
      'Something still uses this category'
    );
    expect(pane('Expense').text()).toContain('Retire instead');
  });

  it('gives a refused delete on an already-retired Category the message alone, no button', async () => {
    const remove = vi.fn(() =>
      throwError(
        () =>
          new CategoryInUseError('This category is in use and cannot be deleted.')
      )
    );
    const { fixture, pane } = setup(() => of(EVERYTHING), {
      remove: remove as unknown as CategoriesService['remove'],
    });

    pane('Expense').switchTo('Retired');
    await openRowMenu(fixture, pane('Expense'), 'Motoring');
    overlayButton('Delete').click();
    await settle(fixture);
    pane('Expense').button('Delete')!.click();
    await settle(fixture);

    expect(pane('Expense').text()).toContain(
      'Something still uses this category'
    );
    expect(pane('Expense').text()).not.toContain('Retire instead');
  });

  describe('rename, in a dialog', () => {
    it('opens a dialog whose title states the kind, with no kind control', async () => {
      const { fixture, pane, overlayText } = setup(() => of(EVERYTHING));

      await openRowMenu(fixture, pane('Expense'), 'Groceries');
      overlayButton('Rename').click();
      await settle(fixture);

      expect(overlayText()).toContain('Rename expense category');
      expect(overlayText()).not.toContain('Kind');
      expect(
        overlay().querySelector<HTMLInputElement>('#rename-category-name')!.value
      ).toBe('Groceries');
    });

    it('shows a duplicate name its cross-kind message and keeps the dialog open', async () => {
      const rename = vi.fn(() =>
        throwError(
          () =>
            new ApiError('A category with this name already exists.', 409, {
              name: ['A category with this name already exists.'],
            })
        )
      );
      const { fixture, pane, overlayText } = setup(() => of(EVERYTHING), {
        rename: rename as unknown as CategoriesService['rename'],
      });

      await openRowMenu(fixture, pane('Expense'), 'Groceries');
      overlayButton('Rename').click();
      await settle(fixture);
      const input = overlay().querySelector<HTMLInputElement>(
        '#rename-category-name'
      )!;
      input.value = 'Gifts';
      input.dispatchEvent(new Event('input'));
      overlayButton('Save').click();
      await settle(fixture);

      expect(overlay().querySelector('[role="dialog"]')).not.toBeNull();
      expect(overlayText()).toContain(
        'You already have a category called “Gifts”'
      );
    });

    it('re-reads the list on a successful rename', async () => {
      let attempt = 0;
      const readAll = vi.fn(() => {
        attempt += 1;
        return attempt === 1
          ? of(EVERYTHING)
          : of([{ ...GROCERIES, name: 'Food' }, RENT, DINING, MOTORING, SALARY, GIFTS]);
      });
      const rename = vi.fn(() => of({ ...GROCERIES, name: 'Food' }));
      const { fixture, pane } = setup(
        readAll as unknown as CategoriesService['readAll'],
        { rename: rename as unknown as CategoriesService['rename'] }
      );

      await openRowMenu(fixture, pane('Expense'), 'Groceries');
      overlayButton('Rename').click();
      await settle(fixture);
      const input = overlay().querySelector<HTMLInputElement>(
        '#rename-category-name'
      )!;
      input.value = 'Food';
      input.dispatchEvent(new Event('input'));
      overlayButton('Save').click();
      await settle(fixture);

      expect(rename).toHaveBeenCalledWith(1, 'Food');
      expect(readAll).toHaveBeenCalledTimes(2);
      expect(pane('Expense').text()).toContain('Food');
      expect(pane('Expense').text()).not.toContain('Groceries');
    });
  });

  it('has no whole-screen empty state — an empty read still shows the panes', () => {
    const { text, pane } = setup(() => of([]));

    expect(text()).not.toContain('No categories yet');
    expect(pane('Expense').el).not.toBeNull();
    expect(pane('Income').el).not.toBeNull();
  });

  it('opens with each pane on Active and an empty search — no filter is carried across entries', () => {
    const { pane } = setup(() => of(EVERYTHING));

    for (const heading of ['Expense', 'Income']) {
      const el = pane(heading).el;
      expect(
        el.querySelector<HTMLInputElement>('input[type="search"]')!.value
      ).toBe('');
      const active = Array.from(el.querySelectorAll('button')).find(
        (b) => (b.textContent ?? '').trim() === 'Active'
      )!;
      expect(active.getAttribute('aria-pressed')).toBe('true');
    }
  });
});
