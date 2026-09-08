import { Category } from './category';

/**
 * The one exception to the active-only rule the four filing pickers follow
 * (#108). A form that records or narrows something fresh offers active
 * Categories only — but a form *editing a record that already points at a
 * Category* must keep that saved Category selectable even after it has been
 * retired. Dropping it silently would let the picker's filter rewrite the
 * person's filing to blank on the next save, and the API catches none of that:
 * it accepts a retired Category on a write with no error (#98), so this client
 * narrowing is the only guard.
 *
 * Given `options` — the active Categories the picker would otherwise show,
 * already narrowed by kind — this appends the record's saved Category at the
 * tail when every one of these holds:
 *
 * - the record has a saved Category (`savedId` is not `null`);
 * - the picker's current selection is still that saved value — the exception is
 *   pinned to the record's saved value, not the form's current selection, so
 *   once the person deliberately picks something else the retired Category
 *   leaves the options (reconsidering means cancelling the dialog);
 * - `options` does not already contain it;
 * - it resolves in `all` — the cached whole-set reader (`CategoriesService.all`,
 *   #106). Retiredness is read from `all`, never inferred from being absent
 *   from `options`, which silently becomes wrong the first time `options`
 *   narrows for some other reason (ADR 0017).
 *
 * The appended Category keeps its own `isActive`, so a caller badges it
 * `Retired` off that flag; an `options` list is active-only, so the tail entry
 * is the only one that can carry the badge.
 *
 * This generalises `AdjustBudgetForm`'s original re-add of a Budget's current
 * Category "so a prefilled value is never silently dropped to blank" — same
 * instinct, now stated as the rule, resolved through `all` rather than the
 * active list, and given the badge it was missing.
 */
export function keepSavedFilingCategory(
  options: readonly Category[],
  all: readonly Category[],
  savedId: number | null,
  selectedId: number | null
): Category[] {
  if (
    savedId === null ||
    savedId !== selectedId ||
    options.some((category) => category.id === savedId)
  ) {
    return [...options];
  }
  const saved = all.find((category) => category.id === savedId);
  return saved ? [...options, saved] : [...options];
}
