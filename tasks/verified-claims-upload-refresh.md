# Verified Claims Upload Refresh Plan

## Minimal Viable Outcome
- Align the verified claims PDF upload pipeline with the improved cleanup prompt spec used in the mock helper.
- Ensure the live workflow aggregates upstream evidence (claims, patents, research groups, theses, similar papers) and sends it through the verification steps.
- Render the upgraded Verified Claims UI for real uploads using the pipeline response.

## Skipped for v0.1
- No retries/backoff mechanics beyond existing behaviour.
- No new database schema changes; reuse current storage.
- No additional analytics or logging beyond what is already in place.

## Definition of Done
- Uploading a PDF through the normal flow triggers generation of verified claims using the updated prompt guidance.
- The Verified Claims tab shows populated data for non-mock entries with the refined layout.
- Manual verification via the running app confirms the end-to-end experience without console errors.

## Task Steps
1. Map existing verified claims API route and pipeline usage to understand inputs/outputs.
2. Update prompt construction / cleanup instructions to match the new spec.
3. Ensure pipeline wiring pulls the necessary upstream evidence and stores structured output.
4. Manually test by running through an upload and reviewing the Verified Claims tab.
