# Gemini PDF Structuring Plan (v0.1)

## Minimum viable slice
- Keep the current upload → reader experience unchanged so the PDF still opens immediately in the paper tab.
- When a PDF becomes active, stream its native text layer in block-level reading order (include page + block metadata) and send it directly to Gemini 2.5 Flash using the supplied system prompt at temperature 0.
- Let Gemini perform the deterministic cleaning, structuring, and JSON generation per the provided instructions (no local text cleaning beyond assembling ordered blocks).
- Capture Gemini's response as strict JSON and store it in memory for the session along with extraction diagnostics.
- In non-reader tabs, show an "Extracting structured paper…" loader until the JSON arrives; once ready, render raw JSON for four debug views (e.g. Abstract, Sections, Figures, References) so we can verify correctness quickly.

## What we deliberately skip for v0.1
- No retry or backoff policy—first failure surfaces a clear `{ error, hint }` payload and logs the Gemini response.
- No chunking or batch inference until we confirm base flow (we'll slice by top-level headings later if we hit context limits).
- No persistent storage, Markdown rendering, or web-search integration yet.
- No downstream citation renumbering outside of what Gemini returns; we simply surface its output and diagnostics.

## Definition of done
- Uploading a PDF still displays it immediately in the reader tab.
- All other tabs show a loader while extraction is running and then swap to the raw JSON debug view once complete.
- Successful extractions display valid JSON constrained to the required schema (title, authors, abstract, keywords, sections, figures, tables, equations, references, acknowledgements, funding, conflicts, footnotes, warnings, missing_fields, source).
- Failures yield user-visible structured errors plus console logs for debugging (including Gemini's warnings/missing_fields when available).

## Implementation outline
1. **PDF text acquisition**
   - Use a server-side helper (e.g. `pdfjs-dist`) to iterate pages/blocks and assemble an ordered text array with minimal metadata (page number, block index, raw text).
   - Concatenate blocks into a Gemini input payload (e.g. JSON object with `source` info + ordered `blocks`) without additional cleaning.
2. **Gemini invocation**
   - Create a Gemini client wrapper that accepts the system prompt, raw block payload, temperature 0, and expects `application/json` response.
   - Validate the returned JSON against a TypeScript schema (Zod) to enforce required fields and default null/[] when missing; surface Gemini's warnings/missing_fields verbatim.
3. **API/service glue**
   - Add a server action or route (e.g. `/api/paper-structure`) triggered when a paper becomes active; cache results keyed by paper ID/storage path for the session.
   - Return `{ status, data, diagnostics }` or `{ error, hint }` to the client.
4. **UI wiring**
   - Extend the reader shell to subscribe to extraction state and broadcast to tabs (e.g. via context or existing sidebar state).
   - Non-reader tabs should display a neutral spinner + copy such as "Extracting structured paper…" while pending.
   - When ready, replace the loader with a debug inspector showing prettified JSON for four sections: Abstract, Sections (first pass only), Figures, References, along with warnings/missing_fields.
   - If the extraction fails, show an inline error banner plus any diagnostics returned so we can iterate quickly.

## Open questions / dependencies
- Confirm availability of Gemini 2.5 Flash credentials and network access; provide a mock adapter for local dev if not.
- Decide on block payload format (plain text vs. array of page-tagged blocks) that best fits the prompt.
- Establish maximum page/text size for v0.1 to avoid context overruns before chunking is implemented.
- Determine how/where to log Gemini responses safely (exclude sensitive content if necessary).
- Identify where to surface diagnostics (e.g. persist warnings/missing_fields in state vs. recomputing client-side) so failures are debuggable.
