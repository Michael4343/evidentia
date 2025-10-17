# Halo Tabs Plan

## MVP Scope
- Refresh the five-tab horizontal reader control with the "halo tabs" visual treatment.
- Keep the vertical variant untouched so sidebar flows stay stable.
- Ensure the component remains accessible (focus states, aria) and responsive.

## Implementation Steps
1. Review current `PaperTabNav` usage to confirm required props and variants.
2. Update the horizontal layout to add the shared halo wrapper, pill buttons, and state styling.
3. Smoke-test the reader shell to confirm layout spacing, hover/focus states, and responsive behaviour.

## Assumptions
- Tailwind tokens already in the project will be sufficient (no new design tokens needed).
- The five-reader tabs remain the only items rendered; no overflow handling required yet.

## Open Questions
- Should we animate the halo on focus for keyboard users, or keep it static? (Default: static halo with focus-visible ring.)
