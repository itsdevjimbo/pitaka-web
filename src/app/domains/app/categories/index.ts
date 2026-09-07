// The Categories domain's interface to the rest of the app: the vocabulary
// (types, error classes) and the API adapter. The routed screen is not
// re-exported here — it is lazy-loaded by path from `routes.ts`, and a barrel
// export would defeat its code-splitting.
export { CATEGORY_NAME_MAX } from './data/category';
export type { Category, CategoryKind, NewCategory } from './data/category';
export { CategoryInUseError } from './data/category-errors';
export { CategoriesService } from './data/categories.service';
