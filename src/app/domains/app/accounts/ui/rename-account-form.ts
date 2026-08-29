import {
  Component,
  inject,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import { form, FormField, maxLength, required, submit } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { firstValueFrom } from 'rxjs';
import { partitionServerError, ServerErrorControls } from '@/app/core/forms';
import { Account, ACCOUNT_NAME_MAX } from '../data/account';
import { AccountModifiedError } from '../data/account-errors';
import { AccountsService } from '../data/accounts.service';

/** The banner line for a rename that failed before it could be attributed. */
const COULD_NOT_RENAME =
  'Something went wrong renaming your account. Please try again.';

/**
 * The inline "rename this Account" editor: one field, pre-filled with the
 * current name. It owns only the edit; the parent re-reads the list on success
 * so the new name lands everywhere it is shown (ADR 0006).
 *
 * A name already in use comes back from `AccountsService.rename` filed as a
 * `name` field error, so it surfaces under the field. A concurrency rejection —
 * the Account moved in another tab — comes back as an `AccountModifiedError`;
 * its own words go to the banner and the Save button stays, which is the retry.
 */
@Component({
  selector: 'accounts-rename-account-form',
  templateUrl: './rename-account-form.html',
  imports: [
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    FormField,
  ],
})
export class RenameAccountForm {
  // Dependencies
  private service = inject(AccountsService);

  // Inputs
  readonly account = input.required<Account>();

  // Outputs
  readonly renamed = output<Account>();
  readonly cancelled = output<void>();

  // State
  protected readonly model = linkedSignal<{ name: string }>(() => ({
    name: this.account().name,
  }));

  protected readonly renameForm = form(this.model, (form) => {
    required(form.name, { message: 'You must enter a name' });
    maxLength(form.name, ACCOUNT_NAME_MAX, {
      message: `The name must be ${ACCOUNT_NAME_MAX} characters or fewer`,
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

    submit(this.renameForm, {
      action: async () => {
        this.submitting.set(true);
        this.errorMessage.set(null);

        try {
          const renamed = await firstValueFrom(
            this.service.rename(this.account().id, this.model().name.trim())
          );
          this.renamed.emit(renamed);
          return undefined;
        } catch (error) {
          if (error instanceof AccountModifiedError) {
            this.errorMessage.set(error.message);
            return undefined;
          }
          const { boundErrors, bannerMessage } = partitionServerError(
            error,
            this.serverErrorControls(),
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

  /** The one control a server-blamed field can bind onto. */
  private serverErrorControls(): ServerErrorControls {
    return { name: this.renameForm.name };
  }
}
