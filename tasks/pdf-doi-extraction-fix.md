# PDF DOI extraction fix

## Context
- Upload flow fails when importing `pdfjs-dist/legacy/build/pdf.mjs` in the browser.
- Runtime error (`Object.defineProperty` called on non-object) prevents DOI extraction and blocks persistence.
- Supabase persistence already expects a DOI string or null; we only need a lightweight detector that works reliably in the browser.

## MVP scope
- Extract a DOI (when present) without relying on `pdfjs-dist` so uploads succeed again.
- Keep the helper resilient: treat failures as "not found" rather than blocking uploads.
- Keep the surface API (`extractDoiFromPdf`) unchanged so the rest of the flow keeps working.

## Proposed steps
1. Replace the `pdfjs-dist` dependency with a text-scan helper that inspects the first ~1MB of the PDF using `TextDecoder` and a DOI regex.
2. Normalise matches (trim punctuation, lowercase) and short-circuit once we find the first hit.
3. Add lightweight heuristics for metadata blocks (look for `doi`, `DOI`, or `Identifier` lines) before falling back to `null`.
4. Update documentation with the new extraction strategy and note trade-offs (compressed/obfuscated PDFs may still require a future server-side parser).

## Validation
- Upload a PDF with an obvious DOI near the front matter and confirm persistence logs the DOI.
- Upload a PDF without a DOI (or compressed text) and confirm we store `null` but still persist the file.
- Review Supabase rows to ensure existing schema expectations still hold.
