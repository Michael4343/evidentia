# Claims Next Steps Checkboxes

## Minimal Working Slice
- Track toggle state for each Next Steps item in the claims panel using local component state.
- Replace the static SVG placeholder with real checkboxes that users can click or keyboard-toggle.

## Skipped for v0.1
- Persisting completion state beyond the current session.
- Adding bulk actions or counters for completed steps.
- Styling changes outside the Next Steps block.

## Definition of Done
- Each Next Steps row renders with an accessible checkbox that updates immediately on click.
- Checked rows show a subtle visual state change while keeping the rest of the layout intact.
- No console warnings or regressions when the structured claims data changes.
