# Task: Sidebar Workspace Shell

## MVP Scope
- Design a responsive, foldable sidebar for the reader workspace.
- Display company branding, sign-up button, and mock list of uploaded papers.
- Include per-paper preview of the five reader tabs (Paper, Similar Papers, Patents, PhD Theses, Expert Network).
- Integrate sidebar into the paper reader layout without breaking existing content areas.

## Assumptions
- Sidebar is specific to the authenticated reader experience (`/paper/[doi]` routes).
- Mock data can live client-side for now; no persistence required.
- Site header may remain for marketing routes but can be hidden within the reader shell if redundant.
- Folding interaction can rely on local state and CSS transitions.

## Implementation Plan
1. **Data scaffolding** – Create a mock dataset describing uploaded papers and their tab summaries; expose via helper in `lib/mock-data` or a new module.
2. **Sidebar component** – Build a dedicated `ReaderSidebar` client component with fold/unfold state, responsive styling, and list rendering.
3. **Layout integration** – Update the paper reader layout to use a two-column shell combining the sidebar and existing content; ensure collapse mode works on smaller screens.
4. **Polish & docs** – Manual visual QA, document updated structure in `CLAUDE.md`, and note open follow-ups if any.

## Validation
- Sidebar toggles between expanded and collapsed states smoothly.
- Mock paper list renders with relevant tab metadata.
- Existing reader content remains accessible and visually balanced.

## Progress Notes (2025-10-17)
- Mocked paper library dataset with per-tab summaries.
- Implemented foldable ReaderSidebar with branding and sign-up actions.
- Integrated sidebar into paper layout, replacing the old annotation column.
- Tweaked layout/flex behaviour so the sidebar anchors left and stays sticky on desktop.

