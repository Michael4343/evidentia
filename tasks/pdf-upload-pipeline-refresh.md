# PDF Upload Pipeline Refresh

## What's the absolute minimum to prove this works?
- Introduce a single pipeline coordinator that runs extraction → claims → similar papers → research groups → patents → verified claims (with hooks to theses when groups succeed) in sequence for a new upload.
- Drive a visible stage tracker component off that coordinator so users always see the current step, countdown, and pending placeholders for the rest.
- Persist each stage’s output via the existing Supabase helpers as soon as it resolves, confirming we reuse cached data when re-opening a paper.

## What can we skip for v0.1?
- Advanced pause/resume controls or per-step retries beyond the existing retry buttons.
- Background polling for stages after the user navigates away from the paper reader.
- Full redesigns of tab content; stick to lightweight skeleton/placeholder states where data hasn’t arrived yet.

## How will we know it's done?
- Uploading a PDF reliably steps through the stages one at a time with a clear UI indicator and no overlapping API calls.
- The stage tracker updates to “done” immediately when data is ready and each tab shows the fetched content while the next stage runs.
- Refreshing or reopening the paper loads saved outputs from Supabase without re-triggering completed stages, and nothing falls out of the database.
