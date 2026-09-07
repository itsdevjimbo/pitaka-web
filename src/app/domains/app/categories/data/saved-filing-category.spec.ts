import { Category } from './category';
import { keepSavedFilingCategory } from './saved-filing-category';

const cat = (
  id: number,
  over: Partial<Category> = {}
): Category => ({
  id,
  name: `Category ${id}`,
  kind: 'expense',
  isActive: true,
  isDefault: false,
  ...over,
});

const GROCERIES = cat(1);
const RENT = cat(3);
const HOLIDAYS_RETIRED = cat(9, { name: 'Holidays', isActive: false });
const SALARY_INCOME = cat(2, { name: 'Salary', kind: 'income' });

const ACTIVE_EXPENSES = [GROCERIES, RENT];
const ALL = [GROCERIES, RENT, HOLIDAYS_RETIRED, SALARY_INCOME];

describe('keepSavedFilingCategory', () => {
  it('returns the active options unchanged when the record has no saved Category', () => {
    expect(keepSavedFilingCategory(ACTIVE_EXPENSES, ALL, null, null)).toEqual([
      GROCERIES,
      RENT,
    ]);
  });

  it('returns the active options unchanged when the saved Category is still active', () => {
    expect(keepSavedFilingCategory(ACTIVE_EXPENSES, ALL, 1, 1)).toEqual([
      GROCERIES,
      RENT,
    ]);
  });

  it('appends the saved Category at the tail when it has been retired', () => {
    expect(keepSavedFilingCategory(ACTIVE_EXPENSES, ALL, 9, 9)).toEqual([
      GROCERIES,
      RENT,
      HOLIDAYS_RETIRED,
    ]);
  });

  it('keeps the retired entry carrying isActive: false so a caller can badge it', () => {
    const [, , tail] = keepSavedFilingCategory(ACTIVE_EXPENSES, ALL, 9, 9);
    expect(tail).toMatchObject({ id: 9, isActive: false });
  });

  it('drops the saved Category once the selection has moved off it', () => {
    expect(keepSavedFilingCategory(ACTIVE_EXPENSES, ALL, 9, 1)).toEqual([
      GROCERIES,
      RENT,
    ]);
  });

  it('drops the saved Category once the selection has moved to "none"', () => {
    expect(keepSavedFilingCategory(ACTIVE_EXPENSES, ALL, 9, null)).toEqual([
      GROCERIES,
      RENT,
    ]);
  });

  it('appends a since-retired saved Category of a different kind too — the re-add is not kind-filtered', () => {
    const salaryRetired = cat(2, { name: 'Salary', kind: 'income', isActive: false });
    expect(
      keepSavedFilingCategory(
        ACTIVE_EXPENSES,
        [GROCERIES, RENT, salaryRetired],
        2,
        2
      )
    ).toEqual([GROCERIES, RENT, salaryRetired]);
  });

  it('keeps an active saved Category the kind filter dropped — the prefilled-value guard it generalises', () => {
    expect(
      keepSavedFilingCategory(ACTIVE_EXPENSES, ALL, 2, 2)
    ).toEqual([GROCERIES, RENT, SALARY_INCOME]);
  });

  it('does not append when the saved id resolves nowhere in the whole set', () => {
    expect(
      keepSavedFilingCategory(ACTIVE_EXPENSES, ALL, 404, 404)
    ).toEqual([GROCERIES, RENT]);
  });

  it('does not duplicate a saved Category already present in the options', () => {
    expect(keepSavedFilingCategory(ACTIVE_EXPENSES, ALL, 1, 1)).toEqual([
      GROCERIES,
      RENT,
    ]);
  });

  it('returns a fresh array, never the options reference', () => {
    const result = keepSavedFilingCategory(ACTIVE_EXPENSES, ALL, 1, 1);
    expect(result).not.toBe(ACTIVE_EXPENSES);
  });
});
