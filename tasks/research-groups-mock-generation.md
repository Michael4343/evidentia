# Research Groups Mock Generation Plan

## Minimum viable proof
- Reuse the existing PDF selection + extraction flow to produce a second clipboard prompt tailored for the research groups agent.
- Capture the agent's plain-text response and persist it alongside the similar papers mock so the landing page has static copy to render.

## What we skip for v0.1
- Fancy parsing or validation of the research groups narrative; treat it as a raw text blob.
- Separate storage files or schema migrations—append to the current mock payload instead.
- Any UI wiring; goal is the data pipeline only.

## Implementation steps
1. Map the current script flow and factor helpers so we can plug in a second prompt/output cycle without breaking the similar papers path.
2. Add a research groups prompt builder (mirroring the API route) and hook it into the clipboard + console guidance flow after similar papers JSON is handled.
3. Extend the mock file writer to include the research groups text and optionally note when no response was supplied.

## Definition of done
- Running `node scripts/generate-similar-papers.js` still guides similar paper generation, then offers a research groups prompt using the same PDF context.
- Supplying both outputs regenerates the mock file with `similarPapers` JSON and a stored research groups narrative.
- Skipping either payload leaves existing mock data untouched without crashes.
