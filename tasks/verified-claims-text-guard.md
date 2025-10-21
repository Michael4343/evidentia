# Verified Claims Text Guard

- **Minimum viable change:** Add a status check before reading `state.text` so TypeScript understands the value is only accessed when available.
- **Skip for v0.1:** Broader refactors of the verified claims panel or lint warning cleanup.
- **Definition of done:** `next build` succeeds locally with the type error gone.

## Plan
1. Inspect the `VerifiedClaimsPanel` logic to confirm where `state.text` is used without checking status.
2. Update the code to gate access to `state.text` behind a `status === "success"` check.
3. Re-run the build to verify the error is resolved.
