# Research Groups Persistence & Styling Plan

## Minimum to Prove It Works (v0.1)
- Save the research-groups response to Supabase storage as `<storagePath>-groups.json` right after the agent succeeds.
- When a paper activates, load the stored JSON (if any) before hitting the agent so we can render immediately on refresh.
- Give the Research Groups panel a tidy card layout that matches the Similar Papers tab (no new functionality, just consistent typography/spacing).

## Skip for Now
- Persisting the follow-on contacts/theses payloads (keep the localStorage flow for this iteration).
- Deleting the JSON sidecars on paper delete (safe to defer; bucket cleanup still works).
- Fancy loading skeletons and pagination for large result sets.

## Definition of Done
- Uploading a remote-backed paper runs research groups once, persists the JSON, and the tab refreshes instantly on page reload without rerunning the agent.
- Research groups display in styled cards showing paper title, institutional info, and researcher contact badges.
- Error handling mirrors the current behaviour (console warnings, no user-facing regressions).

## Implementation Steps
1. **Supabase Helpers**: Add `saveResearchGroupsToStorage` and `loadResearchGroupsFromStorage` in `lib/user-papers.ts`, following the pattern of `saveSimilarPapersToStorage`.
2. **Reader Load Path**: In `app/page.tsx`, extend the research-groups `useEffect` to read from Supabase once per paper (with a simple ref guard) and hydrate state + local cache.
3. **Save on Success**: In `runResearchGroups`, after `writeCachedState`, push the structured payload to Supabase (fire-and-forget with console logging on failures).
4. **UI Polish**: Update `ResearchGroupsPanel` markup to use consistent spacing, highlight counts, and tidy contact chips, keeping the logic minimal.
