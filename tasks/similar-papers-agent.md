# Similar papers agent plan

## Minimum viable
- Server endpoint that builds the provided prompt, sends GPT-5 the paper context, and returns the raw text result.
- Frontend state + fetch that runs once extraction succeeds, stores the response, and shows it in the Similar Papers tab.
- Basic retry path so the user can re-trigger the agent if the call fails.

## Skip for v0.1
- Structured parsing or validation beyond checking non-empty text.
- Fancy UI (cards, matrices) for the tab; plain text output is acceptable.
- Persisting more than the primary response (no contact extraction or follow-up tooling yet).

## Done criteria
- Uploading a PDF triggers the similar-papers agent after extraction and caches the generated write-up.
- Visiting the Similar Papers tab displays the agent response or friendly loading/error states.
- Manual reload of the tab or retry button reuses cached data or re-runs the agent without throwing unhandled errors in the console.

## Implementation steps
1. Create `/api/similar-papers` route that assembles the prompt, truncates the extracted text, calls GPT-5 mini with web search, and returns the text payload.
2. Add `SimilarPapersState` on the client with caching, retry helper, and effect that kicks off the fetch when extraction succeeds.
3. Implement a `SimilarPapersPanel` mirroring existing loading/error/success patterns and wire it into the tab renderer.
4. Sanity-test locally: upload a PDF, confirm the agent runs, inspect caching/retry, and adjust copy if needed.
