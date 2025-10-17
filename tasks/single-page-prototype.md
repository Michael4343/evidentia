# Single Page Prototype Plan

## Goal
Transform the app into a single-page reader prototype that always renders the sidebar alongside core reader content, ensuring the sidebar is visible on the landing experience.

## Steps
1. ✅ Consolidate the reader layout into a reusable shell component that combines the sidebar and main reader content.
2. ✅ Update the root route (`app/page.tsx`) to use the shell with a default mock paper, keeping the experience self-contained.
3. ✅ Reuse the same shell for the dynamic paper route to avoid duplication and maintain consistent behaviour.
4. ✅ Refresh documentation (`CLAUDE.md`) with the latest directory snapshot and note the prototype setup.
