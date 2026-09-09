import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { provideDialogDefaults } from '@/app/core/dialog';
import { provideIcons } from '@/app/core/icons';
import { withOverlayContainer } from '@/testing/overlay';
import { Tag } from '../../data/tag';
import { TagsService } from '../../data/tags.service';
import TagsList from './tags-list';

const tag = (id: number, name: string): Tag => ({ id, name });

const GROCERIES = tag(1, 'groceries');
const HOLIDAY = tag(2, 'holiday');
const WORK = tag(3, 'work');
const EVERYTHING = [WORK, GROCERIES, HOLIDAY]; // deliberately unsorted

type Service = Partial<TagsService>;

describe('TagsList', () => {
  const overlay = withOverlayContainer();

  function setup(readAll: TagsService['readAll'], overrides: Service = {}) {
    TestBed.configureTestingModule({
      imports: [TagsList],
      providers: [
        provideIcons(),
        provideRouter([]),
        provideDialogDefaults(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        { provide: TagsService, useValue: { readAll, ...overrides } },
      ],
    });

    const fixture = TestBed.createComponent(TagsList);
    fixture.detectChanges();

    const root = () => fixture.nativeElement as HTMLElement;
    return {
      fixture,
      root,
      text: () => root().textContent ?? '',
      addInput: () =>
        root().querySelector<HTMLInputElement>('input[aria-label="Add a tag"]')!,
      searchInput: () =>
        root().querySelector<HTMLInputElement>('input[type="search"]'),
      countText: () =>
        root().querySelector('span.text-xs')?.textContent?.trim() ?? '',
      rows: () => Array.from(root().querySelectorAll('ul > li')),
      rowNames: () =>
        Array.from(root().querySelectorAll('ul > li')).map((li) =>
          li.querySelector('span.truncate')?.textContent?.trim()
        ),
      menuTrigger: (name: string) =>
        root().querySelector<HTMLButtonElement>(
          `button[aria-label="Actions for ${name}"]`
        ),
      editInput: () =>
        root().querySelector<HTMLInputElement>('input[aria-label^="Rename "]'),
    };
  }

  async function settle(fixture: ComponentFixture<TagsList>) {
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
    fixture: ComponentFixture<TagsList>,
    trigger: HTMLButtonElement
  ) {
    trigger.click();
    await settle(fixture);
  }

  function type(input: HTMLInputElement, value: string): void {
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  function press(input: HTMLInputElement, key: string): void {
    input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  }

  it('lists the tags alphabetically, case-insensitively', () => {
    const { rowNames } = setup(() => of([tag(1, 'Zebra'), tag(2, 'apple'), tag(3, 'mango')]));
    expect(rowNames()).toEqual(['apple', 'mango', 'Zebra']);
  });

  it('shows the search and the count once there is at least one tag', () => {
    const { searchInput, countText } = setup(() => of(EVERYTHING));
    expect(searchInput()).not.toBeNull();
    expect(countText()).toBe('3 tags');
  });

  it('withholds the search and count at zero but keeps the add field, focused', async () => {
    const { fixture, searchInput, countText, addInput, text } = setup(() =>
      of([])
    );
    await settle(fixture);

    expect(searchInput()).toBeNull();
    expect(countText()).toBe('');
    expect(addInput()).not.toBeNull();
    expect(document.activeElement).toBe(addInput());
    // …and it teaches what tags are for, in one sentence with no second call to action.
    expect(text()).toContain('No tags yet');
    expect(text()).toContain('attach a tag to a transaction while filing it');
    expect(text()).not.toContain('record and refile');
  });

  it('narrows the list by the search', async () => {
    const { fixture, searchInput, rowNames } = setup(() => of(EVERYTHING));
    type(searchInput()!, 'ol');
    await settle(fixture);
    expect(rowNames()).toEqual(['holiday']);
  });

  it('tells a filter-empty search from an empty collection, and clears it', async () => {
    const { fixture, searchInput, text, root } = setup(() => of(EVERYTHING));

    type(searchInput()!, 'zzz');
    await settle(fixture);
    expect(text()).toContain('No tags match “zzz”');
    expect(text()).not.toContain('No tags yet');

    Array.from(root().querySelectorAll('button'))
      .find((b) => (b.textContent ?? '').includes('Clear search'))!
      .click();
    await settle(fixture);
    expect(text()).toContain('groceries');
    expect(text()).not.toContain('No tags match');
  });

  it('explains a failed load and retries the whole read', async () => {
    let attempt = 0;
    const readAll = vi.fn(() => {
      attempt += 1;
      return attempt === 1
        ? throwError(() => new ApiError('Could not reach the server.', 0))
        : of(EVERYTHING);
    });
    const { fixture, text, root } = setup(
      readAll as unknown as TagsService['readAll']
    );

    expect(text()).toContain('Could not reach the server.');
    expect(root().querySelector('input[aria-label="Add a tag"]')).toBeNull();

    Array.from(root().querySelectorAll('button'))
      .find((b) => (b.textContent ?? '').includes('Try again'))!
      .click();
    await settle(fixture);

    expect(readAll).toHaveBeenCalledTimes(2);
    expect(text()).toContain('groceries');
  });

  describe('create', () => {
    it('creates the trimmed name, then clears the field, keeps focus and re-reads', async () => {
      const create = vi.fn(() => of(tag(9, 'errands')));
      let attempt = 0;
      const readAll = vi.fn(() => {
        attempt += 1;
        return attempt === 1 ? of(EVERYTHING) : of([...EVERYTHING, tag(9, 'errands')]);
      });
      const { fixture, addInput, rowNames } = setup(
        readAll as unknown as TagsService['readAll'],
        { create: create as unknown as TagsService['create'] }
      );

      const input = addInput();
      type(input, '  errands  ');
      press(input, 'Enter');
      await settle(fixture);

      expect(create).toHaveBeenCalledWith('errands');
      expect(readAll).toHaveBeenCalledTimes(2);
      expect(addInput().value).toBe('');
      expect(document.activeElement).toBe(addInput());
      expect(rowNames()).toContain('errands');
    });

    it('does nothing on an empty or whitespace-only field — no request', () => {
      const create = vi.fn(() => of(tag(9, 'x')));
      const { addInput } = setup(() => of(EVERYTHING), {
        create: create as unknown as TagsService['create'],
      });

      const input = addInput();
      type(input, '   ');
      press(input, 'Enter');

      expect(create).not.toHaveBeenCalled();
    });

    it('shows a duplicate-name 409 under the field, keeping the typed text', async () => {
      const create = vi.fn(() =>
        throwError(() => new ApiError('taken', 409, { name: ['taken'] }))
      );
      const { fixture, addInput, text } = setup(() => of(EVERYTHING), {
        create: create as unknown as TagsService['create'],
      });

      const input = addInput();
      type(input, 'groceries');
      press(input, 'Enter');
      await settle(fixture);

      expect(text()).toContain('You already have a tag called “groceries”.');
      expect(addInput().value).toBe('groceries');
    });
  });

  describe('rename, in place on the row', () => {
    function startEditing(
      fixture: ComponentFixture<TagsList>,
      trigger: HTMLButtonElement
    ) {
      return openRowMenu(fixture, trigger).then(() => {
        overlayButton('Rename').click();
        return settle(fixture);
      });
    }

    it('is reached from a real focusable trigger sitting in the row', () => {
      const { menuTrigger } = setup(() => of(EVERYTHING));
      const trigger = menuTrigger('groceries');
      expect(trigger).not.toBeNull();
      expect(trigger!.tagName).toBe('BUTTON');
      trigger!.focus();
      expect(document.activeElement).toBe(trigger);
    });

    it('commits on Enter and re-reads', async () => {
      const rename = vi.fn(() => of(tag(1, 'food')));
      let attempt = 0;
      const readAll = vi.fn(() => {
        attempt += 1;
        return attempt === 1 ? of(EVERYTHING) : of([tag(1, 'food'), HOLIDAY, WORK]);
      });
      const { fixture, menuTrigger, editInput, rowNames } = setup(
        readAll as unknown as TagsService['readAll'],
        { rename: rename as unknown as TagsService['rename'] }
      );

      await startEditing(fixture, menuTrigger('groceries')!);
      const input = editInput()!;
      type(input, 'food');
      press(input, 'Enter');
      await settle(fixture);

      expect(rename).toHaveBeenCalledWith(1, 'food');
      expect(readAll).toHaveBeenCalledTimes(2);
      expect(rowNames()).toContain('food');
    });

    it('commits on blur', async () => {
      const rename = vi.fn(() => of(tag(1, 'food')));
      const { fixture, menuTrigger, editInput } = setup(() => of(EVERYTHING), {
        rename: rename as unknown as TagsService['rename'],
      });

      await startEditing(fixture, menuTrigger('groceries')!);
      const input = editInput()!;
      type(input, 'food');
      input.dispatchEvent(new Event('blur'));
      await settle(fixture);

      expect(rename).toHaveBeenCalledWith(1, 'food');
    });

    it('abandons an emptied field with no request', async () => {
      const rename = vi.fn(() => of(tag(1, 'food')));
      const { fixture, menuTrigger, editInput } = setup(() => of(EVERYTHING), {
        rename: rename as unknown as TagsService['rename'],
      });

      await startEditing(fixture, menuTrigger('groceries')!);
      const input = editInput()!;
      type(input, '   ');
      press(input, 'Enter');
      await settle(fixture);

      expect(rename).not.toHaveBeenCalled();
      expect(editInput()).toBeNull();
    });

    it('abandons on Escape — no request, edit closes', async () => {
      const rename = vi.fn(() => of(tag(1, 'food')));
      const { fixture, menuTrigger, editInput } = setup(() => of(EVERYTHING), {
        rename: rename as unknown as TagsService['rename'],
      });

      await startEditing(fixture, menuTrigger('groceries')!);
      const input = editInput()!;
      type(input, 'food');
      press(input, 'Escape');
      await settle(fixture);

      expect(rename).not.toHaveBeenCalled();
      expect(editInput()).toBeNull();
    });

    it('swallows a rename to the tag’s own current name — no request', async () => {
      const rename = vi.fn(() => of(GROCERIES));
      const { fixture, menuTrigger, editInput } = setup(() => of(EVERYTHING), {
        rename: rename as unknown as TagsService['rename'],
      });

      await startEditing(fixture, menuTrigger('groceries')!);
      const input = editInput()!;
      type(input, 'groceries');
      press(input, 'Enter');
      await settle(fixture);

      expect(rename).not.toHaveBeenCalled();
      expect(editInput()).toBeNull();
    });

    it('shows a duplicate-name 409 under the rename field, keeping the typed text', async () => {
      const rename = vi.fn(() =>
        throwError(() => new ApiError('taken', 409, { name: ['taken'] }))
      );
      const { fixture, menuTrigger, editInput, text } = setup(
        () => of(EVERYTHING),
        { rename: rename as unknown as TagsService['rename'] }
      );

      await startEditing(fixture, menuTrigger('groceries')!);
      const input = editInput()!;
      type(input, 'holiday');
      press(input, 'Enter');
      await settle(fixture);

      expect(text()).toContain('You already have a tag called “holiday”.');
      expect(editInput()!.value).toBe('holiday');
    });

    it('folds a 403 into one staleness line, re-reads, and offers no retry', async () => {
      const rename = vi.fn(() =>
        throwError(() => new ApiError('Forbidden', 403))
      );
      let attempt = 0;
      const readAll = vi.fn(() => {
        attempt += 1;
        return of(attempt === 1 ? EVERYTHING : [HOLIDAY, WORK]);
      });
      const { fixture, menuTrigger, editInput, text } = setup(
        readAll as unknown as TagsService['readAll'],
        { rename: rename as unknown as TagsService['rename'] }
      );

      await startEditing(fixture, menuTrigger('groceries')!);
      type(editInput()!, 'food');
      press(editInput()!, 'Enter');
      await settle(fixture);

      expect(text()).toContain('That tag is no longer there.');
      expect(text()).not.toContain('Try again');
      expect(readAll).toHaveBeenCalledTimes(2);
    });
  });

  describe('delete', () => {
    it('asks on the row with the certain-effect wording and a destructive button, and waits for confirm', async () => {
      const remove = vi.fn(() => of(undefined));
      const { fixture, menuTrigger, root, text } = setup(() => of(EVERYTHING), {
        remove: remove as unknown as TagsService['remove'],
      });

      await openRowMenu(fixture, menuTrigger('groceries')!);
      overlayButton('Delete').click();
      await settle(fixture);

      expect(text()).toContain(
        'It will be removed from every transaction carrying it. This can’t be undone.'
      );
      expect(remove).not.toHaveBeenCalled();

      const strip = root().querySelector('[role="alertdialog"]')!;
      const confirm = Array.from(strip.querySelectorAll('button')).find(
        (b) => (b.textContent ?? '').trim() === 'Delete'
      )!;
      expect(confirm.className).toContain('red');
      confirm.click();
      await settle(fixture);
      expect(remove).toHaveBeenCalledWith(1);
    });

    it('says nothing after a successful delete — the row just goes', async () => {
      const remove = vi.fn(() => of(undefined));
      let attempt = 0;
      const readAll = vi.fn(() => {
        attempt += 1;
        return of(attempt === 1 ? EVERYTHING : [HOLIDAY, WORK]);
      });
      const { fixture, menuTrigger, root, text } = setup(
        readAll as unknown as TagsService['readAll'],
        { remove: remove as unknown as TagsService['remove'] }
      );

      await openRowMenu(fixture, menuTrigger('groceries')!);
      overlayButton('Delete').click();
      await settle(fixture);
      Array.from(root().querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button'))
        .find((b) => (b.textContent ?? '').trim() === 'Delete')!
        .click();
      await settle(fixture);

      expect(text()).not.toContain('groceries');
      expect(text()).not.toContain('deleted');
      expect(text()).not.toContain('removed');
    });

    it('folds a 404 into the one staleness line, re-reads, and offers no retry', async () => {
      const remove = vi.fn(() => throwError(() => new ApiError('Not found', 404)));
      let attempt = 0;
      const readAll = vi.fn(() => {
        attempt += 1;
        return of(attempt === 1 ? EVERYTHING : [HOLIDAY, WORK]);
      });
      const { fixture, menuTrigger, root, text } = setup(
        readAll as unknown as TagsService['readAll'],
        { remove: remove as unknown as TagsService['remove'] }
      );

      await openRowMenu(fixture, menuTrigger('groceries')!);
      overlayButton('Delete').click();
      await settle(fixture);
      Array.from(
        root().querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')
      )
        .find((b) => (b.textContent ?? '').trim() === 'Delete')!
        .click();
      await settle(fixture);

      expect(text()).toContain('That tag is no longer there.');
      expect(text()).not.toContain('Try again');
      expect(readAll).toHaveBeenCalledTimes(2);
    });

    it('keeps every row when the re-read after a delete fails, stale row included', async () => {
      const remove = vi.fn(() => of(undefined));
      let attempt = 0;
      const readAll = vi.fn(() => {
        attempt += 1;
        return attempt === 1
          ? of(EVERYTHING)
          : throwError(() => new ApiError('Server error', 500));
      });
      const { fixture, menuTrigger, root, text } = setup(
        readAll as unknown as TagsService['readAll'],
        { remove: remove as unknown as TagsService['remove'] }
      );

      await openRowMenu(fixture, menuTrigger('groceries')!);
      overlayButton('Delete').click();
      await settle(fixture);
      Array.from(root().querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button'))
        .find((b) => (b.textContent ?? '').trim() === 'Delete')!
        .click();
      await settle(fixture);

      expect(text()).toContain('Your change was saved');
      // The deleted row stands rather than the client inventing a list it never read.
      expect(text()).toContain('groceries');
    });
  });

  it('opens with an empty search — nothing is carried across entries', () => {
    const { searchInput } = setup(() => of(EVERYTHING));
    expect(searchInput()!.value).toBe('');
  });
});
