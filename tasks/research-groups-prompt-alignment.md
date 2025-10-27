# Research groups prompt alignment plan

## Minimum viable outcome
- Mock research groups generator emits the same first/last/corresponding author brief used by the live upload pipeline so downstream prompts stay consistent.

## Skip for v0.1
- Any refactors to cleanup JSON parsing or UI rendering – keep scope to discovery prompt text.
- Wider pipeline orchestration changes; just align prompt content.

## Definition of done
- CLI script enumerates authors as first/last/corresponding (deduped) instead of first three.
- Author listings match the concise block now used by the PDF upload flow (including identifiers and context wording).
- Prompt doc in `scripts/prompts/` matches the updated output so operators see the new format.
