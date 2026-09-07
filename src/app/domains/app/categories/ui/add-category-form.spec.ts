import { OutputEmitterRef, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FieldTree } from '@angular/forms/signals';
import { of, Subject, throwError } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { provideIcons } from '@/app/core/icons';
import { CategoriesService } from '../data/categories.service';
import { Category, CATEGORY_NAME_MAX, CategoryKind } from '../data/category';
import { AddCategoryForm } from './add-category-form';

/** The slice of the component the tests reach into. */
type AddInternals = {
  model: WritableSignal<{ name: string }>;
  addForm: { name: FieldTree<string> };
  errorMessage: () => string | null;
  created: OutputEmitterRef<Category>;
  save(event: Event): void;
};

const CREATED: Category = {
  id: 12,
  name: 'Holidays',
  kind: 'expense',
  isActive: true,
  isDefault: false,
};

describe('AddCategoryForm', () => {
  function setup(
    create: CategoriesService['create'],
    kind: CategoryKind = 'expense'
  ) {
    TestBed.configureTestingModule({
      imports: [AddCategoryForm],
      providers: [
        provideIcons(),
        { provide: CategoriesService, useValue: { create } },
      ],
    });

    const fixture = TestBed.createComponent(AddCategoryForm);
    fixture.componentRef.setInput('kind', kind);
    const cmp = fixture.componentInstance as unknown as AddInternals;
    fixture.detectChanges();
    return { fixture, cmp };
  }

  async function submitAndSettle(
    fixture: { whenStable: () => Promise<unknown> },
    cmp: AddInternals
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

  it('starts empty', () => {
    const { cmp } = setup(() => of(CREATED));

    expect(cmp.model().name).toBe('');
  });

  it('creates with the pane’s kind, sends the trimmed name, and emits the row', async () => {
    const create = vi.fn((_category) => of(CREATED));
    const { fixture, cmp } = setup(
      create as unknown as CategoriesService['create'],
      'income'
    );
    const emitted: Category[] = [];
    cmp.created.subscribe((category) => emitted.push(category));

    cmp.model.set({ name: '  Holidays  ' });
    await submitAndSettle(fixture, cmp);

    expect(create).toHaveBeenCalledWith({ name: 'Holidays', kind: 'income' });
    expect(emitted).toEqual([CREATED]);
    expect(cmp.errorMessage()).toBeNull();
  });

  it('blocks a submission with no name and never calls the service', async () => {
    const create = vi.fn();
    const { fixture, cmp } = setup(
      create as unknown as CategoriesService['create']
    );

    cmp.model.set({ name: '' });
    await submitAndSettle(fixture, cmp);

    expect(messagesOn(cmp.addForm.name)).toContain('You must enter a name');
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses a name over the maximum length', async () => {
    const create = vi.fn();
    const { fixture, cmp } = setup(
      create as unknown as CategoriesService['create']
    );

    cmp.model.set({ name: 'x'.repeat(CATEGORY_NAME_MAX + 1) });
    await submitAndSettle(fixture, cmp);

    expect(messagesOn(cmp.addForm.name)).toContain(
      `The name must be ${CATEGORY_NAME_MAX} characters or fewer`
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('shows a 409 as the cross-kind duplicate message on the name control, banner empty, text kept', async () => {
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

    expect(messagesOn(cmp.addForm.name)).toContain(
      'You already have a category called “Gifts”. A name can only be used once, whether it files income or expenses.'
    );
    expect(cmp.errorMessage()).toBeNull();
    expect(cmp.model().name).toBe('Gifts');
  });

  it('shows a failure it cannot attribute as a banner and binds nothing, keeping the text', async () => {
    const { fixture, cmp } = setup(() => throwError(() => new Error('offline')));

    cmp.model.set({ name: 'Brokerage' });
    await submitAndSettle(fixture, cmp);

    expect(cmp.errorMessage()).toBe(
      'Something went wrong adding the category. Please try again.'
    );
    expect(cmp.addForm.name().errors()).toEqual([]);
    expect(cmp.model().name).toBe('Brokerage');
  });

  it('sends exactly one request when submitted twice in a row', async () => {
    const inFlight = new Subject<Category>();
    const create = vi.fn(() => inFlight.asObservable());
    const { fixture, cmp } = setup(
      create as unknown as CategoriesService['create']
    );

    cmp.model.set({ name: 'Holidays' });
    cmp.save(new Event('submit'));
    cmp.save(new Event('submit'));
    await fixture.whenStable();

    expect(create).toHaveBeenCalledTimes(1);
  });
});
