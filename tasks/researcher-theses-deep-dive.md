# Researcher Thesis Deep Dive Helper

## Minimum viable slice
- Add a CLI script that loads the mock library, lists available papers with thesis data, and allows the analyst to pick one.
- After selecting a paper, list its research groups with any existing thesis records so the analyst can target a single group.
- Generate a focused discovery prompt (based on the provided example) scoped to the chosen group and copy it to the clipboard.
- Provide a cleanup prompt for structuring the follow-up JSON response and accept the pasted JSON to update the mock library under a new deep-dive block.

## Skip for v0.1
- No Supabase persistence or UI wiring; data stays in the mock file only.
- No fuzzy matching between group names; rely on exact names surfaced by the script.
- No automatic validation beyond JSON parsing/basic shape checks.

## Definition of done
- Script runs locally end-to-end: selection, prompt generation, clipboard copy, JSON ingestion, and mock write.
- Mock library gains a `researcherTheses.deepDives` (or similar) structure capturing per-group deep dive results.
- Discovery prompt mirrors the supplied detailed instructions, and cleanup prompt enforces a strict JSON schema for the UI to consume later.
