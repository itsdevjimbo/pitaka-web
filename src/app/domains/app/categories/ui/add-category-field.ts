import {
  Component,
  ElementRef,
  inject,
  input,
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
import { MatIconModule } from '@angular/material/icon';
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

/** The fallback line when a create fails with nothing to attribute. */
const COULD_NOT_ADD =
  'Something went wrong adding the category. Please try again.';

/**
 * The create control for one Categories pane: a single name field with the
 * pane's kind already settled, pinned at the top of the pane. A pane *is* a
 * kind, so there is no income-or-expense question to ask and no dialog to open
 * (#107) — unlike an Account, which needs a type and a starting balance.
 *
 * Everything it has to say, it says under the field: a duplicate name in the
 * cross-kind wording {@link duplicateNameBinding} carries, a length or
 * required failure, or — folded onto the field rather than lost — anything the
 * server could not attribute. There is no banner and no snackbar: the
 * duplicate-name message only reads right next to the field being judged. A
 * successful create emits the row, clears the field, resets its touched/dirty
 * state so the emptied `required` field does not flash "Enter a name", and drops
 * focus so the pane is at rest rather than inviting the next name; a failed one
 * keeps what was typed and the cursor where it was. `submit()` refuses re-entry
 * and the button is disabled in flight, so an impatient double-press sends one
 * request.
 */
@Component({
  selector: 'categories-add-category-field',
  templateUrl: './add-category-field.html',
  imports: [
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    FormField,
  ],
})
export class AddCategoryField {
  // Dependencies
  private service = inject(CategoriesService);
  private host = inject<ElementRef<HTMLElement>>(ElementRef);

  // Inputs
  readonly kind = input.required<CategoryKind>();

  // Outputs
  readonly created = output<Category>();

  // State
  protected readonly model = signal<{ name: string }>({ name: '' });

  protected readonly addForm = form(this.model, (path) => {
    required(path.name, { message: 'Enter a name' });
    maxLength(path.name, CATEGORY_NAME_MAX, {
      message: `The name must be ${CATEGORY_NAME_MAX} characters or fewer`,
    });
  });

  protected readonly submitting = signal(false);

  add(event: Event): void {
    event.preventDefault();

    submit(this.addForm, {
      action: async () => {
        this.submitting.set(true);

        try {
          const created = await firstValueFrom(
            this.service.create({
              name: this.model().name.trim(),
              kind: this.kind(),
            } satisfies NewCategory)
          );
          this.created.emit(created);
          this.model.set({ name: '' });
          // Clear the value's touched/dirty trail so the now-empty `required`
          // field does not immediately show "Enter a name".
          this.addForm().reset();
          // Let the pane rest: drop focus off whichever control here submitted —
          // the field on an Enter, the add button on a click — rather than
          // holding the cursor for the next name.
          this.blurWithin();
          return undefined;
        } catch (error) {
          this.addForm().markAsTouched();

          const conflict = duplicateNameBinding(
            error,
            this.addForm.name,
            this.model().name.trim()
          );
          if (conflict) {
            return conflict;
          }

          // This control has no banner, so a failure the server could not pin
          // to the name field folds onto it too rather than vanishing.
          const { boundErrors, bannerMessage } = partitionServerError(
            error,
            { name: this.addForm.name },
            COULD_NOT_ADD
          );
          if (boundErrors.length > 0) {
            return boundErrors;
          }
          return bannerMessage === null
            ? undefined
            : [
                {
                  fieldTree: this.addForm.name,
                  kind: 'server' as const,
                  message: bannerMessage,
                },
              ];
        } finally {
          this.submitting.set(false);
        }
      },
    });
  }

  /** Blur the focused element if it belongs to this field — a no-op otherwise. */
  private blurWithin(): void {
    const focused = document.activeElement;
    if (
      focused instanceof HTMLElement &&
      this.host.nativeElement.contains(focused)
    ) {
      focused.blur();
    }
  }
}
