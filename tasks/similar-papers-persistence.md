# Similar Papers Persistence Plan

## Minimum to Prove It Works (v0.1)
- Reuse the existing Supabase `papers` bucket: write the similar-papers payload next to the PDF as `<storagePath>-similar.json`.
- Load that JSON when a paper with `storagePath` is activated so we can skip regeneration if we already have data.

## Nice-to-Have Later (definitely skip for now)
- Versioning the cached payloads.
- Cleaning up stale JSON on delete/refine.
- Handling partial writes or diffing structured data.

## Definition of Done
- Uploading a new remote-backed paper persists the similar-papers response to Supabase after it succeeds.
- Refreshing the app reloads the stored JSON and hydrates the Similar Papers panel without hitting the agent endpoint again.
- Errors during save/load show up in the console but do not break the happy path.

## Implementation Steps
1. **Supabase Helpers**: Add `saveSimilarPapersToStorage` and `loadSimilarPapersFromStorage` utilities in `lib/user-papers.ts`, mirroring the existing claims helpers but targeting `-similar.json`.
2. **Write Flow Hook**: In `runSimilarPapers`, after a successful response, call the new saver when `paper.storagePath` exists; log and continue if it fails.
3. **Read Flow Hook**: When activating a remote paper, attempt to read `-similar.json` via the new loader before calling the agent. If data exists, seed `similarPapersStates` with it and short-circuit the fetch.
4. **Local Cache Alignment**: When Supabase data is loaded, update `writeCachedState` so subsequent sessions still leverage localStorage, keeping the current UX intact.
