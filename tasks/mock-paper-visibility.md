# Mock Paper Visibility Plan

## Minimum viable approach
- Identify where the mock paper data enters the reader flow and gate it behind an unauthenticated check.
- Use existing auth state (likely Supabase session) to conditionally include the mock data when no user is logged in.

## Skip for v0.1
- No refactors to the data fetching architecture.
- No additional UI changes beyond hiding the mock paper for logged-in users.
- No new tests unless already wired up in project.

## Definition of done
- Logged-in state no longer shows the mock paper entry.
- Logged-out visitors still see the mock paper so the UI remains populated.
- No runtime errors introduced (verify in console if possible).
