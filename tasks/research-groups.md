# Research Groups Deep Search Plan

## Minimum viable proof
- Add a new `Research Groups` tab that appears whenever a paper is loaded.
- When the tab is activated for a paper that already has extracted text, post that text plus the provided deep-research prompt to a new Responses API bridge that targets GPT-5 with reasoning enabled and web search turned on.
- Render the model's `output_text` inside the tab with concise loading and error placeholders so we can validate the end-to-end experience.

## What we skip for v0.1
- Persisting outputs or reasoning items; every tab visit can trigger a fresh call.
- Rich formatting, citation expansion, or streaming UI.
- Advanced prompt budgeting beyond a simple max-token / text truncation guard.
- Retry logic, background refresh, or Supabase storage of results.

## Implementation steps
1. **Tab plumbing** – Extend `readerTabs`/`ReaderTabKey` with `researchGroups`, wire the selector, and mount a matching panel next to the existing tabs.
2. **Client-side orchestration** – Track per-paper research state, trigger the fetch when the tab opens and text is ready, and surface loading/error/success states.
3. **Responses API bridge** – Create `/api/research-groups` that accepts the extracted text, trims it to a safe length, and calls `client.responses.create` with `model: "gpt-5"`, `reasoning: { effort: "high" }`, and `tools: [{ type: "web_search" }]`, returning the resulting `output_text` (and a readable error on failures).

## Definition of done
- Selecting `Research Groups` on a paper with extracted text issues one GPT-5 Responses API call (with web search) and displays the returned write-up.
- Failures render a clear inline error instead of crashing the page.
