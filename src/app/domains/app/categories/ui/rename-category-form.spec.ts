import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ApiError } from '@/app/core/api';
import { provideIcons } from '@/app/core/icons';
import { CategoriesService } from '../data/categories.service';
import { Category } from '../data/category';
import { RenameCategoryForm } from './rename-category-form';

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
      providers: [provideIcons(), { provide: CategoriesService, useValue: { rename } }],
    });

    const fixture = TestBed.createComponent(RenameCategoryForm);
    fixture.componentRef.setInput('category', GROCERIES);
    fixture.detectChanges();
    return { fixture };
  }

  async function submitAndSettle(fixture: ComponentFixture<RenameCategoryForm>) {
    (fixture.nativeElement.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function nameInput(fixture: ComponentFixture<RenameCategoryForm>) {
    return fixture.nativeElement.querySelector('#rename-category-name') as HTMLInputElement;
  }

  function enterName(fixture: ComponentFixture<RenameCategoryForm>, value: string) {
    const input = nameInput(fixture);
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function text(fixture: ComponentFixture<RenameCategoryForm>) {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  it('starts pre-filled with the current name', () => {
    const { fixture } = setup(() => of(GROCERIES));

    expect(nameInput(fixture).value).toBe('Groceries');
  });

  it('sends the trimmed name and emits the renamed Category', async () => {
    const rename = vi.fn((_id: number, _name: string) => of({ ...GROCERIES, name: 'Food' }));
    const { fixture } = setup(rename as unknown as CategoriesService['rename']);
    const emitted: Category[] = [];
    fixture.componentInstance.renamed.subscribe((category) => emitted.push(category));

    enterName(fixture, '  Food  ');
    await submitAndSettle(fixture);

    expect(rename).toHaveBeenCalledWith(9, 'Food');
    expect(emitted).toEqual([{ ...GROCERIES, name: 'Food' }]);
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
  });

  it('shows a 409 as the cross-kind duplicate message on the name control, banner empty', async () => {
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
  });

  it('shows a failure it cannot attribute as a banner and binds nothing', async () => {
    const { fixture } = setup(() => throwError(() => new Error('offline')));

    enterName(fixture, 'Food');
    await submitAndSettle(fixture);

    expect(text(fixture)).toContain('Something went wrong renaming your category. Please try again.');
    expect(text(fixture)).not.toContain('You must enter a name');
  });
});
