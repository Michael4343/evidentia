# Research Group Search Agent Plan

## Minimum viable slice (v0.1)
- Accept a single uploaded PDF, extract roughly the first 15 pages of text server-side, and summarise the paper's publishing-related themes.
- Call OpenAI's Responses API with `gpt-5` (reasoning effort `medium`) plus the built-in `web_search` tool to derive search intents, run live lookups, and assemble sourced findings.
- If web search or model access fails, surface a structured error payload (`{ error, hint }`) so users see a clear message and logs capture the root failure; no automatic model downgrade.
- Return ranked, structured JSON (`[{ name, institution, focusAreas, highlights, url, contact, citations }]`) so the downstream UI can render sourced research groups.

## What we deliberately skip for now
- No UI wiring beyond a basic API route or server action we can hit via `curl`.
- No persistence of PDF text or search results; everything lives in-memory per request.
- No multi-PDF batching, background jobs, or deep research mode; we stick to one agentic pass per request.
- No caching, retries, or streaming UX while we validate the loop manually.

## Definition of done
- `POST /api/search-agent` accepts a PDF file (multipart), produces ranked research-group JSON, and surfaces inline citations for each item.
- A manual run locally demonstrates `gpt-5` invoking at least one `web_search` call and returning sourced results; failures produce clean JSON errors and useful logs instead of silent fallbacks.
- Error responses return informative JSON (`{ error, hint }`) rather than bare 500s.

## Implementation outline
1. **Model + tooling selection**
   - Default to `gpt-5` with `reasoning: { effort: "medium" }` so the agent can plan searches; expose env toggles for domain filters and feature gating but do not auto-downgrade models.
   - Register the native `web_search` tool (with optional domain filters for scholarly sources) and include citations in the response payload.
2. **PDF ingestion**
   - Introduce a lightweight Node PDF extractor (e.g. `pdf-parse`) capped at 15 pages to control tokens; normalise whitespace before handing content to the model.
3. **Agent orchestration**
   - Build a server utility that crafts the system prompt (paper summary + task spec), calls the Responses API, and validates the model output against a Zod schema to guarantee shape + citations.
   - Sort returned groups by model-provided score or citation density; fall back to deterministic ranking when absent.
4. **API surface**
   - Add `/api/search-agent` that handles multipart upload, guards payload size, and routes to the agent utility.
   - Wire env flags for web-search enablement and optional domain allow-listing.
5. **Manual validation**
   - Document a `curl` example including PDF upload and note error expectations when web search/model access fails; run a smoke test locally (with stubbed search disabled by default).

## Open questions / dependencies
- Confirm this environment can reach OpenAI web search (network + billing); otherwise we may need to block or swap in a third-party search API.
- Check for existing PDF text extraction helpers in the repo before adding `pdf-parse`.
- Validate rate limits and cost expectations for `gpt-5` medium reasoning so we can set sensible quotas.
