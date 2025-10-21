# Run Contacts Guard

- **Minimum viable change:** Ensure we only pass `groupsState.text/structured` into `runResearchGroupContacts` after confirming `groupsState.status === "success"`.
- **Skip for v0.1:** Broader refactoring of pipeline state handling or lint warning cleanup.
- **Definition of done:** Local `next build` passes without the research groups type error.

## Plan
1. Inspect the `runResearchGroupContacts` triggering block in `app/page.tsx`.
2. Add a guard so TypeScript sees that `groupsState` is a success state before accessing `text`/`structured`.
3. Re-run the build to ensure the error disappears.
