# Claims Tab Mock Flow

## Minimum Viable Slice
- Add a `Claims` tab between `Paper` and `Similar Papers` in the reader nav with minimal wiring.
- Surface the static claims/gaps writeup for the homepage mock paper using existing mock data plumbing.
- Provide a companion script that extracts PDF text, assembles the claims prompt, and accepts cleaned JSON to update the mock library.

## Intentionally Deferred for v0.1
- Live API integration to run claims analysis for user uploads.
- Automated validation of analyst JSON beyond basic shape checks.
- Styling polish beyond reusing existing reader panel layouts.

## Definition of Done
- `Claims` tab shows up in the homepage mock between `Paper` and `Similar Papers` and is keyboard-click navigable.
- Selecting the tab renders the mock claims summary pulled from the library file; non-mock papers get a clear placeholder.
- New script produces the prompt (with raw text) + cleanup prompt, accepts pasted JSON, and persists it into `lib/mock-similar-papers.ts` without breaking existing fields.
- Manual smoke check: tab switches correctly, mock content loads, script round-trip tested on sample PDF snippet.
