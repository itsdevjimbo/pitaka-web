import { Component, inject, linkedSignal, output, signal } from '@angular/core';
import {
  form,
  FormField,
  maxLength,
  min,
  required,
  submit,
} from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { firstValueFrom } from 'rxjs';
import { partitionServerError, ServerErrorControls } from '@/app/core/forms';
import {
  Account,
  ACCOUNT_NAME_MAX,
  ACCOUNT_TYPES,
  AccountType,
  NewAccount,
} from '../data/account';
import { AccountsService } from '../data/accounts.service';

/** The banner line for a create that failed before it could be attributed. */
const COULD_NOT_CREATE =
  'Something went wrong creating your account. Please try again.';

/** The five types, as ordered options for the picker. */
const TYPE_OPTIONS = (Object.keys(ACCOUNT_TYPES) as AccountType[]).map(
  (value) => ({ value, label: ACCOUNT_TYPES[value].label })
);

/** `type` starts unset so the picker has no default the person didn't choose. */
type NewAccountModel = {
  name: string;
  type: AccountType | '';
  initialBalance: number;
};

/**
 * The "add an Account" form: a name, a type, and a starting balance (zero is
 * valid — an Account about to be funded). It owns only the form; the parent
 * decides where the created Account lands and closes the panel.
 *
 * A starting balance is an amount the person *enters*, so it is constrained to
 * zero or more (ADR 0005): only a derived running balance may be negative. A
 * duplicate name comes back from `AccountsService.create` already filed as a
 * `name` field error, so it surfaces under the field like any other. The submit
 * button is disabled while a request is in flight, and `submit()` itself refuses
 * re-entry, so an impatient double-click cannot send it twice.
 */
@Component({
  selector: 'accounts-new-account-form',
  templateUrl: './new-account-form.html',
  imports: [
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
    FormField,
  ],
})
export class NewAccountForm {
  // Dependencies
  private service = inject(AccountsService);

  // Outputs
  readonly created = output<Account>();
  readonly cancelled = output<void>();

  // State
  protected readonly typeOptions = TYPE_OPTIONS;

  protected readonly model = signal<NewAccountModel>({
    name: '',
    type: '',
    initialBalance: 0,
  });

  protected readonly accountForm = form(this.model, (form) => {
    required(form.name, { message: 'You must enter a name' });
    maxLength(form.name, ACCOUNT_NAME_MAX, {
      message: `The name must be ${ACCOUNT_NAME_MAX} characters or fewer`,
    });
    required(form.type, { message: 'You must choose a type' });
    min(form.initialBalance, 0, {
      message: 'The starting balance cannot be negative',
    });
  });

  protected readonly submitting = signal(false);

  /**
   * The form-level banner. Linked to the model so any edit clears it: a message
   * about values the person has since changed is worse than none.
   */
  protected readonly errorMessage = linkedSignal<NewAccountModel, string | null>({
    source: this.model,
    computation: () => null,
  });

  save(event: Event): void {
    event.preventDefault();

    submit(this.accountForm, {
      action: async () => {
        this.submitting.set(true);
        this.errorMessage.set(null);

        try {
          const { name, type, initialBalance } = this.model();
          const created = await firstValueFrom(
            this.service.create({
              name: name.trim(),
              // `required(form.type)` has already ruled out the empty option.
              type: type as AccountType,
              initialBalance,
            } satisfies NewAccount)
          );
          this.created.emit(created);
          return undefined;
        } catch (error) {
          const { boundErrors, bannerMessage } = partitionServerError(
            error,
            this.serverErrorControls(),
            COULD_NOT_CREATE
          );
          if (boundErrors.length > 0) {
            this.accountForm().markAsTouched();
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

  /**
   * The controls a server-blamed field can bind onto. The interceptor has
   * camelCased the PascalCase `nameof(...)` keys, and `AccountsService.create`
   * files the duplicate-name 409 under `name`, so both line up here.
   */
  private serverErrorControls(): ServerErrorControls {
    return {
      name: this.accountForm.name,
      type: this.accountForm.type,
    };
  }
}
