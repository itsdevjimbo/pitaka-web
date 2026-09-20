# Pocket Pop token specimen — throwaway, awaiting review

Decision: [Define Pocket Pop’s accessible light and dark design tokens](https://github.com/itsdevjimbo/pitaka-web/issues/220), part of [Map: Pocket Pop branding and screen redesign](https://github.com/itsdevjimbo/pitaka-web/issues/216).

## Run and compare

On `prototype/pocket-pop-tokens`, install the lockfile dependencies if needed, then:

```sh
npm run prototype:tokens
```

Open `http://127.0.0.1:4320/auth/sign-in?variant=A&scheme=light`.

- A: component sheet with Material buttons, checkbox, fields, error/disabled states, neutral balances, direction colors, feedback, focus, selection, menu-surface and dialog specimens.
- B: dense Account context, wrapping financial rows, large balance. Its sidebar is contextual evidence, not a proposed navigation revision.
- C: expressive welcome typography and sign-in form specimen. Controls never send authentication requests.
- Appearance selects System/Light/Dark. Canvas selects full width/390px. Bottom arrows (and keyboard left/right outside input controls) cycle views. Query parameters preserve the preview state on reload.
- `scheme=light|dark|system`, `width=wide|phone`, `variant=A|B|C`.

The sign-in route renders the specimen only in Angular development mode with a `variant` query parameter. Existing sign-in behavior remains available without it. No backend mutation is connected to specimen controls. Appearance is an in-memory/URL review control, not the production persistence implementation.

The three views demonstrate one proposed token system in different contexts. The selected Pocket Pop identity and navigation are not reopened. Production work and the stock prototype skill’s “fold the winner into real code” step are outside this map’s explicit planning scope.

## Agreed foundations

The user agreed during the live decision session to:

1. Faint lavender canvas / white cards in Light; deep navy canvas / lighter navy cards in Dark; cobalt/periwinkle for actions and selection, stronger expression on welcome and empty-state areas.
2. Rounded cards/dialogs, moderately rounded controls, pill chips; comfortable forms and compact transaction lists.
3. WCAG 2.2 AA baseline: ordinary text 4.5:1, large text 3:1, essential component boundaries/state indicators 3:1. Aim higher for amounts where practical.

The exact role values, dimensions, and Material mapping below are **proposals for visual review**, not a resolution.

## Proposed role system

Use a generated primary scale seeded by `#304BC6`. Light primary is step 600; Dark primary is generated step 200 (`#BBC0F5`). This slightly changes the original prototype’s independently selected dark `#ACBAFF`, while preserving one generated primary family. Never use step 600 for both schemes indiscriminately.

Surfaces and text are an explicitly curated family, not accidental byproducts of the primary generator. Semantic status and money roles remain independent from primary.

| Role | Light | Dark |
| --- | --- | --- |
| Canvas | #F1F3FF | #12172F |
| Surface / card / field | #FFFFFF | #1D2443 |
| Raised / menu / dialog | #FFFFFF | #283153 |
| Soft / selected fill | #E0E6FF | #303B66 |
| Text | #1C2763 | #F0F2FF |
| Secondary / hint / placeholder | #596189 | #B4BEDF |
| Primary / link / focus | #304BC6 | #BBC0F5 |
| On-primary | #FFFFFF | #12172F |
| Primary hover | #233899 (700) | #DFE1FA (100) |
| Primary pressed | #17276F (800) | #EFF0FD (50) |
| Essential outline | #7681AF | #7E8CB8 |
| Decorative divider | #CBD3F1 | #43527E |
| Income | #047454 | #34D399 |
| Expense | #B91C1C | #FF8585 |
| Transfer | #525252 | #D4D4D4 |
| Success text / container | #047454 / #E6F5ED | #34D399 / #153B32 |
| Error text / container | #B91C1C / #FEECEC | #FF8585 / #442832 |
| Warning text / container | #855600 / #FFF4DA | #F8CB62 / #3B3320 |
| Disabled text / fill | #596189 / #E6E9F3 | #A6AFCB / #303956 |

Information notices use normal text on soft fill. Success/income and error/expense happen to share color values but are separate roles. A success notice is not a money direction. Account balances stay in normal text even when negative; Transactions retain labels and signs, and global Transfers must not acquire a directional sign when no Account is in view.

Text never sits on an arbitrary alpha-tinted financial fill. Any additional tint, opacity, blend, image, or new surface must be checked separately. Decorative dividers must not be the sole means of finding a control.

## Proposed type and dimensions

All pixel values below describe the 16px-root reference; implementation uses scalable font units and preserves user zoom. No fixed-height text box may clip wrapping content.

| Use | Face / weight | Size / line height |
| --- | --- | --- |
| Welcome display | Outfit 750 | 40–56 / 1.05, -0.025em tracking |
| Page heading | Outfit 750 | 28–32 / 1.15, -0.025em tracking |
| Section/card heading | Outfit 750 | 20 / 26 |
| Wordmark | Outfit 750 | 28 / 32 in this specimen; responsive identity placement belongs to screen review |
| Body / transaction title | Geist 400; 600 where emphasis is useful | 14 / 22 |
| Field / entered amount | Geist 400 | 16 / 24 |
| Control / label | Geist 600 | 14 / 20 |
| Hint / metadata | Geist 400 | 12 / 18 |
| Balance | Geist 650 | 28–32 / 36–40 |
| Row amount | Geist 650 | 14 / 22 |

Use tabular digits for all financial figures and align row amounts to the trailing edge. Keep peso glyph and digits together in Geist. Do not shrink large balances to fit; wrap/reflow the surrounding layout. Body tracking is normal. Do not use tiny uppercase labels for essential values.

- Spacing: 4px unit; 4/8/12/16/20/24/32/40/48/64 scale. Page padding 16 on narrow screens, 40 on wide; working card padding 20/24; form gaps 24; row padding 14px vertical in this two-line data specimen, adjustable with content rather than hard height.
- Shape: 12px controls, 20px cards, 24px dialogs, 16px menus, fully rounded chips. Expressive pocket shape 24/24/56/24 only for occasional welcome/empty illustration. No rotated working controls or asymmetrical transaction rows.
- Standard primary buttons at least 44px tall; inputs approximately 48px with 16px text. Chips are 40px high here. Final per-screen touch-target and keyboard acceptance belongs to the interaction decision.
- Elevation: working surfaces are flat, separated by spacing and a decorative border. Raised menus use `0 12px 32px #0003`; modal dialogs `0 24px 64px #0004`. Dark surfaces become lighter with elevation. Scrim `#0A102866`. Borders and surface contrast, not shadow alone, carry separation.

## Proposed state rules

- Filled primary buttons: primary/default, generated hover/pressed values above; stable on-primary text. Do not stack Material alpha state layers on top of those specified fills.
- Outlined/text actions: primary text, essential outline where present; soft hover/pressed fill; pressed text underlined in the specimen. Links are always underlined, not identified only by hue.
- Keyboard focus: 3px primary ring with a 2–3px surface-colored gap, outside the control. A field gets one ring on its wrapper; an invalid field retains its error boundary/message as well. Never clip the ring. Final navigation and focus restoration behavior belongs to the interaction decision.
- Selected chips/rows: soft fill plus primary outline/text and explicit check/selected text. Real production controls also expose selected/checked state semantically.
- Native text selection: primary fill/on-primary text.
- Disabled: explicit disabled fill/text, no hover/press action, native disabled semantics. Do not fade the whole component; this specimen voluntarily keeps disabled text at least 4.5:1.
- Destructive: separate danger role using error values, direct action label. Filled danger buttons use white text in Light and navy in Dark; the specimen’s hover darkens fill slightly. A production implementation must measure its final composited hover/focus/pressed treatment.
- Feedback: icon/wording plus container color; never color alone. Static feedback specimens do not establish notification timing, animation, live regions, or dismissal rules.

## Material mapping and ADR treatment

Propose extending the single-seed rule and explicitly superseding the stock-surface / Geist-only clauses of ADR 0008. Retain its separate financial colors and neutral Account balances. The accepted identity decision already revised font roles; this ticket would establish their type scale. Document changes belong to later implementation, not this throwaway branch.

| Material/system family | Proposed role mapping |
| --- | --- |
| background / on-background | canvas / text |
| surface / on-surface | surface / text |
| surface-container-lowest, low | canvas, surface respectively |
| surface-container, high, highest | surface, raised, soft respectively |
| surface-dim / bright / variant | canvas / raised / soft |
| on-surface-variant | secondary text |
| primary / on-primary | scheme-aware primary / on-primary |
| primary-container / on-primary-container | soft / text |
| primary-fixed family | explicit stable light primary/container roles; do not inherit arbitrary stock defaults |
| secondary / tertiary | use this same primary/soft family unless a separately reviewed semantic need exists; no new accent colors |
| error / on-error / error-container / on-error-container | error text / on-primary / error container / error text |
| outline / outline-variant | essential outline / decorative divider |
| inverse-surface / inverse-on-surface / inverse-primary | raised / text / primary, retaining current scheme for notices |
| display / headline / section title | Outfit heading roles above |
| body / label / inputs / amounts | Geist roles above |
| cards / fields / menus / dialogs / tooltips | explicit surface and foreground roles, including overlays outside component trees |

The specimen uses real Material buttons, checkbox, and form fields. Its raised-surface popover and native HTML dialog are visual specimens, not a full Material overlay integration. Implementation must propagate role tokens to the CDK overlay container and remove conflicting per-screen colors/stock overrides. Current production CSS has hardcoded neutral field colors, stock outline/error choices, alpha-disabled fields, and a primary-600 focus treatment; changing the seed alone is insufficient.

## Evidence and limits

- Development compiler completed successfully.
- Visually inspected wide Light components, wide Dark fields/feedback, dark input focus, 390px Dark Account data, wide Light welcome view, and Light phone dialog in Chrome.
- [Contrast report](contrast-report.md) and reproducible calculator cover exact opaque role pairs; 122 checks pass. This is not a WCAG conformance claim or complete rendered-state audit.
- Full page responsive behavior, 200%/400% zoom, reduced motion, assistive technology, complete keyboard flows, and final Material overlay integration remain with downstream screen/interaction validation.
- Self-hosted Outfit and its OFL license come from the approved identity specimen. Existing Geist assets are retained.

No production change or implementation PR. Keep this branch as the decision’s visual evidence; do not merge the prototype.
