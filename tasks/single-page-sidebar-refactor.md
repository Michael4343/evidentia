# Single Page Sidebar Refactor Plan

## Goal
Consolidate the paper exploration experience into a single-page flow with a left-aligned control surface so users switch between the five reader modes without navigating away.

## Assumptions
- Existing mock data remains the source for paper/tab content.
- No backend wiring is required; this is a front-end architecture pass.
- We keep the upload hero available within the unified view.

## Steps
1. Map the current multi-route components and decide which pieces belong in the unified shell (sidebar, tab content, hero, status panels).
2. Implement a client-side layout with a persistent left sidebar (logo, tab toggles, sign in) and stateful content area that swaps sections without routing.
3. Reconcile or remove obsolete routing assets, ensure components consume shared state, and smooth the UI/styling for the cohesive SPA.
4. Refresh documentation (CLAUDE.md, relevant docs) to describe the new structure and capture any architectural decisions.
