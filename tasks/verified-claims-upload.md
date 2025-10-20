# Verified Claims Upload Integration

## What's the absolute minimum to prove this works?
- Add a verified-claims API route mirroring the prompt+cleanup flow that synthesises claims, similar papers, research groups, theses, and patents.
- Trigger the verified-claims run once all required upstream stages succeed, with caching + Supabase persistence so results survive refreshes.
- Render the verified claims tab with loading/error/retry states, falling back to mock content when appropriate.

## What can we skip for v0.1?
- Granular progress indicators per sub-evidence source (single spinner is fine).
- Advanced diffing/merge logic when upstream inputs change; initial version can recompute on demand.
- Extra analytics or instrumentation around usage.

## How will we know it's done?
- Uploading a PDF eventually shows structured verified claims driven by the live pipeline, not mock data.
- Reloading a processed paper restores cached verified claims without rerunning the model.
- Failures are surfaced clearly with a retry option.
