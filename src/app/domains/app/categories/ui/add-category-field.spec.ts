import { OutputEmitterRef, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FieldTree } from '@angular/forms/signals';
import { of, Subject, throwError } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { provideIcons } from '@/app/core/icons';
import { CategoriesService } from '../data/categories.service';
import { Category, CATEGORY_NAME_MAX, CategoryKind } from '../data/category';
import { AddCategoryField } from './add-category-field';

/** The slice of the component the tests reach into. */
type AddInternals = {
  model: WritableSignal<{ name: string }>;
  addForm: { name: FieldTree<string> };
  created: OutputEmitterRef<Category>;
  add(event: Event): void;
};

const CREATED: Category = {
  id: 12,
  name: 'Holidays',
  kind: 'expense',
  isActive: true,
  isDefault: false,
};

describe('AddCategoryField', () => {
  function setup(
    create: CategoriesService['create'],
    kind: CategoryKind = 'expense'
  ) {
    TestBed.configureTestingModule({
      imports: [AddCategoryField],
      providers: [
        provideIcons(),
        { provide: CategoriesService, useValue: { create } },
      ],
    });

    const fixture = TestBed.createComponent(AddCategoryField);
    fixture.componentRef.setInput('kind', kind);
    const cmp = fixture.componentInstance as unknown as AddInternals;
    fixture.detectChanges();
    return { fixture, cmp };
  }

  async function submitAndSettle(
    fixture: { whenStable: () => Promise<unknown> },
    cmp: AddInternals
  ) {
    cmp.add(new Event('submit'));
    await fixture.whenStable();
    await fixture.whenStable();
  }

  function messagesOn(field: FieldTree<unknown>) {
    return field()
      .errors()
      .map((error) => error.message);
  }

  it('creates with the pane’s kind, sends the trimmed name, emits the row, and clears the field', async () => {
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
    expect(cmp.model().name).toBe('');
  });

  it('blocks a submission with no name and never calls the service', async () => {
    const create = vi.fn();
    const { fixture, cmp } = setup(
      create as unknown as CategoriesService['create']
    );

    cmp.model.set({ name: '' });
    await submitAndSettle(fixture, cmp);

    expect(messagesOn(cmp.addForm.name)).toContain('Enter a name');
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

  it('shows a 409 as the cross-kind duplicate message under the field, keeping the typed text', async () => {
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
    expect(cmp.model().name).toBe('Gifts');
  });

  it('folds a failure it cannot attribute onto the field rather than losing it', async () => {
    const { fixture, cmp } = setup(() => throwError(() => new Error('offline')));

    cmp.model.set({ name: 'Brokerage' });
    await submitAndSettle(fixture, cmp);

    expect(messagesOn(cmp.addForm.name)).toContain(
      'Something went wrong adding the category. Please try again.'
    );
    expect(cmp.model().name).toBe('Brokerage');
  });

  it('sends exactly one request when submitted twice in a row', async () => {
    const inFlight = new Subject<Category>();
    const create = vi.fn(() => inFlight.asObservable());
    const { fixture, cmp } = setup(
      create as unknown as CategoriesService['create']
    );

    cmp.model.set({ name: 'Holidays' });
    cmp.add(new Event('submit'));
    cmp.add(new Event('submit'));
    await fixture.whenStable();

    expect(create).toHaveBeenCalledTimes(1);
  });
});
