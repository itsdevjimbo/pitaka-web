import { WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { of, throwError } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { provideIcons } from '@/app/core/icons';
import { withOverlayContainer } from '@/testing/overlay';
import { Tag } from '../../data/tag';
import { TagsService } from '../../data/tags.service';
import { TagField } from './tag-field';

const GROCERIES: Tag = { id: 1, name: 'groceries' };
const WORK: Tag = { id: 2, name: 'work' };

/** The slice of the control the tests reach into — its observable state. */
type Internals = {
  selected: WritableSignal<readonly Tag[]>;
  loadFailed: () => boolean;
  query: WritableSignal<string>;
  filteredOptions: () => Tag[];
  showCreate: () => boolean;
  onInput(value: string): void;
  onOptionActivated(event: unknown): void;
  onOptionSelected(event: unknown): void;
  commitTyped(event: unknown): void;
  onBackspace(event: Event, input: HTMLInputElement): void;
  remove(tag: Tag): void;
};

/** A chip-input event whose `clear()` the control calls after committing. */
function tokenEnd(value: string) {
  return { value, chipInput: { clear: vi.fn() } };
}

function backspaceEvent(): Event {
  return {
    preventDefault: vi.fn(),
    stopImmediatePropagation: vi.fn(),
  } as unknown as Event;
}

describe('TagField', () => {
  withOverlayContainer();

  function setup(service: Partial<TagsService> = {}) {
    const create = service.create ?? vi.fn();
    const all = service.all ?? (() => of<Tag[]>([GROCERIES, WORK]));

    TestBed.configureTestingModule({
      imports: [TagField],
      providers: [
        provideIcons(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        { provide: TagsService, useValue: { all, create } },
      ],
    });

    const fixture = TestBed.createComponent(TagField);
    const cmp = fixture.componentInstance as unknown as Internals;
    fixture.detectChanges();
    return {
      fixture,
      cmp,
      create,
      host: () => fixture.nativeElement as HTMLElement,
    };
  }

  describe('the Enter collision', () => {
    it('takes the highlighted option and creates nothing from the raw text', () => {
      const create = vi.fn();
      const { cmp } = setup({ all: () => of([GROCERIES]), create });

      cmp.onInput('gro');
      cmp.onOptionActivated({ option: { value: GROCERIES } });
      // In the browser Enter fires both the autocomplete and the chip input.
      cmp.onOptionSelected({ option: { value: GROCERIES } });
      cmp.commitTyped(tokenEnd('gro'));

      expect(cmp.selected()).toEqual([GROCERIES]);
      expect(create).not.toHaveBeenCalled();
    });

    it('commits the raw text as a new Tag when nothing is highlighted', () => {
      const created: Tag = { id: 5, name: 'gro' };
      const create = vi.fn(() => of(created));
      const { cmp } = setup({ all: () => of([GROCERIES]), create });

      cmp.onInput('gro');
      cmp.commitTyped(tokenEnd('gro'));

      expect(create).toHaveBeenCalledWith('gro');
      expect(cmp.selected()).toEqual([created]);
    });

    it('does nothing on Enter with an option highlighted but no matching selection event', () => {
      const create = vi.fn();
      const { cmp } = setup({ all: () => of([GROCERIES]), create });

      cmp.onInput('gro');
      cmp.onOptionActivated({ option: { value: GROCERIES } });
      cmp.commitTyped(tokenEnd('gro'));

      expect(cmp.selected()).toEqual([]);
      expect(create).not.toHaveBeenCalled();
    });
  });

  describe('Create "…"', () => {
    it('is offered only when nothing matches', () => {
      const { cmp } = setup({ all: () => of([GROCERIES]) });

      cmp.onInput('gro');
      expect(cmp.showCreate()).toBe(false);

      cmp.onInput('groceries');
      expect(cmp.showCreate()).toBe(false);

      cmp.onInput('holiday');
      expect(cmp.showCreate()).toBe(true);
    });

    it('is withheld while the field is disabled by a failed load', () => {
      const { cmp } = setup({
        all: () => throwError(() => new ApiError('nope', 500, {})),
      });

      cmp.onInput('holiday');
      expect(cmp.showCreate()).toBe(false);
    });
  });

  describe('a name that already exists', () => {
    it('attaches the existing Tag with no request and no error rendered', () => {
      const create = vi.fn();
      const { cmp, host } = setup({ all: () => of([GROCERIES]), create });

      cmp.onInput('Groceries');
      cmp.commitTyped(tokenEnd('Groceries'));

      expect(cmp.selected()).toEqual([GROCERIES]);
      expect(create).not.toHaveBeenCalled();
      expect(host().querySelector('mat-error')).toBeNull();
    });

    it('attaches it silently after a create races a 409', () => {
      const holiday: Tag = { id: 7, name: 'holiday' };
      const create = vi.fn(() =>
        throwError(() => new ApiError('taken', 409, { name: ['taken'] }))
      );
      // The list is stale on load; the re-read after the 409 carries the row.
      const all = vi
        .fn()
        .mockReturnValueOnce(of([GROCERIES]))
        .mockReturnValue(of([GROCERIES, holiday]));
      const { cmp, host } = setup({ all, create });

      cmp.onInput('holiday');
      cmp.commitTyped(tokenEnd('holiday'));

      expect(create).toHaveBeenCalledWith('holiday');
      expect(cmp.selected()).toEqual([holiday]);
      expect(host().querySelector('mat-error')).toBeNull();
    });
  });

  it('adds an inline-created Tag to its own option source', () => {
    const created: Tag = { id: 5, name: 'holiday' };
    const create = vi.fn(() => of(created));
    const { cmp } = setup({ all: () => of([GROCERIES]), create });

    cmp.onInput('holiday');
    cmp.commitTyped(tokenEnd('holiday'));
    expect(cmp.selected()).toEqual([created]);

    // Detached again, it is offered back as an option rather than lost.
    cmp.remove(created);
    cmp.onInput('hol');
    expect(cmp.filteredOptions()).toContainEqual(created);
  });

  describe('removal', () => {
    it('drops a chip through remove() — the × path', () => {
      const { cmp } = setup();
      cmp.selected.set([GROCERIES, WORK]);

      cmp.remove(GROCERIES);

      expect(cmp.selected()).toEqual([WORK]);
    });

    it('drops the last chip on Backspace when the input is empty', () => {
      const { cmp } = setup();
      cmp.selected.set([GROCERIES, WORK]);

      cmp.onBackspace(backspaceEvent(), { value: '' } as HTMLInputElement);

      expect(cmp.selected()).toEqual([GROCERIES]);
    });

    it('leaves the chips alone on Backspace while the input has text', () => {
      const { cmp } = setup();
      cmp.selected.set([GROCERIES]);

      cmp.onBackspace(backspaceEvent(), { value: 'gr' } as HTMLInputElement);

      expect(cmp.selected()).toEqual([GROCERIES]);
    });
  });

  describe('with zero Tags', () => {
    it('says nothing extra — no hint, no explanatory line', () => {
      const { host } = setup({ all: () => of<Tag[]>([]) });

      expect(host().querySelector('mat-hint')).toBeNull();
    });
  });

  describe('a failed fetch of the option set', () => {
    it('disables the field and shows a short line', () => {
      const { cmp, host } = setup({
        all: () => throwError(() => new ApiError('nope', 500, {})),
      });

      expect(cmp.loadFailed()).toBe(true);
      expect(host().querySelector('mat-hint')?.textContent).toContain(
        'couldn’t be loaded'
      );
      const input = host().querySelector('input') as HTMLInputElement;
      expect(input.disabled).toBe(true);
    });

    it('keeps the chips the parent seeded', () => {
      const { fixture, cmp } = setup({
        all: () => throwError(() => new ApiError('nope', 500, {})),
      });

      cmp.selected.set([GROCERIES]);
      fixture.detectChanges();

      expect(cmp.selected()).toEqual([GROCERIES]);
    });
  });
});
