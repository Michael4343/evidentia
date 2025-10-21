# Fix build errors

## What's the absolute minimum to prove this works?
- Reproduce the TypeScript failure at `app/page.tsx:3699` and adjust the status logic so the comparison aligns with the declared union type.
- Ensure the page renders the correct placeholder or content for each status without introducing regressions.

## What can we skip for v0.1?
- Cleaning up the existing eslint warnings about refs and dependency arrays unless they directly block the build.
- Broader refactors of the pipeline state handling beyond the problematic comparison.

## How will we know it's done?
- `npm run build` (or `next build`) completes locally without TypeScript errors.
- Manual check of the affected component confirms the loading placeholder still appears when the similar papers pipeline is loading.
