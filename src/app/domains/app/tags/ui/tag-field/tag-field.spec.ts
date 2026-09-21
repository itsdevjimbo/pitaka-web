import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { form, FormField } from '@angular/forms/signals';
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

@Component({
  template: `
    <tags-tag-field [formField]="tagForm.tags" />
  `,
  imports: [FormField, TagField],
})
class TagFieldHost {
  readonly model = signal<{ tags: readonly Tag[] }>({ tags: [] });
  readonly tagForm = form(this.model);
}

describe('TagField', () => {
  const overlay = withOverlayContainer();

  function setup(service: Partial<TagsService> = {}, initial: readonly Tag[] = []) {
    const create = service.create ?? vi.fn();
    const all = service.all ?? (() => of<Tag[]>([GROCERIES, WORK]));
    const readAll = service.readAll ?? all;
    TestBed.configureTestingModule({
      imports: [TagFieldHost],
      providers: [
        provideIcons(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        { provide: TagsService, useValue: { all, readAll, create } },
      ],
    });
    const fixture = TestBed.createComponent(TagFieldHost);
    fixture.componentInstance.model.set({ tags: initial });
    fixture.detectChanges();
    return {
      fixture,
      create,
      input: () => fixture.nativeElement.querySelector('input') as HTMLInputElement,
      host: () => fixture.nativeElement as HTMLElement,
    };
  }

  async function type(fixture: ComponentFixture<TagFieldHost>, input: HTMLInputElement, value: string) {
    input.value = value;
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('focusin'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const KEY_CODES: Record<string, number> = { Enter: 13, ArrowDown: 40, Backspace: 8 };
  function press(input: HTMLInputElement, key: string) {
    const event = new KeyboardEvent('keydown', { key, bubbles: true });
    Object.defineProperty(event, 'keyCode', { get: () => KEY_CODES[key] ?? 0 });
    input.dispatchEvent(event);
  }

  function chips(host: HTMLElement) {
    return Array.from(host.querySelectorAll('mat-chip-row')).map(
      (chip) => chip.textContent?.replace('cancel', '').trim() ?? '',
    );
  }

  function currentOptions() {
    const panel = Array.from(overlay().querySelectorAll<HTMLElement>('.mat-mdc-autocomplete-panel')).at(-1);
    return Array.from(panel?.querySelectorAll('mat-option') ?? []).map((option) => option.textContent?.trim() ?? '');
  }

  it('binds its chips to a signal-form field', () => {
    const { fixture, host } = setup({}, [GROCERIES]);
    (host().querySelector('[matChipRemove]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.componentInstance.model().tags).toEqual([]);
  });

  it('attaches the highlighted option rather than creating the raw prefix', async () => {
    const create = vi.fn(() => of({ id: 99, name: 'gro' }));
    const { fixture, input, host } = setup({ all: () => of([GROCERIES]), create });
    await type(fixture, input(), 'gro');
    press(input(), 'ArrowDown');
    press(input(), 'Enter');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(chips(host())).toEqual(['groceries']);
    expect(create).not.toHaveBeenCalled();
  });

  it('creates from raw text when Enter lands with nothing highlighted', async () => {
    const created: Tag = { id: 5, name: 'holiday' };
    const create = vi.fn(() => of(created));
    const { fixture, input, host } = setup({ all: () => of([GROCERIES]), create });
    await type(fixture, input(), 'holiday');
    press(input(), 'Enter');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(create).toHaveBeenCalledWith('holiday');
    expect(chips(host())).toEqual(['holiday']);
  });

  it('offers Create only when nothing matches', async () => {
    const { fixture, input } = setup({ all: () => of([GROCERIES]) });
    await type(fixture, input(), 'gro');
    expect(currentOptions().some((option) => option.includes('Create'))).toBe(false);
    await type(fixture, input(), 'holiday');
    expect(currentOptions()).toContain('Create “holiday”');
  });

  it('attaches an existing Tag case-insensitively with no create request', async () => {
    const create = vi.fn();
    const { fixture, input, host } = setup({ all: () => of([GROCERIES]), create });
    await type(fixture, input(), 'Groceries');
    press(input(), 'Enter');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(chips(host())).toEqual(['groceries']);
    expect(create).not.toHaveBeenCalled();
    expect(host().querySelector('mat-error')).toBeNull();
  });

  it('attaches the cold reread result after a create races a 409', async () => {
    const holiday: Tag = { id: 7, name: 'holiday' };
    const create = vi.fn(() => throwError(() => new ApiError('taken', 409, { name: ['taken'] })));
    const readAll = vi.fn(() => of([GROCERIES, holiday]));
    const { fixture, input, host } = setup({ all: () => of([GROCERIES]), readAll, create });
    await type(fixture, input(), 'holiday');
    press(input(), 'Enter');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(create).toHaveBeenCalledWith('holiday');
    expect(chips(host())).toEqual(['holiday']);
    expect(host().querySelector('mat-error')).toBeNull();
  });

  it('offers an inline-created Tag again after its chip is removed', async () => {
    const created: Tag = { id: 5, name: 'holiday' };
    const { fixture, input, host } = setup({
      all: () => of([GROCERIES]),
      create: () => of(created),
    });
    await type(fixture, input(), 'holiday');
    press(input(), 'Enter');
    await fixture.whenStable();
    fixture.detectChanges();
    (host().querySelector('[matChipRemove]') as HTMLButtonElement).click();
    fixture.detectChanges();
    await type(fixture, input(), 'hol');
    expect(currentOptions()).toContain('holiday');
  });

  it('removes a chip with its button and the last chip with Backspace on empty input', () => {
    const { fixture, input, host } = setup({}, [GROCERIES, WORK]);
    (host().querySelector('[matChipRemove]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(chips(host())).toEqual(['work']);
    press(input(), 'Backspace');
    fixture.detectChanges();
    expect(chips(host())).toEqual([]);
  });

  it('leaves chips alone on Backspace while the input has text', async () => {
    const { fixture, input, host } = setup({}, [GROCERIES]);
    await type(fixture, input(), 'gr');
    press(input(), 'Backspace');
    fixture.detectChanges();
    expect(chips(host())).toEqual(['groceries']);
  });

  it('says nothing extra when there are zero Tags', () => {
    const { host } = setup({ all: () => of<Tag[]>([]) });
    expect(host().querySelector('mat-hint')).toBeNull();
  });

  it('disables the field after a failed option fetch and keeps parent-seeded chips', () => {
    const { input, host } = setup({ all: () => throwError(() => new ApiError('nope', 500, {})) }, [GROCERIES]);
    expect(host().querySelector('mat-hint')?.textContent).toContain('couldn’t be loaded');
    expect(input().disabled).toBe(true);
    expect(chips(host())).toEqual(['groceries']);
  });
});
