# Similar Papers Text Guard

- **Minimum viable change:** Check `similar?.status === "success"` before referencing `similar.text` in the verified claims logging block.
- **Skip for v0.1:** Widespread refactoring of state handling or lint warning cleanup.
- **Definition of done:** Local `next build` passes without the `SimilarPapersState` type error.

## Plan
1. Locate the logging code in `app/page.tsx` that reads `similar?.text`.
2. Wrap the access in a `status === "success"` guard to satisfy TypeScript.
3. Re-run the build to confirm the error is gone.
