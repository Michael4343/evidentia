# PhD Thesis Prompt Helper Plan

## Minimum viable slice
- Add a CLI script that reuses the existing mock library to build a thesis-focused research prompt and cleanup prompt.
- Accept cleaned JSON and persist it alongside the mock library so the UI can render structured thesis data.

## Skip for v0.1
- No automated validation beyond JSON parsing/shape checks.
- No API integration or supabase wiring; script only touches mock library.
- No extensive error handling for partial thesis metadata.

## Definition of done
- Script runs locally, copies both prompts to the clipboard, and writes normalised thesis data into the mock file.
- Mock library gains a `researcherTheses` block with formatted text + structured array.
- Manual review confirms prompts emphasise latest publications, thesis lookup, and data availability hints.
