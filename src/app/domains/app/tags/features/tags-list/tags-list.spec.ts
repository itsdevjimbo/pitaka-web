import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { provideRouter, Router } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { provideDialogDefaults } from '@/app/core/dialog';
import { provideIcons } from '@/app/core/icons';
import { withOverlayContainer } from '@/testing/overlay';
import { Tag } from '../../data/tag';
import { TagUnavailableError, TagWriteOutcomeUncertainError } from '../../data/tag-errors';
import { TagsService } from '../../data/tags.service';
import TagsList from './tags-list';

@Component({ template: 'Destination' })
class Destination {}

const tag = (id: number, name: string): Tag => ({ id, name });

const GROCERIES = tag(1, 'groceries');
const HOLIDAY = tag(2, 'holiday');
const WORK = tag(3, 'work');
const EVERYTHING = [WORK, GROCERIES, HOLIDAY];

type ReadTags = TagsService['readAll'];
type TagListService = Partial<TagsService>;

describe('TagsList', () => {
  const overlay = withOverlayContainer();

  function setup(readAll: ReadTags, overrides: TagListService = {}) {
    TestBed.configureTestingModule({
      imports: [TagsList],
      providers: [
        provideIcons(),
        provideRouter([
          { path: 'other', component: Destination },
          { path: 'auth/sign-in', component: Destination },
        ]),
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
      addInput: () => root().querySelector<HTMLInputElement>('#add-tag-name')!,
      searchInput: () => root().querySelector<HTMLInputElement>('#tag-search'),
      editInput: () => root().querySelector<HTMLInputElement>('[id^="rename-tag-"]'),
      rowNames: () => Array.from(root().querySelectorAll('ul > li > div > span')).map((el) => el.textContent?.trim()),
      rowAction: (id: number) => root().querySelector<HTMLButtonElement>(`#tag-actions-${id}`),
      button: (label: string) => button(root(), label),
    };
  }

  async function settle(fixture: ComponentFixture<TagsList>) {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function button(container: ParentNode, label: string): HTMLButtonElement {
    const result = Array.from(container.querySelectorAll('button')).find(
      (candidate) => (candidate.textContent ?? '').trim() === label,
    );
    if (!result) {
      throw new Error(`No button labelled "${label}"`);
    }
    return result;
  }

  function overlayButton(label: string): HTMLButtonElement {
    return button(overlay(), label);
  }

  async function openRowMenu(fixture: ComponentFixture<TagsList>, trigger: HTMLButtonElement) {
    trigger.click();
    await settle(fixture);
  }

  async function startEditing(fixture: ComponentFixture<TagsList>, trigger: HTMLButtonElement) {
    await openRowMenu(fixture, trigger);
    overlayButton('Rename').click();
    await settle(fixture);
  }

  function type(input: HTMLInputElement, value: string): void {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  it('lists Tags alphabetically and wraps the full name beside a reachable row action', () => {
    const longName = `${'a'.repeat(127)} ${'b'.repeat(127)}`;
    const { root, rowNames, rowAction } = setup(() => of([tag(4, longName), tag(2, 'Zebra'), tag(3, 'apple')]));

    expect(rowNames()).toEqual([longName, 'apple', 'Zebra']);
    expect(root().querySelector('ul > li span')?.className).toContain('break-words');
    expect(rowAction(4)?.getAttribute('aria-label')).toBe(`Actions for ${longName}`);
    expect(rowAction(4)?.tagName).toBe('BUTTON');
  });

  it('shows search and the whole collection count when Tags exist', () => {
    const { searchInput, text } = setup(() => of(EVERYTHING));
    expect(searchInput()).not.toBeNull();
    expect(searchInput()?.getAttribute('aria-label')).toBe('Search tags');
    expect(text()).not.toContain('Find a tag');
    expect(text()).toContain('3 tags');
  });

  it('keeps inline creation in the empty state and gives the field focus', async () => {
    const { fixture, root, addInput, searchInput, text } = setup(() => of([]));
    await settle(fixture);

    expect(searchInput()).toBeNull();
    expect(root().querySelector('button[type="submit"]')?.textContent).toContain('Add tag');
    expect(root().querySelector('label[for="add-tag-name"]')).toBeNull();
    expect(addInput().getAttribute('aria-label')).toBe('Tag name');
    expect(addInput().parentElement?.querySelector('mat-icon')).toBeNull();
    expect(document.activeElement).toBe(addInput());
    expect(text()).toContain('No tags yet');
    expect(text()).toContain('attach it while filing a Transaction');
  });

  it('narrows search and distinguishes no matches from a genuinely empty collection', async () => {
    const { fixture, searchInput, root, text } = setup(() => of(EVERYTHING));

    type(searchInput()!, 'hol');
    await settle(fixture);
    expect(root().querySelectorAll('ul > li')).toHaveLength(1);
    expect(text()).toContain('holiday');

    type(searchInput()!, 'zzz');
    await settle(fixture);
    expect(text()).toContain('No tags match “zzz”');
    expect(text()).not.toContain('No tags yet');
    button(root(), 'Clear search').click();
    await settle(fixture);
    expect(text()).toContain('groceries');
  });

  it('shows an initial read failure and retries without presenting an empty state', async () => {
    let attempt = 0;
    const readAll: ReadTags = vi.fn(() => {
      attempt += 1;
      return attempt === 1 ? throwError(() => new ApiError('Could not reach the server.', 0)) : of(EVERYTHING);
    });
    const { fixture, root, text } = setup(readAll);

    expect(text()).toContain('Could not reach the server.');
    expect(root().querySelector('#add-tag-name')).toBeNull();
    expect(text()).not.toContain('No tags yet');
    button(root(), 'Retry').click();
    await settle(fixture);
    expect(readAll).toHaveBeenCalledTimes(2);
    expect(text()).toContain('groceries');
  });

  describe('creation', () => {
    it('creates a trimmed name, clears the field, keeps focus and reads the collection again', async () => {
      const create: TagsService['create'] = vi.fn((name) => of(tag(9, name)));
      let attempt = 0;
      const readAll: ReadTags = vi.fn(() => {
        attempt += 1;
        return of(attempt === 1 ? EVERYTHING : [...EVERYTHING, tag(9, 'errands')]);
      });
      const { fixture, addInput, rowNames } = setup(readAll, { create });

      type(addInput(), '  errands  ');
      button(fixture.nativeElement, 'Add tag').click();
      await settle(fixture);

      expect(create).toHaveBeenCalledWith('errands');
      expect(readAll).toHaveBeenCalledTimes(2);
      expect(addInput().value).toBe('');
      expect(document.activeElement).toBe(addInput());
      expect(rowNames()).toContain('errands');
    });

    it('reveals a created Tag outside the active search and announces success once', async () => {
      const create: TagsService['create'] = vi.fn((name) => of(tag(9, name)));
      let attempt = 0;
      const readAll: ReadTags = vi.fn(() => {
        attempt += 1;
        return of(attempt === 1 ? EVERYTHING : [...EVERYTHING, tag(9, 'errands')]);
      });
      const { fixture, root, addInput, searchInput, rowNames } = setup(readAll, { create });

      type(searchInput()!, 'hol');
      type(addInput(), 'errands');
      button(root(), 'Add tag').click();
      await settle(fixture);

      expect(searchInput()!.value).toBe('');
      expect(rowNames()).toContain('errands');
      expect(root().querySelector('[role="status"]')?.textContent).toContain('Tag “errands” added.');
    });

    it('dismisses the routine success announcement after five seconds', async () => {
      const create: TagsService['create'] = vi.fn((name) => of(tag(9, name)));
      let attempt = 0;
      const readAll: ReadTags = vi.fn(() => {
        attempt += 1;
        return of(attempt === 1 ? EVERYTHING : [...EVERYTHING, tag(9, 'errands')]);
      });
      const { fixture, root, addInput } = setup(readAll, { create });

      vi.useFakeTimers();
      try {
        type(addInput(), 'errands');
        button(root(), 'Add tag').click();
        await Promise.resolve();
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(0);
        fixture.detectChanges();
        expect(root().textContent).toContain('Tag “errands” added.');

        await vi.advanceTimersByTimeAsync(5_000);
        fixture.detectChanges();
        expect(root().textContent).not.toContain('Tag “errands” added.');
        expect(root().textContent).toContain('errands');
      } finally {
        vi.useRealTimers();
      }
    });

    it('submits an empty name without client-side validation', async () => {
      const create: TagsService['create'] = vi.fn(() => of(tag(9, '')));
      const { fixture, addInput, root } = setup(() => of(EVERYTHING), { create });

      const submitButton = button(root(), 'Add tag');
      expect(submitButton.disabled).toBe(false);
      submitButton.focus();
      submitButton.click();
      await settle(fixture);

      expect(create).toHaveBeenCalledWith('');
      expect(addInput().getAttribute('aria-invalid')).not.toBe('true');
      expect(root().querySelector('#add-tag-name-errors')).toBeNull();
    });

    it('submits a name longer than 255 characters without client-side validation', async () => {
      const name = 'x'.repeat(256);
      const create: TagsService['create'] = vi.fn(() => of(tag(9, name)));
      const { fixture, addInput, root } = setup(() => of(EVERYTHING), { create });

      type(addInput(), name);
      button(root(), 'Add tag').click();
      await settle(fixture);

      expect(create).toHaveBeenCalledWith(name);
      expect(root().querySelector('#add-tag-name-errors')).toBeNull();
    });

    it('announces when a create write is in progress', () => {
      const response = new Subject<Tag>();
      const create: TagsService['create'] = vi.fn(() => response);
      const { fixture, root, addInput } = setup(() => of(EVERYTHING), { create });

      type(addInput(), 'errands');
      button(root(), 'Add tag').click();
      fixture.detectChanges();

      expect(root().querySelector('[aria-atomic="true"]')?.textContent).toContain('Adding Tag…');

      response.next(tag(9, 'errands'));
      response.complete();
    });

    it('shows a duplicate-name error under the field and preserves the entered value', async () => {
      const create: TagsService['create'] = vi.fn(() =>
        throwError(
          () =>
            new ApiError('You already have a tag with this name.', 409, {
              name: ['You already have a tag with this name.'],
            }),
        ),
      );
      const { fixture, addInput, root } = setup(() => of(EVERYTHING), { create });

      type(addInput(), 'groceries');
      button(root(), 'Add tag').click();
      await settle(fixture);

      expect(root().textContent).toContain('You already have a tag with this name.');
      expect(addInput().value).toBe('groceries');
      expect(addInput().getAttribute('aria-describedby')).toContain('add-tag-name-errors');
    });

    it('keeps entered text after a known write rejection', async () => {
      const create: TagsService['create'] = vi.fn(() => throwError(() => new ApiError('Tag name was rejected.', 422)));
      const { fixture, addInput, root } = setup(() => of(EVERYTHING), { create });

      type(addInput(), 'travel');
      button(root(), 'Add tag').click();
      await settle(fixture);

      expect(root().textContent).toContain('Tag name was rejected.');
      expect(addInput().value).toBe('travel');
    });

    it('blocks another write after a successful create whose refresh failed, then retries only the read', async () => {
      const create: TagsService['create'] = vi.fn(() => of(tag(9, 'errands')));
      let attempt = 0;
      const readAll: ReadTags = vi.fn(() => {
        attempt += 1;
        if (attempt === 1) {
          return of(EVERYTHING);
        }
        if (attempt === 2) {
          return throwError(() => new ApiError('Server unavailable.', 500));
        }
        return of([...EVERYTHING, tag(9, 'errands')]);
      });
      const { fixture, addInput, root } = setup(readAll, { create });

      type(addInput(), 'errands');
      button(root(), 'Add tag').click();
      await settle(fixture);
      expect(root().textContent).toContain('Your change was saved');
      expect(addInput().disabled).toBe(true);
      expect(button(root(), 'Add tag').disabled).toBe(true);

      button(root(), 'Retry refresh').click();
      await settle(fixture);
      expect(readAll).toHaveBeenCalledTimes(3);
      expect(create).toHaveBeenCalledTimes(1);
      expect(addInput().disabled).toBe(false);
      expect(root().textContent).toContain('errands');
    });

    it('treats a create transport failure as uncertain until a read-only check', async () => {
      const create: TagsService['create'] = vi.fn(() => throwError(() => new TagWriteOutcomeUncertainError()));
      const readAll: ReadTags = vi.fn(() => of(EVERYTHING));
      const { fixture, root, addInput } = setup(readAll, { create });

      type(addInput(), 'errands');
      button(root(), 'Add tag').click();
      await settle(fixture);

      expect(create).toHaveBeenCalledTimes(1);
      expect(root().textContent).toContain('couldn’t confirm whether your Tag change went through');
      expect(addInput().value).toBe('errands');
      expect(button(root(), 'Add tag').disabled).toBe(true);

      button(root(), 'Refresh tags').click();
      await settle(fixture);

      expect(create).toHaveBeenCalledTimes(1);
      expect(addInput().value).toBe('errands');
      expect(button(root(), 'Add tag').disabled).toBe(false);
    });

    it('does not move focus into the list when a failed refresh succeeds', async () => {
      const create: TagsService['create'] = vi.fn(() => of(tag(9, 'errands')));
      let readCount = 0;
      const readAll: ReadTags = vi.fn(() => {
        readCount += 1;
        return readCount === 2 ? throwError(() => new ApiError('Offline.', 500)) : of(EVERYTHING);
      });
      const { fixture, root, addInput, searchInput } = setup(readAll, { create });

      type(addInput(), 'errands');
      button(root(), 'Add tag').click();
      await settle(fixture);
      button(root(), 'Retry refresh').focus();
      button(root(), 'Retry refresh').click();
      await settle(fixture);

      expect(document.activeElement).not.toBe(searchInput());
      expect(document.activeElement).not.toBe(addInput());
    });
  });

  describe('inline renaming', () => {
    it('announces when a rename write is in progress', async () => {
      const response = new Subject<Tag>();
      const rename: TagsService['rename'] = vi.fn(() => response);
      const { fixture, root, rowAction, editInput } = setup(() => of(EVERYTHING), { rename });
      await startEditing(fixture, rowAction(1)!);

      type(editInput()!, 'food');
      button(root(), 'Save').click();
      fixture.detectChanges();

      expect(root().querySelector('[aria-atomic="true"]')?.textContent).toContain('Saving Tag name…');

      response.next(tag(1, 'food'));
      response.complete();
    });

    it('starts from the row menu, saves explicitly, re-reads and restores row focus', async () => {
      const rename: TagsService['rename'] = vi.fn((id, name) => of(tag(id, name)));
      let attempt = 0;
      const readAll: ReadTags = vi.fn(() => {
        attempt += 1;
        return of(attempt === 1 ? EVERYTHING : [tag(1, 'food'), HOLIDAY, WORK]);
      });
      const { fixture, root, rowAction, editInput, rowNames } = setup(readAll, { rename });

      await startEditing(fixture, rowAction(1)!);
      type(editInput()!, 'food');
      button(root(), 'Save').click();
      await settle(fixture);

      expect(rename).toHaveBeenCalledWith(1, 'food');
      expect(readAll).toHaveBeenCalledTimes(2);
      expect(rowNames()).toContain('food');
      expect(document.activeElement).toBe(rowAction(1));
    });

    it('reveals and announces a renamed Tag that no longer matches the active search', async () => {
      const rename: TagsService['rename'] = vi.fn((id, name) => of(tag(id, name)));
      let attempt = 0;
      const readAll: ReadTags = vi.fn(() => {
        attempt += 1;
        return of(attempt === 1 ? EVERYTHING : [tag(1, 'food'), HOLIDAY, WORK]);
      });
      const { fixture, root, searchInput, rowAction, editInput, rowNames } = setup(readAll, { rename });

      type(searchInput()!, 'gro');
      await startEditing(fixture, rowAction(1)!);
      type(editInput()!, 'food');
      button(root(), 'Save').click();
      await settle(fixture);

      expect(searchInput()!.value).toBe('');
      expect(rowNames()).toContain('food');
      expect(root().querySelector('[role="status"]')?.textContent).toContain('Tag “food” renamed.');
    });

    it('closes a stale editor and refreshes when the adapter reports an unavailable Tag', async () => {
      const rename: TagsService['rename'] = vi.fn(() => throwError(() => new TagUnavailableError()));
      const { fixture, root, rowAction, editInput } = setup(() => of(EVERYTHING), { rename });

      await startEditing(fixture, rowAction(1)!);
      type(editInput()!, 'food');
      button(root(), 'Save').click();
      await settle(fixture);

      expect(root().querySelector('[id^="rename-tag-"]')).toBeNull();
      expect(root().textContent).toContain('That tag is no longer there.');
    });

    it('treats a rename transport failure as uncertain until a read-only check', async () => {
      const rename: TagsService['rename'] = vi.fn(() => throwError(() => new TagWriteOutcomeUncertainError()));
      const readAll: ReadTags = vi.fn(() => of(EVERYTHING));
      const { fixture, root, rowAction, editInput } = setup(readAll, { rename });
      await startEditing(fixture, rowAction(1)!);

      type(editInput()!, 'food');
      button(root(), 'Save').click();
      await settle(fixture);

      expect(rename).toHaveBeenCalledTimes(1);
      expect(root().textContent).toContain('couldn’t confirm whether your Tag change went through');
      expect(editInput()!.value).toBe('food');
      expect(button(root(), 'Save').disabled).toBe(true);

      button(root(), 'Refresh tags').click();
      await settle(fixture);

      expect(rename).toHaveBeenCalledTimes(1);
      expect(editInput()!.value).toBe('food');
      expect(button(root(), 'Save').disabled).toBe(false);
    });

    it('keeps invalid Submit enabled, focuses the field and does not send a request', async () => {
      const rename: TagsService['rename'] = vi.fn((id, name) => of(tag(id, name)));
      const { fixture, root, rowAction, editInput } = setup(() => of(EVERYTHING), { rename });

      await startEditing(fixture, rowAction(1)!);
      type(editInput()!, '  ');
      const save = button(root(), 'Save');
      expect(save.disabled).toBe(false);
      save.click();
      await settle(fixture);

      expect(rename).not.toHaveBeenCalled();
      expect(editInput()!.getAttribute('aria-invalid')).toBe('true');
      expect(document.activeElement).toBe(editInput());
    });

    it('asks before discarding a dirty name and restores focus to the row action', async () => {
      const { fixture, root, rowAction, editInput } = setup(() => of(EVERYTHING));

      await startEditing(fixture, rowAction(1)!);
      type(editInput()!, 'food');
      button(root(), 'Cancel').click();
      await settle(fixture);

      expect(root().querySelector('[role="alertdialog"]')?.textContent).toContain('Discard the unsaved name');
      expect(document.activeElement).toBe(button(root(), 'Keep editing'));
      button(root(), 'Discard changes').click();
      await settle(fixture);
      expect(root().querySelector('[id^="rename-tag-"]')).toBeNull();
      expect(document.activeElement).toBe(rowAction(1));
    });

    it('shows a duplicate-name error under the editor and retains the typed value', async () => {
      const rename: TagsService['rename'] = vi.fn(() =>
        throwError(
          () =>
            new ApiError('You already have a tag with this name.', 409, {
              name: ['You already have a tag with this name.'],
            }),
        ),
      );
      const { fixture, root, rowAction, editInput } = setup(() => of(EVERYTHING), { rename });

      await startEditing(fixture, rowAction(1)!);
      type(editInput()!, 'holiday');
      button(root(), 'Save').click();
      await settle(fixture);

      expect(root().textContent).toContain('You already have a tag with this name.');
      expect(editInput()!.value).toBe('holiday');
      expect(editInput()!.getAttribute('aria-describedby')).toContain('rename-tag-errors-1');
    });

    it('keeps drafts when navigation is requested and proceeds only after explicit discard', async () => {
      const { fixture, root, addInput } = setup(() => of(EVERYTHING));
      const router = TestBed.inject(Router);

      type(addInput(), 'travel');
      const firstNavigation = router.navigateByUrl('/other');
      await firstNavigation;
      await settle(fixture);

      expect(router.url).not.toBe('/other');
      expect(root().textContent).toContain('Discard unsaved changes?');
      expect(document.activeElement).toBe(button(root(), 'Keep editing'));
      button(root(), 'Discard changes and leave').click();
      await settle(fixture);
      expect(router.url).toBe('/other');
    });

    it('discards drafts and permits the session-expiry redirect with its return destination', async () => {
      const { fixture, root, addInput } = setup(() => of(EVERYTHING));
      const router = TestBed.inject(Router);

      type(addInput(), 'unsaved name');
      await router.navigateByUrl('/auth/sign-in?returnUrl=%2Fapp%2Ftags&reason=session-expired');
      await settle(fixture);

      expect(router.url).toBe('/auth/sign-in?returnUrl=%2Fapp%2Ftags&reason=session-expired');
      expect(root().querySelector('[role="alertdialog"]')).toBeNull();
      expect(addInput().value).toBe('');
    });

    it('blocks navigation during a pending write and allows it after the request finishes', async () => {
      const response = new Subject<Tag>();
      const create: TagsService['create'] = vi.fn(() => response);
      const { fixture, root, addInput } = setup(() => of(EVERYTHING), { create });
      const router = TestBed.inject(Router);

      type(addInput(), 'travel');
      button(root(), 'Add tag').click();
      fixture.detectChanges();
      expect(root().querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);

      await router.navigateByUrl('/other');
      await settle(fixture);
      expect(router.url).not.toBe('/other');
      expect(root().textContent).toContain('A tag change is saving.');

      response.next(tag(9, 'travel'));
      response.complete();
      await settle(fixture);
      expect(root().textContent).toContain('The tag action finished.');

      await router.navigateByUrl('/other');
      await settle(fixture);
      expect(router.url).toBe('/other');
    });
  });

  describe('deletion', () => {
    it('announces when a delete write is in progress', async () => {
      const response = new Subject<void>();
      const remove: TagsService['remove'] = vi.fn(() => response);
      const { fixture, root, rowAction } = setup(() => of(EVERYTHING), { remove });

      await openRowMenu(fixture, rowAction(1)!);
      overlayButton('Delete').click();
      await settle(fixture);
      button(root(), 'Delete').click();
      fixture.detectChanges();

      expect(root().querySelector('[aria-atomic="true"]')?.textContent).toContain('Deleting Tag…');

      response.next();
      response.complete();
    });

    it('states the consequence, focuses safe Cancel first, and restores the row action on cancellation', async () => {
      const { fixture, root, rowAction } = setup(() => of(EVERYTHING));

      await openRowMenu(fixture, rowAction(1)!);
      overlayButton('Delete').click();
      await settle(fixture);

      expect(root().textContent).toContain(
        'It will be removed from every Transaction carrying it. This can’t be undone.',
      );
      expect(document.activeElement).toBe(button(root(), 'Cancel'));
      button(root(), 'Cancel').click();
      await settle(fixture);
      expect(document.activeElement).toBe(rowAction(1));
    });

    it('deletes after confirmation, re-reads, then focuses the next row action', async () => {
      const remove: TagsService['remove'] = vi.fn(() => of(undefined));
      let attempt = 0;
      const readAll: ReadTags = vi.fn(() => {
        attempt += 1;
        return of(attempt === 1 ? EVERYTHING : [HOLIDAY, WORK]);
      });
      const { fixture, root, rowAction, rowNames } = setup(readAll, { remove });

      await openRowMenu(fixture, rowAction(1)!);
      overlayButton('Delete').click();
      await settle(fixture);
      button(root(), 'Delete').click();
      await settle(fixture);

      expect(remove).toHaveBeenCalledWith(1);
      expect(readAll).toHaveBeenCalledTimes(2);
      expect(rowNames()).not.toContain('groceries');
      expect(document.activeElement).toBe(rowAction(2));
    });

    it('focuses the Tags heading after deleting the last visible Tag', async () => {
      const onlyTag = tag(7, 'only tag');
      let readCount = 0;
      const readAll: ReadTags = vi.fn(() => {
        readCount += 1;
        return of(readCount === 1 ? [onlyTag] : []);
      });
      const remove: TagsService['remove'] = vi.fn(() => of(undefined));
      const { fixture, root, rowAction } = setup(readAll, { remove });

      await openRowMenu(fixture, rowAction(7)!);
      overlayButton('Delete').click();
      await settle(fixture);
      button(root(), 'Delete').click();
      await settle(fixture);

      expect(root().querySelector('ul > li')).toBeNull();
      expect(document.activeElement).toBe(root().querySelector('h1'));
    });

    it('treats a delete transport failure as uncertain until a read-only check', async () => {
      const remove: TagsService['remove'] = vi.fn(() => throwError(() => new TagWriteOutcomeUncertainError()));
      const readAll: ReadTags = vi.fn(() => of(EVERYTHING));
      const { fixture, root, rowAction, rowNames } = setup(readAll, { remove });
      await openRowMenu(fixture, rowAction(1)!);
      overlayButton('Delete').click();
      await settle(fixture);

      button(root(), 'Delete').click();
      await settle(fixture);

      expect(remove).toHaveBeenCalledTimes(1);
      expect(root().textContent).toContain('couldn’t confirm whether your Tag change went through');
      expect(rowNames()).toContain('groceries');
      expect(root().textContent).not.toContain('Try again');

      button(root(), 'Refresh tags').click();
      await settle(fixture);

      expect(remove).toHaveBeenCalledTimes(1);
      expect(rowNames()).toContain('groceries');
      expect(rowAction(1)?.disabled).toBe(false);
    });

    it('requires a read-only check after a server error without replaying the delete', async () => {
      const remove: TagsService['remove'] = vi.fn(() => throwError(() => new TagWriteOutcomeUncertainError()));
      const { fixture, root, rowAction, rowNames } = setup(() => of(EVERYTHING), { remove });

      await openRowMenu(fixture, rowAction(1)!);
      overlayButton('Delete').click();
      await settle(fixture);
      button(root(), 'Delete').click();
      await settle(fixture);

      expect(root().textContent).toContain('couldn’t confirm whether your Tag change went through');
      expect(rowNames()).toContain('groceries');
      expect(root().textContent).not.toContain('Try again');

      button(root(), 'Refresh tags').click();
      await settle(fixture);

      expect(remove).toHaveBeenCalledTimes(1);
      expect(rowNames()).toContain('groceries');
    });
  });
});
