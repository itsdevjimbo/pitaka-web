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
import { Category, CATEGORY_NAME_MAX } from '../data/category';
import { duplicateNameBinding } from './duplicate-name';

/** The banner line for a rename that failed before it could be attributed. */
const COULD_NOT_RENAME =
  'Something went wrong renaming your category. Please try again.';

/**
 * The inline "rename this Category" editor: one field, pre-filled with the
 * current name. It owns only the edit; the parent re-reads the list on success
 * so the new name lands everywhere and the row re-sorts (#107).
 *
 * There is **no kind control**. A Category's kind is settled at creation and
 * `PUT` will not accept it, so a disabled toggle would be a dead control the
 * person reasons about; the dialog title states the kind instead ("Rename
 * expense category"), which a row reached by scrolling needs anyway because its
 * pane heading may be off screen.
 *
 * A name already in use comes back from `CategoriesService.rename` as a `409`,
 * re-worded here in the cross-kind phrasing {@link duplicateNameBinding} carries
 * and surfaced under the field. These endpoints carry no optimistic-
 * concurrency rejection (ADR 0017), so there is no `CategoryModifiedError`
 * branch — anything else is a banner, and the dialog stays open with what was
 * typed.
 */
@Component({
  selector: 'categories-rename-category-form',
  templateUrl: './rename-category-form.html',
  imports: [MatFormFieldModule, MatInputModule, MatButtonModule, FormField],
})
export class RenameCategoryForm {
  // Dependencies
  private service = inject(CategoriesService);

  // Inputs
  readonly category = input.required<Category>();

  // Outputs
  readonly renamed = output<Category>();
  readonly cancelled = output<void>();

  // State
  protected readonly model = linkedSignal<{ name: string }>(() => ({
    name: this.category().name,
  }));

  protected readonly renameForm = form(this.model, (path) => {
    required(path.name, { message: 'You must enter a name' });
    maxLength(path.name, CATEGORY_NAME_MAX, {
      message: `The name must be ${CATEGORY_NAME_MAX} characters or fewer`,
    });
  });

  protected readonly submitting = signal(false);

  /** The banner. Linked to the model so any edit clears a now-stale message. */
  protected readonly errorMessage = linkedSignal<
    { name: string },
    string | null
  >({
    source: this.model,
    computation: () => null,
  });

  save(event: Event): void {
    event.preventDefault();

    submit(this.renameForm, {
      action: async () => {
        this.submitting.set(true);
        this.errorMessage.set(null);

        try {
          const renamed = await firstValueFrom(
            this.service.rename(this.category().id, this.model().name.trim())
          );
          this.renamed.emit(renamed);
          return undefined;
        } catch (error) {
          const conflict = duplicateNameBinding(
            error,
            this.renameForm.name,
            this.model().name.trim()
          );
          if (conflict) {
            this.renameForm().markAsTouched();
            return conflict;
          }
          const { boundErrors, bannerMessage } = partitionServerError(
            error,
            { name: this.renameForm.name },
            COULD_NOT_RENAME
          );
          if (boundErrors.length > 0) {
            this.renameForm().markAsTouched();
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
