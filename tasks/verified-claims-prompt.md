# Verified claims prompt refresh

## Minimum viable slice
- Audit existing verify-claims script to understand current prompt structure.
- Identify key data points from claims, similar papers, research groups, theses, and patents that must feed the prompt.
- Rewrite the verification prompt so it grounds analysis in all gathered evidence and guides the agent to reassess each original claim’s status.

## Skip for v0.1
- No changes to cleanup prompt or JSON post-processing.
- No UI wiring changes beyond prompt text used in the mock workflow.
- No automation for pulling live Supabase data.

## Definition of done
- New prompt clearly instructs the agent to cross-check every claim with evidence from all sections and report updated verification outcomes.
- Script still runs without syntax errors and produces updated prompt preview.
- Manual review confirms prompt is tighter, emphasizes deep reasoning, and aligns with available mock data.
