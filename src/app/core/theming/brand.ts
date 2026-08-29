/**
 * Pitaka's single brand accent. Fuse's palette generator derives the entire
 * primary scale from this one seed (see `Theming`), so this hex is the only
 * colour the product picks by hand — the rest is generated.
 *
 * It is indigo, and required to be **neither green nor red**: those hues mean
 * income and expense where money is shown. Full rationale and the semantic
 * money colours are in ADR 0008 / `styles/base/semantic.css`.
 */
export const BRAND_ACCENT = '#4F46E5';
