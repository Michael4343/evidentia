# Paper Title Links

## Minimal Working Slice
- Identify paper title renderings on the similar papers tab and ensure each title resolves to a clickable link when we have a DOI, URL, or identifier we can convert into a URL.
- Reuse the same link resolution logic for both the mock showcase and the live similar papers view.

## Skipped for v0.1
- Updating other tabs (patents, theses, claims evidence) unless they render paper tiles.
- Styling changes beyond the default link underline/hover treatment.
- Persisting any analytics or tracking for clicks.

## Definition of Done
- Every paper tile title renders as an anchor element that opens the source in a new tab when we have linkable metadata.
- Titles without sufficient metadata keep their existing static text.
- No console warnings or TypeScript errors introduced.
