# PDF Viewer Full Width

## Goal
Remove unintended borders/padding so PDF mock fills available reader area on paper view.

## Plan
1. ✅ Confirm which component wraps the PDF content and identify styling that constrains it.
2. ✅ Adjust container classes to eliminate extra border/background while keeping layout integrity.
3. ⏳ Manually verify paper view to ensure PDF occupies full width without regressions (pending live UI check).

## Notes
- Reuse existing Tailwind tokens; avoid custom CSS if not needed.
- Viewer now expands edge-to-edge when a paper is selected; status messages collapse during active viewing to avoid visual clutter.
