# PDF Title Extraction Notes (Retired)

As of 2025-02-18 (Step 14c) we rolled back the experimental title extraction heuristics.

## Current Behaviour
- We display the uploaded file name without the `.pdf` suffix in the library sidebar and when persisting metadata.
- If the cleaned file name is empty, we fall back to the raw file name and finally `"Untitled paper"`.

## Historical Context
- The removed heuristics scanned the first chunk of the PDF for `/Title(...)` metadata and keyworded lines.
- We reverted after confirming the extraction produced inconsistent results for customer uploads.

Keep any future experiments in a separate helper so we can toggle them behind a feature flag without touching the core upload flow.
