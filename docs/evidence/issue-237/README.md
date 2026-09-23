# Issue 237 verification

Verified on 2026-09-23 against the production Goal detail component, an authenticated local development Profile, and the local Pitaka API.

## Implemented corrections

- The funding badge now sits directly below the Goal name. The Target overdue warning remains part of the funding/date facts, while Active, Completed, and Abandoned remain separate lifecycle labels.
- Goal detail retains the approved Pocket Pop B composition: summary and Contributions are 475px / 581px columns at a 1440px viewport and become one column on phones.
- Angular Material's sidenav container and content now use the shared canvas role, and the navigation drawer uses the shared surface role. The rendered canvases are `rgb(241, 243, 255)` (`#F1F3FF`) in Light and `rgb(18, 23, 47)` (`#12172F`) in Dark rather than the previous white and charcoal Material defaults.
- The shared keyboard-focus rule now keeps its approved 3px ring and 3px gap after the Material cascade is applied.

The existing API requests, complete financial amounts, Contribution restrictions, Goal lifecycle eligibility, and editor/recovery safeguards are unchanged.

## Fresh visual evidence

Chrome captured the actual application at device scale factor 2. The desktop captures are 1440×1000 CSS pixels. The phone captures are 390 CSS pixels wide and use full-page height so all stacked content remains reviewable.

- [Goal detail — desktop Light](goal-detail-desktop-light.png)
- [Goal detail — desktop Dark](goal-detail-desktop-dark.png)
- [Goal detail — phone Light](goal-detail-phone-light.png)
- [Goal detail — phone Dark, long content](goal-detail-phone-dark-long.png)

The Dark phone capture uses an API-backed Goal with a long name, `₱999,999,999,999.99` target, zero funding, and an overdue date. Five clearly named issue-237 evidence Goals were added to the local development Profile and retained for reproduction. Together they cover in-progress/overdue, exact-target/overdue, over-target, Completed, and Abandoned combinations. The Completed and Abandoned detail views exposed no Add contribution action; their existing Contribution-history actions remained available as designed.

## Browser and accessibility checks

| Check | Actual result |
| --- | --- |
| Light | Canvas `#F1F3FF`, white cards/navigation surface, funding badge below the name. |
| Dark | Canvas `#12172F`, card/navigation surface `#1D2443`, funding badge below the name. |
| System | The saved value remained `system`. With OS Dark it rendered the Dark roles; DevTools changing `prefers-color-scheme` to Light changed the live class and canvas to Light without reload. System also rendered at the phone-equivalent reflow width without overflow. |
| Desktop B composition | At 1440×1000, summary and Contributions measured 475px / 581px with no document overflow. |
| Phone and long content | At 390×844, the workspace measured one 358px column, the long heading and maximum amount wrapped, and `scrollWidth === clientWidth` (390px). |
| Actual 400% zoom | Chrome reported Zoom 400%, `innerWidth === 432`, and `scrollWidth === clientWidth` (432px). All Goal facts and actions remained present in the accessibility tree and available by vertical scrolling. |
| Touch targets | The smallest visible link/button dimension was 44px at desktop and phone viewports. |
| Keyboard focus | Tabbing from the route-focused heading moved to Edit goal. Its active keyboard state computed to a 3px scheme-aware outline with a 3px offset. |
| Reduced motion | With `prefers-reduced-motion: reduce`, the page matched the query, button animation and transition durations computed to `0.01ms`, and scroll behavior computed to `auto`. |

Representative contrast was measured from final computed foreground/background colors in Chrome, including the actual Material and layout surfaces:

| Pair | Light | Dark |
| --- | ---: | ---: |
| Main text / canvas | 12.50:1 | 15.85:1 |
| Main text / card | 13.82:1 | 13.60:1 |
| Secondary text / card | 6.01:1 | 8.21:1 |
| In-progress badge text / badge surface | 6.01:1 | 8.21:1 |
| Lifecycle text / soft fill | 11.14:1 | 9.70:1 |

The browser also resolved primary actions and focus to the approved scheme-aware generated colors. Their exact token pairs remain 7.12:1 in Light and 10.07:1 in Dark for button labels, with the essential outline pair at least 3.06:1. This check sampled the Goal detail's rendered normal states; it does not claim exhaustive contrast coverage for every transient ripple or browser forced-color transformation.

## Automated verification

- Focused Goal detail suite: 16 behavioral tests passed.
- `npm run check:changed`: passed after the implementation edits.
- `npm run lint`: passed.
- `npm run build`: passed.
- Full `npm test -- --watch=false`: 79 test files and 1,040 tests passed.

## Explicit limitations

- The accessibility-tree inspection is not a manual screen-reader session. No manual screen-reader result is claimed.
- Light, Dark, System, keyboard focus, reduced motion, rendered representative contrast, touch targets, long content, lifecycle/funding/date combinations, phone layout, and actual 400% reflow were exercised. Forced colors and every transient Material ripple/composited state were not exhaustively audited.
- The screenshots have been inspected during implementation, but final visual approval belongs to the user and remains pending.
