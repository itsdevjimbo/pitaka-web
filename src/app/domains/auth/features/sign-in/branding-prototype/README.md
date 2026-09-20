# Pitaka branding prototype — throwaway

Question: which visual identity makes everyday money feel approachable in both light and dark appearance?

Run `npm run prototype:branding`, or visit http://localhost:4300/auth/sign-in?variant=A while the preview server is running. A guest session is required by the existing sign-in route.

- **A — Everyday Sage (recommended):** folded-wallet symbol, lowercase Geist wordmark, cream and forest green, generous space, a soft split layout. Voice: “A little more peace of mind.”
- **B — Ink & Paper:** serif wordmark and headlines, warm paper, terracotta accents, ruled editorial columns. Voice: “Your money. Your story.”
- **C — Pocket Pop:** bold geometric typography, cobalt and periwinkle, centered poster layout with an oversized pocket card. Voice: “Small steps. Big possibilities.”

All directions retain distinct income/expense colors, signed amounts, and labels. Sample figures are illustrative, not fetched financial data. The existing sign-in form and guest guard remain functional.

Appearance defaults to System and follows changes live. Light and Dark overrides last only for the mounted preview. Variant selection is stored in the query string; the floating controls and keyboard left/right arrows cycle A/B/C. The preview is gated by Angular development mode and the variant query parameter.

Suggested A palette:

| Role | Light | Dark |
| --- | --- | --- |
| Canvas | #F6F5EE | #121C18 |
| Surface | #FFFFFF | #1C2922 |
| Text | #213E35 | #EDF2E8 |
| Secondary text | #59685F | #B0BEB2 |
| Accent | #285C49 | #B7D8A6 |
| Border | #D5DDCF | #3A4B3E |

Verdict: A is the design recommendation; user selection is pending. No production branding decision has been validated. Keep this experiment on `prototype/pitaka-brand-directions`. No implementation issue was provided. Once a direction is selected, implement it through the app's shared theme and brand assets, then link that implementation issue back to this branch. Do not merge the prototype wholesale.
