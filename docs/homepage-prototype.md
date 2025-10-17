# Homepage Prototype Overview

_Last updated: 2025-02-14_

## Current Experience
- The homepage (`/`) is a single page built around two elements: the drag-and-drop hero and a quiet “interactive reader” preview card.
- `HomepageApp` renders one restrained section that introduces the concept and displays the `PdfViewerMock`; no tabs, status chips, or multi-column layouts remain.
- Styling favours white cards, light slate borders, and generous spacing to keep the landing feel clean and marketing-friendly.

## Component Responsibilities
- `UploadDropzone` owns the hero headline, supporting copy, and dashed dropzone styling.
- `HomepageApp` provides the minimal preview block, describing what the reader unlocks and embedding the mock PDF frame.
- `PaperReaderContent` now simply wraps `PdfViewerMock`, serving as a placeholder until real reader features are reintroduced.
- `mock-data.ts` still exposes richer paper data for future iterations, but the landing page no longer consumes those helpers.

## Future Directions
1. Wire the dropzone to the actual upload workflow, showing progress in the preview card once a PDF is submitted.
2. Gradually reintroduce reader UI (tabs, annotations, expert lanes) only if user feedback asks for it on the landing experience.
3. Add authentication prompts and realtime status once Supabase integration is ready, keeping the styling minimal by default.
