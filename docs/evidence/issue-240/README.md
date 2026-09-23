# Issue 240 verification evidence

## Screenshots

- `tags-desktop-light.png` — Tags page in Light appearance.
- `tags-desktop-dark.png` — Tags page in Dark appearance.
- `tags-phone-dark-320.png` — Tags page at a 320 CSS-pixel viewport in Dark appearance.

The browser used the existing signed-in local development session. The captured list contains the pre-existing development Tags. No Tag was created, renamed, or deleted during visual review. The original Dark appearance preference was restored after checking the available appearance modes.

## Manual review

- Checked the Tags screen in Light, Dark, and System appearance; System resolved to Dark on this device.
- Checked search, clearing a no-match search, the row action menu, inline rename cancellation and dirty-draft confirmation, and delete confirmation/cancellation.
- Confirmed that an invalid Add submission focuses the field. It did not send a write.
- Inspected the Tags layout at desktop size and at a 320 CSS-pixel viewport. Tag names and their row actions remain reachable in the narrow layout.
- Inspected the browser accessibility tree for field labels, row action names, and status roles. The rendered component test uses a 255-character Tag name and checks wrapping styles and the full accessible action name.

## Limits

- Destructive Tag deletion and successful create/rename writes were not performed against the existing development data. Those paths, including transport failures, timeouts, and server errors that require a read-only check, are covered by the component and service tests.
- A screen reader, reduced-motion preference, measured contrast ratios, and every individual 44 px target were not manually audited in the browser. The controls use 44 px or larger minimum-height classes, and loading indicators include reduced-motion styles.
- At 320 CSS pixels, the existing app-shell bottom navigation wraps the “Transactions” label awkwardly. This is outside the Tags feature layout changed for issue 240.
- The 320 px viewport is a responsive viewport check; it is not a browser zoom test at 400%.
- Final visual review by the user is pending; these screenshots are included for that review.

## Automated checks

- `npm test` — 79 files and 1,072 tests passed.
- `npm run lint` — passed.
- `npm run check:format` — passed.
- `npm run check:changed -- --base origin/main` — passed.
- `npm run build` — passed when run on its own. A concurrent attempt exited with code 134; an isolated rerun completed successfully on the final code.
- `git diff --check` — passed.
