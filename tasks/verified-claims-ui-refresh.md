# Verified Claims UI Refresh

## What's the absolute minimum to prove this works?
- Reuse the existing mock verified claims layout when real uploads complete, including headers, badges, and evidence sections.
- Ensure non-mock runs gracefully display overall assessments or analyst notes even when structured claims are sparse.
- Confirm placeholders/loading states stay consistent with the rest of the pipeline.

## What can we skip for v0.1?
- Any new data fetching or prompt changes; focus on presentation only.
- Additional filtering, sorting, or advanced interactions inside the verified claims tab.
- Persisting new metadata fields beyond what already exists.

## How will we know it's done?
- Uploading a paper and running verified claims shows the same clean styling as the mock sample.
- Runs without structured claims still render a tidy analyst summary instead of a blank panel.
- Loading, error, and retry actions continue to work as expected.
