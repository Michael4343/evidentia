# Single Page App Refresh Plan

## Goal
Deliver a single-page experience that keeps Evidentia's landing hero simple and clean while embedding the paper reader prototype below for quick demos.

## MVP Scope
- Preserve the minimal dropzone hero from the previous landing page.
- Render the reader preview within the same page using lightweight styling that matches the clean aesthetic.
- Ensure tab switching and paper selection stay client-side without routing.

## Steps
1. **Reintroduce SPA Shell** – Render `HomepageApp` from the landing route while keeping the hero section visually identical.
2. **Simplify Reader Components** – Trim excessive chrome (sidebars/shadows) so the reader feels aligned with the hero's minimal style.
3. **Wire Mock Data** – Feed mock paper data into the SPA, keeping copy concise and consistent.
4. **Docs & Snapshot** – Update documentation and `CLAUDE.md` snapshot to describe the new single-page structure.

## Notes
- Avoid anchor-based navigation; rely on in-page state for smoothness.
- Do not alter authentication or backend assumptions.
- Keep Tailwind classes minimal—prefer white backgrounds and subtle borders.
- Docs refreshed on 2025-02-14 to describe the simplified single-page marketing experience.
