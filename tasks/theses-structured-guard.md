# Theses Structured Guard

- **Minimum viable change:** Narrow the `groupsState` union before passing its structured data into `runResearcherTheses`.
- **Skip for v0.1:** Broader pipeline refactors or addressing unrelated lint warnings.
- **Definition of done:** Local `next build` completes without the `ResearchGroupsState` type error.

## Plan
1. Examine the pipeline block that invokes `runResearcherTheses` with `groupsState.structured`.
2. Update the condition to narrow `groupsState` to the success variant prior to accessing `structured`.
3. Re-run the build to verify the error is resolved.
