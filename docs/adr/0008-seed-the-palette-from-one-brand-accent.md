---
status: accepted
---

# Seed the palette from one brand accent, and fix the money colours apart from it

Pitaka Web makes exactly one colour choice by hand: a single brand accent. Fuse's
palette generator derives the whole primary scale from that seed, and Material's
system colours read from the generated scale, so re-theming later is changing one
hex. Geist and the light/dark schemes are kept as Fuse ships them.

The accent is indigo, `#4F46E5`. It is defined once, as `BRAND_ACCENT` in
`core/theming/brand.ts`, and passed to `provideTheming` — nothing else names a
primary colour.

## The accent is neither green nor red

This is a money application. Income, expense, and transfer need semantic colours
— green, red, and neutral — and those must not collide with the chrome. Seed the
palette green and every positive number competes with every button; "is that
green because it's income, or because it's a button?" becomes a question people
answer preconsciously and sometimes wrongly. So the accent is required to be
neither green nor red, and a unit test on `BRAND_ACCENT` holds that line against
a future re-theme.

## The money colours are fixed, not generated

`--color-income`, `--color-expense`, and `--color-transfer` live in
`styles/base/semantic.css`, defined once and referenced wherever an amount is
shown with a direction (today: the Transactions list under an Account). They are
static hues — emerald, red, and neutral (zinc) — and are deliberately *not*
derived from the accent, so they cannot drift toward it if the brand changes.
Each hue is lifted on a dark surface via `light-dark()` — the scheme-aware idiom
the rest of `src/styles` uses — so contrast holds in both schemes without a
per-call-site `dark:` variant.

An Account **balance** has no direction and is left in the default text colour.
Tinting it green or red would assert an income/expense reading that a running
total does not carry — a card in debt shows a negative peso figure, not an
"expense". Direction colour is for Transactions.

## Considered options

Hand-picking each step of the primary scale was rejected: it is what makes a
theme look bespoke-but-inconsistent, and Fuse already ships a generator that
keeps the scale coherent from one seed.

Deriving the semantic colours from the accent (e.g. accent-hue for transfer) was
rejected: it re-introduces exactly the collision the accent constraint exists to
prevent, and it makes "what colour is income" depend on a branding decision.

Keeping Fuse's stock blue (`#1565C0`) was rejected: it is legible but it is the
demo's colour, and the point of this change is that Pitaka stops looking like the
Fuse demonstration.

## Consequences

- One place changes on a re-theme: `BRAND_ACCENT`. The generator and Material
  hookup do the rest.
- `text-income` / `bg-expense/10` / `text-transfer` are the only way money
  direction gets a colour. A new screen that shows amounts uses these tokens; it
  does not reach for `text-emerald-*` directly.
- If pesos ever stop being the only currency, or a fourth direction appears, the
  token set in `semantic.css` is where it is added.
