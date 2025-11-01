## Goal
Identify why the PDF viewer occasionally fails to load documents in the browser.

## Minimum Viable Steps
1. Read the current PDF viewer implementation to understand how documents are fetched and rendered.
2. Trace the network/storage flow for PDF retrieval to spot assumptions or missing fallbacks.
3. Correlate the failing fetch path with browser constraints (CORS, auth, storage) to isolate the root cause.

## Definition of Done
- Cause of the "Direct PDF fetch failed" error is clearly understood and documented for follow-up fixes.
