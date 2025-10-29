# Patent Source Links

## Minimal Working Slice
- Identify how patent titles are rendered in the patents tab and expose them as hyperlinks when we have a URL or number that can be transformed into one.
- Reuse the existing paper link helper so we stay consistent with DOI handling.

## Skipped for v0.1
- Persisting click analytics or external tracking.
- Adding new metadata to the patent cards beyond turning titles into links.
- Changing layout or typography outside the anchor treatment.

## Definition of Done
- Patent titles become clickable anchors that open in a new tab when we have a resolvable link.
- Entries without linkable metadata stay as plain text.
- No TypeScript or runtime warnings are introduced by the change.
