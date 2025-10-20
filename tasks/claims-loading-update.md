# Claims Loading Update

- **Absolute minimum to prove this works:** Show the claims loading spinner immediately, even before the claims state arrives, so users see a consistent loading indicator.
- **Skip for v0.1:** No copy rewrites beyond removing the unfriendly placeholder, no new hooks or data fetching tweaks.
- **How we'll know it's done:** Visiting the claims tab while data is loading immediately shows the same spinner UI without the old instructional blurb; no regressions for error or success states.

## Plan
1. Inspect the claims panel logic to confirm how it handles `undefined` versus loading states today.
2. Update the "no state" branch to reuse the spinner so the placeholder text disappears.
3. Manually verify the component renders the spinner for both `undefined` and explicit loading states.
