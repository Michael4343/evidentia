# Header Cleanup Plan

## Task
Simplify the tab strip so the five reader buttons render as a consistent, minimal header for the single page app.

## Assumptions
- The sticky bar in `app/page.tsx` remains the container for the header.
- Tabs continue to drive page state; only presentation changes.
- Mobile should keep a single-row, scrollable treatment if space gets tight.

## Implementation Steps
1. Refine the sticky header wrapper styles (spacing, borders, alignment) in `app/page.tsx` so it reads as a cohesive header.
2. Simplify `PaperTabNav` horizontal styling (padding, gaps, hover/active treatments) for an even five-button layout that adapts responsively.
3. Smoke-test the main page layout to confirm header spacing feels consistent on common breakpoints and update docs if behaviour changes.

## Completion Criteria
- Header presents as a single horizontal row with balanced spacing across viewports.
- Active tab remains visually distinct without heavy shadows or halos.
- No regressions to vertical variant used in the sidebar shell.
