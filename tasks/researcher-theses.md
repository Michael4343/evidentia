# Researcher Theses + Latest Work Plan

## Minimum viable proof
- Once research group contacts resolve, collect the unique researcher names and request a follow-up model call that returns (a) their most recent publication, (b) PhD thesis title/year if mentioned, and (c) whether underlying data is publicly available.
- Surface this information inside the existing "PhD Theses" tab so the contact tables remain focused while thesis info gets its own space.

## What we skip for v0.1
- Validating publication metadata or DOI accuracy.
- Deduplicating researchers across different groups (we’ll rely on the model’s output).
- Persisting or caching the thesis results.
- Handling pagination or extremely large researcher lists—assume up to ~25 names.

## Implementation steps
1. **API bridge** – Create `/api/researcher-theses` that accepts the structured contacts array and runs GPT-5 mini with a prompt requesting latest publication, thesis details, and data availability flag per researcher.
2. **Client flow** – After contact lookup succeeds, trigger the thesis endpoint, manage its loading/error state separately, and store per-paper results.
3. **UI integration** – Replace the placeholder in the `theses` tab with a panel that renders the thesis results (loading/error/empty states plus per-researcher cards/table).

## Definition of done
- Visiting the Research Groups tab now cascades through contacts and thesis lookups without blocking the main summary.
- Opening the "PhD Theses" tab shows the fetched researcher information; on failure it displays a clear error message.
