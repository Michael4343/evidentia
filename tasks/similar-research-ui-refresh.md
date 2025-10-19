# Similar & Research UI Refresh

## Minimum viable changes
- Restyle the Similar Papers view in `app/page.tsx` so the generated dossier reads like a brief with clear sections and typography, without introducing new components.
- Rework the Research Groups section in the same file to read as a linear brief: emphasize paper context, group summaries, and contact tables without tile/card styling.
- Smoke-check the JSX compiles and types by running `npm run build` mentally or via TypeScript intuition (no extra tooling needed).

## Skip for v0.1
- No new shared abstractions or component extractions.
- No state shape changes or API calls; keep all sample data intact.
- No additional styling libraries beyond existing Tailwind classes.

## Definition of done
- Similar Papers and Research Groups render with the new typography/layout and remain fully readable for the provided mock content.
- Build succeeds (or TypeScript shows no new errors) after modifications.
- Manual glance in the running dev server confirms the content is easy to scan (or we note why it couldn't be checked).
