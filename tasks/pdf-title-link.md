# PDF Title Linking Plan (Shelved)

We paused the title extraction work after customer feedback showed inconsistent metadata. The upload flow now reverts to showing the cleaned file name.

## Status
- ✅ DOI extraction remains in place.
- ❌ Title extraction heuristics are disabled until we have higher-fidelity metadata.

## Notes
- When resuming, ensure we can differentiate between heuristic guesses and authoritative titles before persisting to Supabase.
- Consider gating future experiments behind a feature flag to avoid regressions in the main flow.
