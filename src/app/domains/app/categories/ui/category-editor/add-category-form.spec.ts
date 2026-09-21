import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { provideIcons } from '@/app/core/icons';
import { CategoriesService } from '../../data/categories.service';
import { Category, CATEGORY_NAME_MAX, CategoryKind } from '../../data/category';
import { AddCategoryForm } from './add-category-form';

const CREATED: Category = {
  id: 12,
  name: 'Holidays',
  kind: 'expense',
  isActive: true,
  isDefault: false,
};

describe('AddCategoryForm', () => {
  function setup(create: CategoriesService['create'], kind: CategoryKind = 'expense') {
    TestBed.configureTestingModule({
      imports: [AddCategoryForm],
      providers: [provideIcons(), { provide: CategoriesService, useValue: { create } }],
    });

    const fixture = TestBed.createComponent(AddCategoryForm);
    fixture.componentRef.setInput('kind', kind);
    fixture.detectChanges();
    return { fixture };
  }

  async function submitAndSettle(fixture: ComponentFixture<AddCategoryForm>) {
    (fixture.nativeElement.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function nameInput(fixture: ComponentFixture<AddCategoryForm>) {
    return fixture.nativeElement.querySelector('#add-category-name') as HTMLInputElement;
  }

  function enterName(fixture: ComponentFixture<AddCategoryForm>, value: string) {
    const input = nameInput(fixture);
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function text(fixture: ComponentFixture<AddCategoryForm>) {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  it('starts empty', () => {
    const { fixture } = setup(() => of(CREATED));

    expect(nameInput(fixture).value).toBe('');
  });

  it('creates with the pane’s kind, sends the trimmed name, and emits the row', async () => {
    const create = vi.fn((_category) => of(CREATED));
    const { fixture } = setup(create as unknown as CategoriesService['create'], 'income');
    const emitted: Category[] = [];
    fixture.componentInstance.created.subscribe((category) => emitted.push(category));

    enterName(fixture, '  Holidays  ');
    await submitAndSettle(fixture);

    expect(create).toHaveBeenCalledWith({ name: 'Holidays', kind: 'income' });
    expect(emitted).toEqual([CREATED]);
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
  });

  it('blocks a submission with no name and never calls the service', async () => {
    const create = vi.fn();
    const { fixture } = setup(create as unknown as CategoriesService['create']);

    await submitAndSettle(fixture);

    expect(text(fixture)).toContain('You must enter a name');
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses a name over the maximum length', async () => {
    const create = vi.fn();
    const { fixture } = setup(create as unknown as CategoriesService['create']);

    enterName(fixture, 'x'.repeat(CATEGORY_NAME_MAX + 1));
    await submitAndSettle(fixture);

    expect(text(fixture)).toContain(`The name must be ${CATEGORY_NAME_MAX} characters or fewer`);
    expect(create).not.toHaveBeenCalled();
  });

  it('shows a 409 as the cross-kind duplicate message on the name control, banner empty, text kept', async () => {
    const { fixture } = setup(() =>
      throwError(
        () =>
          new ApiError('A category with this name already exists.', 409, {
            name: ['A category with this name already exists.'],
          }),
      ),
    );

    enterName(fixture, 'Gifts');
    await submitAndSettle(fixture);

    expect(text(fixture)).toContain(
      'You already have a category called “Gifts”. A name can only be used once, whether it files income or expenses.',
    );
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
    expect(nameInput(fixture).value).toBe('Gifts');
  });

  it('shows a failure it cannot attribute as a banner and binds nothing, keeping the text', async () => {
    const { fixture } = setup(() => throwError(() => new Error('offline')));

    enterName(fixture, 'Brokerage');
    await submitAndSettle(fixture);

    expect(text(fixture)).toContain('Something went wrong adding the category. Please try again.');
    expect(nameInput(fixture).value).toBe('Brokerage');
  });

  it('sends exactly one request when submitted twice in a row', async () => {
    const inFlight = new Subject<Category>();
    const create = vi.fn(() => inFlight.asObservable());
    const { fixture } = setup(create as unknown as CategoriesService['create']);

    enterName(fixture, 'Holidays');
    const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit'));
    form.dispatchEvent(new Event('submit'));
    await fixture.whenStable();

    expect(create).toHaveBeenCalledTimes(1);
  });
});
