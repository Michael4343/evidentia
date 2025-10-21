# Mock data pipeline cleanup

## Minimum viable outcome
- Each existing landing-page mock generator script runs end-to-end without manual patching.
- Stage 1 (prompt generation) and Stage 2 (JSON paste) are explicit, consistent, and copy prompts to the clipboard.
- A master runner can execute the individual scripts in sequence for a chosen mock entry.

## Safe-to-skip for v0.1
- Fancy TUI or GUI abstractions; stick with readline prompts.
- Automated tests; rely on manual dry runs given the interactive flow.
- Refactoring unrelated utilities outside the mock data scripts.

## Done when
- Reworked scripts are simpler to read, share common helpers, and still write `lib/mock-similar-papers.ts` correctly.
- Master script completes sequential execution with clear handoffs between stages.
- Manual spot-run confirms prompts copy, JSON ingest works, and resulting mock entry renders on landing page.

## Plan
1. Map current script responsibilities, note shared logic (prompt building, PDF discovery, clipboard handling, JSON ingest) and any breakages.
2. Extract/shared helper(s) to unify two-stage execution and update each generator script to the new pattern.
3. Build a `run-mock-pipeline.js` master script to chain the individual generators with reuse of the shared helper.
4. Smoke-test each script individually and the master pipeline, adjusting docs/usage notes if anything changed.
