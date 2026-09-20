# Pocket Pop specimen: opaque color-pair checks

Run `node src/app/domains/auth/features/sign-in/token-prototype/contrast.mjs` from this worktree. The calculator implements sRGB linearization and `(lighter luminance + 0.05) / (darker luminance + 0.05)`. Checks use unrounded values; tables round to two decimals. Text pairs are compared with 4.5:1 and control-outline pairs with 3:1. This reports selected color pairs only, not WCAG compliance, rendered component behavior, focus visibility, interaction, opacity, or an accessibility audit.

## Backgrounds

| Role | Light | Dark |
| --- | --- | --- |
| Canvas | #F1F3FF | #12172F |
| Surface | #FFFFFF | #1D2443 |
| Raised overlay surface | #FFFFFF | #283153 |
| Soft / selected fill | #E0E6FF | #303B66 |
| Error container | #FEECEC | #442832 |
| Warning container | #FFF4DA | #3B3320 |
| Success container | #E6F5ED | #153B32 |

## Selected role checks

Every role below was checked against all seven backgrounds in its scheme. The lowest ratio always occurs on the soft fill. Income and success text share a value; expense and error text share a value. These remain distinct semantic roles despite coincident values. Money meaning must continue to have signs and labels.

| Foreground role | Light | Lowest ratio | Dark | Lowest ratio |
| --- | --- | ---: | --- | ---: |
| Text | #1C2763 | 11.14 | #F0F2FF | 9.70 |
| Secondary text | #596189 | 4.84 | #B4BEDF | 5.85 |
| Primary | #304BC6 | 5.74 | #BBC0F5 | 6.16 |
| Income / success text | #047454 | 4.66 | #34D399 | 5.62 |
| Expense / error text | #B91C1C | 5.22 | #FF8585 | 4.60 |
| Transfer text | #525252 | 6.30 | #D4D4D4 | 7.29 |
| Warning text | #855600 | 5.09 | #F8CB62 | 7.06 |
| Control outline | #7681AF | 3.06 | #7E8CB8 | 3.26 |

Original decorative borders #CBD3F1 / #43527E produce only 1.20 / 1.41 on soft fill, and remain below 3:1 on the other listed backgrounds. Do not use these alone for an essential control boundary. Separate control-outline values above retain subtle decorative dividers without weakening essential boundaries.

Minimal corrections from initial candidates: light outline #7C87B5 yielded 2.83 on soft; #7681AF yields 3.06. Light income #047857 yielded 4.42; #047454 yields 4.66. Dark expense #F87171 yielded 3.91; #FF8585 yields 4.60. Ratios apply only to the exact opaque fills shown; alpha blends and new surfaces need their own checks.

## Filled primary buttons

| Scheme / state | Fill | Text | Ratio |
| --- | --- | --- | ---: |
| Light default | #304BC6 | #FFFFFF | 7.12 |
| Light hover | #233899 | #FFFFFF | 10.01 |
| Light pressed | #17276F | #FFFFFF | 13.49 |
| Dark default | #BBC0F5 | #12172F | 10.07 |
| Dark hover | #DFE1FA | #12172F | 13.70 |
| Dark pressed | #EFF0FD | #12172F | 15.60 |

## Generator provenance

Running the existing `TonalPalette` from `src/app/core/theming/palette.ts` with seed #304BC6 produces this exact scale. The generator preserves the seed at 600 and derives other steps with perceived HSLuv lightness.

| Step | Hex |
| --- | --- |
| 50 | #EFF0FD |
| 100 | #DFE1FA |
| 200 | #BBC0F5 |
| 300 | #9AA3F0 |
| 400 | #7583EB |
| 500 | #5066E4 |
| 600 | #304BC6 |
| 700 | #233899 |
| 800 | #17276F |
| 900 | #0A1444 |
| 950 | #060D32 |

Original Pocket Pop dark accent #ACBAFF has ratios 9.44 / 8.10 / 5.78 against dark canvas / surface / soft. Generated 200 #BBC0F5 has 10.07 / 8.64 / 6.16. Selecting generated 200 preserves one primary seed while slightly changing the original dark accent. Original light and dark surface/text values come from branding prototype commit `b9eb9e6`. Its light secondary text already clears 4.5:1 on soft at 4.84; no correction was required.

The current production Material mapping uses primary 600 in both schemes. A future implementation of this specimen would need explicit scheme-aware primary-role mapping, separate on-primary light/dark values, and shared neutral/surface roles. These calculations make no production changes.

## Additional specimen pairs

- Disabled text uses explicit opaque colors rather than multiplying control opacity: #596189 on #E6E9F3 (Light), #A6AFCB on #303956 (Dark). Both clear the specimen’s voluntary 4.5:1 target; disabled controls are exempt from the WCAG contrast minimum.
- Destructive button labels: white on #B91C1C, 6.47:1; #12172F on #FF8585, 7.52:1.
- The calculator now checks 112 general role pairs, six primary-button states, two disabled pairs, and two destructive-button pairs (122 checks). Raised surfaces are included.

Sources: [W3C text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html), [W3C non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html).
