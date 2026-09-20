# Pocket Pop identity study — throwaway

Question: which wallet mark and typography treatment carry Pocket Pop into a usable product identity?

Run `npm run prototype:identity`, then open http://localhost:4317/auth/sign-in?variant=B . This development-only preview uses the existing sign-in route and requires a guest session. Do not submit the sign-in form for this study.

Five mark concepts: A Folded wallet, B Open pocket, C Pocket p, D Double pocket, E Clasp wallet. These are refinements within the selected Pocket Pop direction, not the former A/B/C brand contest.

Select Plus Jakarta Sans, Outfit, Manrope, DM Sans, or the original Geist independently. `font` and `variant` query parameters preserve the pairing. Arrow keys and the bottom bar cycle marks. System/Light/Dark, monochrome, and Geist-for-UI controls are temporary in-memory review settings. The font comparison rows remain single-family samples so each candidate can be inspected independently of pairing mode.

Includes the actual sign-in form, sample financial data, long names, negative direction-neutral balance, 16/24/32/48px icon specimens, inverted lockup, and matching-size font rows. No financial or appearance behavior is being decided here. Existing Pocket Pop prototype colors are provisional. No production assets are approved.

## Font evidence

Upright variable binaries downloaded from the official Google Fonts repository and inspected with fontTools on 2026-09-20. Fonts and their OFL licenses are included under `public/fonts/identity/`.

| Family | Peso U+20B1 | Tabular numerals | Source |
| --- | --- | --- | --- |
| Plus Jakarta Sans | Native | Yes | https://github.com/google/fonts/tree/main/ofl/plusjakartasans |
| Manrope | Native | Yes | https://github.com/google/fonts/tree/main/ofl/manrope |
| Outfit | Fallback required | Yes | https://github.com/google/fonts/tree/main/ofl/outfit |
| DM Sans | Fallback required | No tnum in inspected file; digits vary in width | https://github.com/google/fonts/tree/main/ofl/dmsans |

Outfit and DM Sans are included as possible display faces; try pairing with Geist for UI and amounts. Font choice remains pending. Keeping a new display or UI font would explicitly revise ADR 0008's decision to retain Geist; it does not revise semantic money colors.

## Live discussion

User agreed: warm and lightly playful welcomes, empty states, and celebrations; direct money, error, and destructive-action language. Logo and typography require further visual review. Tagline remains undecided.

Map: https://github.com/itsdevjimbo/pitaka-web/issues/216
Decision: https://github.com/itsdevjimbo/pitaka-web/issues/217

Do not merge this branch into production. Capture the final decision on the decision ticket after user review.
