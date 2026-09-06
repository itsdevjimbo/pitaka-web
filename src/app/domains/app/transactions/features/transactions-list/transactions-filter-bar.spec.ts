import { ModelSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  MATERIAL_ANIMATIONS,
  provideNativeDateAdapter,
} from '@angular/material/core';
import { provideIcons } from '@/app/core/icons';
import { Media } from '@/app/core/media';
import { FakeMedia, provideFakeMedia } from '@/testing/media';
import { withOverlayContainer } from '@/testing/overlay';
import { TransactionCriteria } from '../../data/transaction';
import {
  FilterAccountOption,
  FilterCategoryOption,
  NOTE_DEBOUNCE_MS,
  TransactionsFilterBar,
} from './transactions-filter-bar';

/** The slice of the component the tests drive — the same controls the template calls. */
type FilterBarInternals = {
  criteria: ModelSignal<TransactionCriteria>;
  activeCount: () => number;
  onNoteInput(value: string): void;
  setDirection(value: string | null): void;
  setAccount(value: number | null): void;
  setCategory(value: number | null): void;
  setDateFrom(value: Date | null): void;
  setDateTo(value: Date | null): void;
  clear(): void;
};

const ACCOUNTS: FilterAccountOption[] = [
  { id: 3, name: 'Everyday cash', retired: false },
  { id: 9, name: 'Old wallet', retired: true },
];

const CATEGORIES: FilterCategoryOption[] = [
  { id: 1, name: 'Groceries' },
  { id: 2, name: 'Salary' },
];

describe('TransactionsFilterBar', () => {
  const overlay = withOverlayContainer();

  function setup(
    criteria: TransactionCriteria = {},
    { phone = false }: { phone?: boolean } = {}
  ) {
    TestBed.configureTestingModule({
      imports: [TransactionsFilterBar],
      providers: [
        provideIcons(),
        provideNativeDateAdapter(),
        provideFakeMedia(phone),
        {
          provide: MATERIAL_ANIMATIONS,
          useValue: { animationsDisabled: true },
        },
      ],
    });

    const media = TestBed.inject(Media) as unknown as FakeMedia;

    const fixture = TestBed.createComponent(TransactionsFilterBar);
    fixture.componentRef.setInput('accounts', ACCOUNTS);
    fixture.componentRef.setInput('categories', CATEGORIES);
    fixture.componentRef.setInput('criteria', criteria);
    fixture.detectChanges();

    const cmp = fixture.componentInstance as unknown as FilterBarInternals;
    const emitted: TransactionCriteria[] = [];
    cmp.criteria.subscribe((next) => emitted.push(next));

    const host = fixture.nativeElement as HTMLElement;
    const qs = <T extends Element>(selector: string) =>
      host.querySelector<T>(selector);

    /** Open one select by its aria-label and read the option labels from the overlay. */
    async function optionsOf(ariaLabel: string) {
      const trigger = qs<HTMLElement>(`mat-select[aria-label="${ariaLabel}"]`);
      trigger!.click();
      fixture.detectChanges();
      await fixture.whenStable();
      return Array.from(overlay().querySelectorAll('mat-option')).map((o) =>
        (o.textContent ?? '').replace(/\s+/g, ' ').trim()
      );
    }

    /** The phone-width disclosure toggle — the button that owns the controls panel. */
    const disclosure = () =>
      qs<HTMLButtonElement>(
        'button[aria-controls="transactions-filter-controls"]'
      );

    /** The controls panel — kept mounted at every width, `hidden` when collapsed. */
    const controlsPanel = () => qs('#transactions-filter-controls');

    return {
      fixture,
      cmp,
      emitted,
      media,
      optionsOf,
      disclosure,
      controlsPanel,
      /** Whether the controls (everything but the note search) are on show. */
      showsControls: () => {
        const panel = controlsPanel();
        return !!panel && !panel.classList.contains('hidden');
      },
      /** Whether the note search field is in the DOM. */
      showsNote: () => !!qs('input[aria-label="Filter by note"]'),
      text: () => host.textContent ?? '',
    };
  }

  it('offers an Account option per Account, retired ones marked', async () => {
    const { optionsOf } = setup();

    expect(await optionsOf('Filter by account')).toEqual([
      'Any account',
      'Everyday cash',
      'Old wallet · Retired',
    ]);
  });

  it('offers a flat Category option per Category', async () => {
    const { optionsOf } = setup();

    expect(await optionsOf('Filter by category')).toEqual([
      'Any category',
      'Groceries',
      'Salary',
    ]);
  });

  it('offers every direction plus an "Any" reset', async () => {
    const { optionsOf } = setup();

    expect(await optionsOf('Filter by direction')).toEqual([
      'Any direction',
      'Income',
      'Expense',
      'Transfer',
    ]);
  });

  it('folds a chosen direction into the criteria', () => {
    const { cmp, emitted } = setup();

    cmp.setDirection('expense');

    expect(emitted.at(-1)).toEqual({ direction: 'expense' });
  });

  it('combines the three axes, each independently', () => {
    const { cmp, emitted } = setup();

    cmp.setDirection('expense');
    cmp.setAccount(3);
    cmp.setCategory(1);

    expect(emitted.at(-1)).toEqual({
      direction: 'expense',
      accountId: 3,
      categoryId: 1,
    });
  });

  it('drops an axis key entirely when it is set back to "Any", never emitting undefined', () => {
    const { cmp, emitted } = setup({ direction: 'expense', accountId: 3 });

    cmp.setAccount(null);

    const last = emitted.at(-1)!;
    expect(last).toEqual({ direction: 'expense' });
    expect('accountId' in last).toBe(false);
  });

  describe('the note search (#64)', () => {
    // `debounceTime` schedules on `setInterval` and measures elapsed time with
    // `Date.now()`; fake both so the debounce is under the test's control, while
    // zoneless stability (on `setTimeout`) is left alone.
    beforeEach(() =>
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    );
    afterEach(() => vi.useRealTimers());

    it('folds a settled note into the criteria, once for a burst of keystrokes', () => {
      const { cmp, emitted } = setup();

      cmp.onNoteInput('c');
      cmp.onNoteInput('co');
      cmp.onNoteInput('coffee');
      expect(emitted).toEqual([]);

      vi.advanceTimersByTime(NOTE_DEBOUNCE_MS);

      expect(emitted).toEqual([{ description: 'coffee' }]);
    });

    it('trims the note on the way out', () => {
      const { cmp, emitted } = setup();

      cmp.onNoteInput('  flat white  ');
      vi.advanceTimersByTime(NOTE_DEBOUNCE_MS);

      expect(emitted.at(-1)).toEqual({ description: 'flat white' });
    });

    it('drops the key when the field is cleared or only whitespace', () => {
      const { cmp, emitted } = setup({ description: 'coffee', accountId: 3 });

      cmp.onNoteInput('   ');
      vi.advanceTimersByTime(NOTE_DEBOUNCE_MS);

      const last = emitted.at(-1)!;
      expect(last).toEqual({ accountId: 3 });
      expect('description' in last).toBe(false);
    });

    it('combines the note with the single-value axes', () => {
      const { cmp, emitted } = setup({ direction: 'expense' });

      cmp.onNoteInput('rent');
      vi.advanceTimersByTime(NOTE_DEBOUNCE_MS);

      expect(emitted.at(-1)).toEqual({ direction: 'expense', description: 'rent' });
    });

    it('re-narrows on the same term after Clear filters has wiped it', () => {
      const { cmp, emitted } = setup();

      cmp.onNoteInput('coffee');
      vi.advanceTimersByTime(NOTE_DEBOUNCE_MS);
      expect(emitted.at(-1)).toEqual({ description: 'coffee' });

      cmp.clear();
      expect(emitted.at(-1)).toEqual({});

      cmp.onNoteInput('coffee');
      vi.advanceTimersByTime(NOTE_DEBOUNCE_MS);
      expect(emitted.at(-1)).toEqual({ description: 'coffee' });
    });

    it('counts as one active filter, alongside the others', () => {
      const { fixture, cmp } = setup();

      fixture.componentRef.setInput('criteria', { description: 'coffee' });
      fixture.detectChanges();
      expect(cmp.activeCount()).toBe(1);

      fixture.componentRef.setInput('criteria', {
        description: 'coffee',
        direction: 'expense',
      });
      fixture.detectChanges();
      expect(cmp.activeCount()).toBe(2);
    });

    it('reflects an incoming note in the field without re-emitting', () => {
      const { fixture, emitted } = setup({ description: 'coffee' });

      const input = (
        fixture.nativeElement as HTMLElement
      ).querySelector<HTMLInputElement>('input[aria-label="Filter by note"]');
      expect(input!.value).toBe('coffee');
      expect(emitted).toEqual([]);
    });
  });

  describe('the date range (#65)', () => {
    it('folds a picked start and end into the criteria as the chosen calendar days', () => {
      const { cmp, emitted } = setup();

      cmp.setDateFrom(new Date(2026, 8, 1));
      cmp.setDateTo(new Date(2026, 8, 30));

      expect(emitted.at(-1)).toEqual({
        from: new Date(2026, 8, 1),
        to: new Date(2026, 8, 30),
      });
    });

    it('keeps each end independently optional', () => {
      const { cmp, emitted } = setup();

      cmp.setDateFrom(new Date(2026, 8, 1));

      expect(emitted.at(-1)).toEqual({ from: new Date(2026, 8, 1) });
      expect('to' in emitted.at(-1)!).toBe(false);
    });

    it('drops an end key entirely when it is cleared, never emitting undefined', () => {
      const { cmp, emitted } = setup({
        from: new Date(2026, 8, 1),
        to: new Date(2026, 8, 30),
      });

      cmp.setDateFrom(null);

      const last = emitted.at(-1)!;
      expect(last).toEqual({ to: new Date(2026, 8, 30) });
      expect('from' in last).toBe(false);
    });

    it('combines with the single-value axes', () => {
      const { cmp, emitted } = setup({ direction: 'expense', accountId: 3 });

      cmp.setDateFrom(new Date(2026, 8, 1));
      cmp.setDateTo(new Date(2026, 8, 30));

      expect(emitted.at(-1)).toEqual({
        direction: 'expense',
        accountId: 3,
        from: new Date(2026, 8, 1),
        to: new Date(2026, 8, 30),
      });
    });

    it('counts as a single active filter however many ends are set', () => {
      const { fixture, cmp } = setup();

      fixture.componentRef.setInput('criteria', { from: new Date(2026, 8, 1) });
      fixture.detectChanges();
      expect(cmp.activeCount()).toBe(1);

      fixture.componentRef.setInput('criteria', {
        from: new Date(2026, 8, 1),
        to: new Date(2026, 8, 30),
      });
      fixture.detectChanges();
      expect(cmp.activeCount()).toBe(1);
    });
  });

  it('clears every axis in one action', () => {
    const { cmp, emitted } = setup({
      direction: 'income',
      accountId: 9,
      categoryId: 2,
      description: 'coffee',
      from: new Date(2026, 8, 1),
      to: new Date(2026, 8, 30),
    });

    cmp.clear();

    expect(emitted.at(-1)).toEqual({});
  });

  it('summarises how many filters are active, and hides the summary when none are', () => {
    const { fixture, cmp, text } = setup();
    expect(text()).not.toContain('active');
    expect(text()).not.toContain('Clear filters');

    fixture.componentRef.setInput('criteria', { direction: 'expense' });
    fixture.detectChanges();
    expect(cmp.activeCount()).toBe(1);
    expect(text()).toContain('1 filter active');
    expect(text()).toContain('Clear filters');

    fixture.componentRef.setInput('criteria', {
      direction: 'expense',
      categoryId: 1,
      description: 'coffee',
      from: new Date(2026, 8, 1),
      to: new Date(2026, 8, 30),
    });
    fixture.detectChanges();
    // Three single-value axes plus the date range, counted once — four, not five.
    expect(text()).toContain('4 filters active');
  });

  it('reflects incoming criteria in the controls without re-emitting', () => {
    const { emitted } = setup({ accountId: 3 });

    // Binding a value in is not an edit — nothing goes back out.
    expect(emitted).toEqual([]);
  });

  describe('at phone width (#42)', () => {
    it('renders every control inline, with no disclosure, from the small breakpoint up', () => {
      const { disclosure, showsControls } = setup();

      expect(disclosure()).toBeNull();
      expect(showsControls()).toBe(true);
    });

    it('collapses the controls behind a shut disclosure below the small breakpoint', () => {
      const { disclosure, showsControls } = setup({}, { phone: true });

      expect(disclosure()).not.toBeNull();
      expect(disclosure()!.getAttribute('aria-expanded')).toBe('false');
      expect(showsControls()).toBe(false);
    });

    it('keeps the note search visible at phone width, disclosure open or shut', () => {
      const { fixture, disclosure, showsNote } = setup({}, { phone: true });
      expect(showsNote()).toBe(true);

      disclosure()!.click();
      fixture.detectChanges();
      expect(showsNote()).toBe(true);
    });

    it('reveals the controls when opened and hides them again when shut', () => {
      const { fixture, disclosure, showsControls } = setup({}, { phone: true });

      disclosure()!.click();
      fixture.detectChanges();
      expect(disclosure()!.getAttribute('aria-expanded')).toBe('true');
      expect(showsControls()).toBe(true);

      disclosure()!.click();
      fixture.detectChanges();
      expect(disclosure()!.getAttribute('aria-expanded')).toBe('false');
      expect(showsControls()).toBe(false);
    });

    it('keeps the controls panel mounted while collapsed, so aria-controls resolves', () => {
      const { disclosure, controlsPanel, showsControls } = setup(
        {},
        { phone: true }
      );

      // Hidden, but present and addressable by the toggle's aria-controls.
      expect(showsControls()).toBe(false);
      expect(controlsPanel()).not.toBeNull();
      expect(disclosure()!.getAttribute('aria-controls')).toBe(
        controlsPanel()!.id
      );
    });

    it('shows the active-filter count on the disclosure while the controls are hidden', () => {
      const { disclosure, showsControls } = setup(
        { direction: 'expense', accountId: 3 },
        { phone: true }
      );

      expect(showsControls()).toBe(false);
      expect(disclosure()!.textContent).toContain('2');
    });

    it('leaves the active filters untouched when the disclosure is opened and shut', () => {
      const { fixture, disclosure, emitted } = setup(
        { direction: 'expense' },
        { phone: true }
      );

      disclosure()!.click();
      fixture.detectChanges();
      disclosure()!.click();
      fixture.detectChanges();

      expect(emitted).toEqual([]);
    });

    it('drops back to the inline layout, disclosure and all, when the viewport grows past the breakpoint', () => {
      const { fixture, media, disclosure, showsControls } = setup(
        {},
        { phone: true }
      );
      disclosure()!.click();
      fixture.detectChanges();
      expect(showsControls()).toBe(true);

      media.matches.set(false);
      fixture.detectChanges();
      expect(disclosure()).toBeNull();
      expect(showsControls()).toBe(true);

      // Shrinking back lands on a shut disclosure, not the stale open one.
      media.matches.set(true);
      fixture.detectChanges();
      expect(disclosure()!.getAttribute('aria-expanded')).toBe('false');
      expect(showsControls()).toBe(false);
    });
  });
});
