# Similar Papers Supabase Cache Bug

## Minimum to Prove It Works (v0.1)
- When a stored similar-papers JSON exists in Supabase, activating that paper should hydrate the UI without calling `/api/similar-papers`.
- The browser console should show a storage load log instead of the discovery phase logs from the API route.

## Skip for v0.1
- No retries or background refreshes once cached data is loaded.
- No schema migrations or Supabase cleanup for legacy records.
- No UI polish beyond clearing the repeated loading state.

## Definition of Done
- Switching to a paper with existing cached similar-papers data only triggers a Supabase download, not a new OpenAI request.
- The Similar Papers panel renders the stored text/structured payload after refresh without manual retries.
- Console logs confirm we short-circuited API generation when cached data is present.

## Implementation Steps
1. Reproduce the race where storage loading sets `status: "loading"` but the generation effect still fires, causing redundant API calls.
2. Update the effect guard to recognise an in-flight storage fetch and wait for it to resolve before hitting the API.
3. Double-check that the storage loader clears or updates refs so subsequent retries still work when Supabase lacks data.
4. Verify manually by refreshing with a cached paper and confirming no discovery logs appear.
