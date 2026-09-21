/** Move focus after Signal Forms reveals touched-field errors. */
export function focusFirstInvalidField(form: HTMLFormElement): void {
  queueMicrotask(() => {
    const control = form.querySelector<HTMLElement>(
      'input:invalid, textarea:invalid, select:invalid, [aria-invalid="true"], .mat-form-field-invalid input, .mat-form-field-invalid textarea, .mat-form-field-invalid [role="combobox"]',
    );
    control?.focus();
  });
}
