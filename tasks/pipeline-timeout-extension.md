# Pipeline Timeout Extension Plan

## Minimum To Prove It Works
- Introduce a single timeout constant used by every client-side fetch in the upload pipeline (extraction through theses).
- Ensure each request is wrapped in an AbortController that allows up to five minutes (300,000 ms) before aborting.

## Skip For v0.1
- Do not refactor unrelated upload logic or consolidate fetch helpers beyond what is needed for the timeout.
- Avoid touching server-side timeouts unless required by the client change.

## Definition Of Done
- Every pipeline step (`/api/extract-text`, `/api/generate-claims`, `/api/similar-papers`, `/api/research-groups`, `/api/research-group-contacts`, `/api/researcher-theses`) respects the shared 5-minute timeout.
- Console logs confirm the new timeout duration when triggered.
- Manual retry no longer fails due to the previous shorter timeout values.
