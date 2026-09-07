import {
  Component,
  inject,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import {
  form,
  FormField,
  maxLength,
  required,
  submit,
} from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { firstValueFrom } from 'rxjs';
import { partitionServerError } from '@/app/core/forms';
import { CategoriesService } from '../data/categories.service';
import {
  Category,
  CATEGORY_NAME_MAX,
  CategoryKind,
  NewCategory,
} from '../data/category';
import { duplicateNameBinding } from './duplicate-name';

/** The banner line for a create that failed before it could be attributed. */
const COULD_NOT_ADD =
  'Something went wrong adding the category. Please try again.';

/**
 * The "add a Category" form: one name field, the kind already settled by the
 * pane whose *Add* button opened the dialog. There is **no kind control** — a
 * pane *is* a kind, `POST` takes the kind from that pane, and the dialog title
 * states it ("New expense category") so a person opening it from a scrolled pane
 * still knows which side they are filing. It owns only the form; the parent
 * re-reads the list on success so the created row lands in order (#107).
 *
 * A name already in use comes back from {@link CategoriesService.create} as a
 * `409`, re-worded here in the cross-kind phrasing {@link duplicateNameBinding}
 * carries and surfaced under the field. Anything the server cannot attribute is
 * a banner, and the dialog stays open with what was typed. The submit button is
 * disabled while a request is in flight and `submit()` refuses re-entry, so an
 * impatient double-click sends one request.
 */
@Component({
  selector: 'categories-add-category-form',
  templateUrl: './add-category-form.html',
  imports: [MatFormFieldModule, MatInputModule, MatButtonModule, FormField],
})
export class AddCategoryForm {
  // Dependencies
  private service = inject(CategoriesService);

  // Inputs
  readonly kind = input.required<CategoryKind>();

  // Outputs
  readonly created = output<Category>();
  readonly cancelled = output<void>();

  // State
  protected readonly model = signal<{ name: string }>({ name: '' });

  protected readonly addForm = form(this.model, (path) => {
    required(path.name, { message: 'You must enter a name' });
    maxLength(path.name, CATEGORY_NAME_MAX, {
      message: `The name must be ${CATEGORY_NAME_MAX} characters or fewer`,
    });
  });

  protected readonly submitting = signal(false);

  /** The banner. Linked to the model so any edit clears a now-stale message. */
  protected readonly errorMessage = linkedSignal<{ name: string }, string | null>({
    source: this.model,
    computation: () => null,
  });

  save(event: Event): void {
    event.preventDefault();

    submit(this.addForm, {
      action: async () => {
        this.submitting.set(true);
        this.errorMessage.set(null);

        try {
          const created = await firstValueFrom(
            this.service.create({
              name: this.model().name.trim(),
              kind: this.kind(),
            } satisfies NewCategory)
          );
          this.created.emit(created);
          return undefined;
        } catch (error) {
          const conflict = duplicateNameBinding(
            error,
            this.addForm.name,
            this.model().name.trim()
          );
          if (conflict) {
            this.addForm().markAsTouched();
            return conflict;
          }
          const { boundErrors, bannerMessage } = partitionServerError(
            error,
            { name: this.addForm.name },
            COULD_NOT_ADD
          );
          if (boundErrors.length > 0) {
            this.addForm().markAsTouched();
          }
          if (bannerMessage !== null) {
            this.errorMessage.set(bannerMessage);
          }
          return boundErrors.length > 0 ? boundErrors : undefined;
        } finally {
          this.submitting.set(false);
        }
      },
    });
  }

  protected cancel(): void {
    this.cancelled.emit();
  }
}
