import { OutputEmitterRef, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FieldTree } from '@angular/forms/signals';
import { of, throwError } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { provideIcons } from '@/app/core/icons';
import { CategoriesService } from '../data/categories.service';
import { Category } from '../data/category';
import { RenameCategoryForm } from './rename-category-form';

/** The slice of the component the tests reach into. */
type RenameInternals = {
  model: WritableSignal<{ name: string }>;
  renameForm: { name: FieldTree<string> };
  errorMessage: () => string | null;
  renamed: OutputEmitterRef<Category>;
  save(event: Event): void;
};

const GROCERIES: Category = {
  id: 9,
  name: 'Groceries',
  kind: 'expense',
  isActive: true,
  isDefault: false,
};

describe('RenameCategoryForm', () => {
  function setup(rename: CategoriesService['rename']) {
    TestBed.configureTestingModule({
      imports: [RenameCategoryForm],
      providers: [
        provideIcons(),
        { provide: CategoriesService, useValue: { rename } },
      ],
    });

    const fixture = TestBed.createComponent(RenameCategoryForm);
    fixture.componentRef.setInput('category', GROCERIES);
    const cmp = fixture.componentInstance as unknown as RenameInternals;
    fixture.detectChanges();
    return { fixture, cmp };
  }

  async function submitAndSettle(
    fixture: { whenStable: () => Promise<unknown> },
    cmp: RenameInternals
  ) {
    cmp.save(new Event('submit'));
    await fixture.whenStable();
    await fixture.whenStable();
  }

  function messagesOn(field: FieldTree<unknown>) {
    return field()
      .errors()
      .map((error) => error.message);
  }

  it('starts pre-filled with the current name', () => {
    const { cmp } = setup(() => of(GROCERIES));

    expect(cmp.model().name).toBe('Groceries');
  });

  it('sends the trimmed name and emits the renamed Category', async () => {
    const rename = vi.fn((_id: number, _name: string) =>
      of({ ...GROCERIES, name: 'Food' })
    );
    const { fixture, cmp } = setup(
      rename as unknown as CategoriesService['rename']
    );
    const emitted: Category[] = [];
    cmp.renamed.subscribe((category) => emitted.push(category));

    cmp.model.set({ name: '  Food  ' });
    await submitAndSettle(fixture, cmp);

    expect(rename).toHaveBeenCalledWith(9, 'Food');
    expect(emitted).toEqual([{ ...GROCERIES, name: 'Food' }]);
    expect(cmp.errorMessage()).toBeNull();
  });

  it('shows a 409 as the cross-kind duplicate message on the name control, banner empty', async () => {
    const { fixture, cmp } = setup(() =>
      throwError(
        () =>
          new ApiError('A category with this name already exists.', 409, {
            name: ['A category with this name already exists.'],
          })
      )
    );

    cmp.model.set({ name: 'Gifts' });
    await submitAndSettle(fixture, cmp);

    expect(messagesOn(cmp.renameForm.name)).toContain(
      'You already have a category called “Gifts”. A name can only be used once, whether it files income or expenses.'
    );
    expect(cmp.errorMessage()).toBeNull();
  });

  it('shows a failure it cannot attribute as a banner and binds nothing', async () => {
    const { fixture, cmp } = setup(() => throwError(() => new Error('offline')));

    cmp.model.set({ name: 'Food' });
    await submitAndSettle(fixture, cmp);

    expect(cmp.errorMessage()).toBe(
      'Something went wrong renaming your category. Please try again.'
    );
    expect(cmp.renameForm.name().errors()).toEqual([]);
  });
});
