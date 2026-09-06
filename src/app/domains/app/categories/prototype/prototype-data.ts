// PROTOTYPE — throwaway. Answers #95: does the Accounts dialog precedent
// (ADR 0013) still fit a list of dozens of Categories in two kinds, or does an
// inline-row list read better? Three variants on `/app/categories-prototype`,
// switchable via `?variant=`. Delete with the branch.

/** A Category as the screen needs it: the adapter's set plus what #92/#93 badge. */
export type PrototypeCategory = {
  id: number;
  name: string;
  kind: 'income' | 'expense';
  isDefault: boolean;
  isActive: boolean;
};

let nextId = 1000;

/** In-memory only. No API, no persistence — the question is what it looks like. */
export function seed(): PrototypeCategory[] {
  const expense = [
    ['Groceries', true], ['Rent', true], ['Electricity', true], ['Water', true],
    ['Internet', true], ['Mobile load', false], ['Transport', true],
    ['Fuel', false], ['Dining out', true], ['Coffee', false],
    ['Household', true], ['Clothing', true], ['Health', true],
    ['Medicines', false], ['Insurance', true], ['Tuition', true],
    ['Books', false], ['Subscriptions', false], ['Gifts', true],
    ['Donations', true], ['Pet care', false], ['Repairs', false],
    ['Travel', true], ['Entertainment', true], ['Taxes', true],
    ['Bank fees', false], ['Laundry', false],
  ] as const;
  const income = [
    ['Salary', true], ['Bonus', true], ['Freelance', false],
    ['Interest', true], ['Dividends', true], ['Refunds', false],
    ['Gifts received', false], ['Rental income', false],
  ] as const;

  const retired = new Set([
    'Mobile load', 'Laundry', 'Books', 'Gifts received',
  ]);

  const rows: PrototypeCategory[] = [];
  for (const [name, isDefault] of expense) {
    rows.push({ id: nextId++, name, kind: 'expense', isDefault, isActive: !retired.has(name) });
  }
  for (const [name, isDefault] of income) {
    rows.push({ id: nextId++, name, kind: 'income', isDefault, isActive: !retired.has(name) });
  }
  return rows;
}

export const newId = (): number => nextId++;

/** #92's order: alphabetical, retired sunk to the bottom. */
export function ordered(rows: PrototypeCategory[]): PrototypeCategory[] {
  return [...rows].sort((a, b) =>
    a.isActive === b.isActive ? a.name.localeCompare(b.name) : a.isActive ? -1 : 1
  );
}
