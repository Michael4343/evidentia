# Extract Text 413 Payload Bug

## Absolute minimum to prove this works
- Understand how `/api/extract-text` accepts data and why the payload exceeds the production limit
- Trim or restructure the upload so a normal paper processes without triggering 413

## What we can skip for v0.1
- Fancy progress indicators or resume uploads
- Handling extreme edge-case PDF sizes beyond the current prototype scope

## How we'll know it's done
- Reproduction PDF succeeds against production-like limits
- API returns extracted text instead of a 413 and the UI renders it without console errors

## Plan
1. Inspect the client upload flow and `/api/extract-text` handler to confirm data sent and any existing size limits.
2. Implement the smallest change that keeps payload under limit (e.g. send Supabase file path or compress body) while keeping dev flow working.
3. Validate locally with a large-ish PDF and ensure the request shape matches production expectations.
