# Reader Header Simplification Plan

## MVP Scope
- Merge the hero details, status surface, and halo tabs into a single, minimal reader header.
- Keep the layout responsive and preserve vertical tab experience elsewhere.
- Ensure landing page components keep working, reusing the new header only where appropriate.

## Implementation Steps
1. Create a consolidated `PaperReaderHeader` component that renders paper metadata plus the halo tabs.
2. Replace the separate status banner, hero, and tab nav stack inside reader shells/layouts with the new header.
3. Manual UI pass: confirm spacing and typography across desktop breakpoints and update project docs.

## Assumptions
- The paper detail payload will continue to include status/metadata used in the hero.
- Status messaging can be reduced to a chip inside the header for now; detailed logs can return later if needed.

## Open Questions
- Do we still need a persistent processing log action surfaced, or can it move into a secondary menu?
- Should the abstract remain visible by default, or collapse behind a disclosure in tighter layouts?
