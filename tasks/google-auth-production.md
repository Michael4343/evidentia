# Fix Google auth failure in production

## What's the absolute minimum to prove this works?
- Trigger the Google sign-in flow against the deployed Vercel build and confirm Supabase completes the OAuth exchange, returning to the app with a valid session (user visible as signed-in).

## What can we skip for v0.1?
- No automated tests or PostHog instrumentation changes.
- Skip adding new UI for auth callbacks or profile handling beyond what already exists.
- Avoid broader Supabase schema or server-side changes unless directly required for the Google flow.

## How will we know it's done?
- Google sign-in completes successfully on production without the `Unable to exchange external code` error.
- Manual verification shows the user session hydrating in UI post-redirect (e.g., sign-in button shows signed-in state).
- Document any configuration instructions (e.g., Supabase or Google console settings) that must be applied alongside the code change.
