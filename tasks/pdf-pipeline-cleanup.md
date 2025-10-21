# PDF Pipeline Cleanup Plan

## Minimal Viable Changes
- Load all cached Supabase artifacts (claims, similar papers, research groups, patents, verified claims, theses, contacts) before kicking off any pipeline work.
- Suppress automatic pipeline re-runs when a stored paper is opened; only run if the selected paper is brand new or storage lacks required artifacts.
- Ensure pipeline status UI reflects "loaded from library" states without flashing through the search stages.

## Skipped For v0.1
- Persisting or reusing PDF extraction payloads (we only gate pipeline off downstream artifacts for now).
- Background refresh or stale-data detection; users must trigger explicit retries if they want fresh searches.
- Broader refactors of pipeline composition or API handlers.

## Definition of Done
- Opening a previously saved paper pulls data from Supabase without triggering new search/API calls unless essential data is missing.
- Pipeline tracker stays steady (no loading spinner) for fully cached papers.
- Brand-new uploads still run the full pipeline end-to-end automatically.
- Manual retry buttons continue to force the relevant stages to run.
