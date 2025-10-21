# Build Regex Flag Fix

- **Minimum viable change:** Drop the unicode regex flag so the TypeScript target requirement disappears and the build succeeds.
- **Skip for v0.1:** Broader lint cleanup for the other warnings, refactoring regex helpers, or adjusting TypeScript target.
- **Definition of done:** `next build` completes locally without the ES6 regex flag error.

## Plan
1. Find the regex using the ES6-only `u` flag in `app/page.tsx`.
2. Replace it with a version compatible with the current TypeScript target (no `u` flag, equivalent behavior).
3. Re-run the build to confirm the error is gone.
