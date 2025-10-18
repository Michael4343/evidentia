# Text Extraction Bug Fix Plan

## Minimum viable path
- Reproduce the current extraction error and locate the code path using a hard-coded local PDF path
- Replace the local filesystem assumption with fetching the PDF bytes from Supabase storage (or current storage API) before running extraction
- Verify extraction succeeds for the stored paper shown in the reader

## Skip for v0.1
- No background queues or retries
- No abstractions for multiple storage backends
- No UI polish beyond showing success/failure

## Definition of done
- Extraction uses the Supabase-stored PDF instead of a local path and succeeds for the paper in the reader
- Reader no longer shows the "Extraction failed" message for that paper
- No new console errors are introduced while viewing the paper
