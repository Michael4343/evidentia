# DOI extraction remediation proposal

## Problem
Uploading a PDF currently triggers a client-side crash when `extractDoiFromPdf` dynamically imports `pdfjs-dist/legacy/build/pdf.mjs`. In the browser the module initialiser extends `exports` via `Object.defineProperty`, but Next.js wraps the ESM bundle in a way that leaves `exports` undefined, so the import throws before any parsing runs. As a result, the upload pipeline never reaches Supabase persistence.

## Goals
- Restore a working DOI detector that never blocks uploads.
- Keep the public helper signature (`extractDoiFromPdf(file): { doi, source }`).
- Reduce bundle risk by avoiding heavy dependencies for now.

## Proposed approach
1. Drop the `pdfjs-dist` dependency and replace it with a lightweight text scan.
2. Read the first 1MB (configurable) of the PDF via `File.slice().arrayBuffer()` and decode it with `TextDecoder`.
3. Normalise the decoded text by stripping binary characters and collapsing whitespace.
4. Run the existing DOI regex against the normalised text; return the first match.
5. If no match is found, scan metadata-style lines (`/doi`, `doi:`, `Identifier`) before returning `null`.
6. Treat any parsing errors as "not found" so uploads continue.

### Sketch implementation
```ts
const DOI_REGEX = /10\.\d{4,9}\/[\w.()/:;-]+/gi;
const SCAN_LIMIT = 1_000_000; // 1MB

async function readPdfPreview(file: File, limit = SCAN_LIMIT) {
  const chunk = file.slice(0, limit);
  const buffer = await chunk.arrayBuffer();
  const text = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  return text.replace(/[^ -~\n]+/g, " ");
}

export async function extractDoiFromPdf(file: File): Promise<ExtractedDoiResult> {
  try {
    const preview = await readPdfPreview(file);
    const match = preview.match(DOI_REGEX)?.[0];
    if (match) {
      return { doi: normaliseDoi(match), source: "text" };
    }

    const metadataHit = preview
      .split(/\n+/)
      .map((line) => line.trim())
      .find((line) => /doi\s*[:=]/i.test(line));

    if (metadataHit) {
      const candidate = metadataHit.split(/[:=]/)[1] ?? "";
      const cleaned = candidate.match(DOI_REGEX)?.[0];
      if (cleaned) {
        return { doi: normaliseDoi(cleaned), source: "metadata" };
      }
    }

    return { doi: null, source: "none" };
  } catch (error) {
    console.warn("Soft-failed DOI scan", error);
    return { doi: null, source: "none" };
  }
}
```

## Trade-offs
- Works for PDFs where the DOI appears uncompressed in the header/front matter (common for publisher copies).
- Compressed or image-only PDFs will still return `null`; we can revisit server-side parsing when required.
- Bundle size and runtime complexity drop significantly by removing `pdfjs-dist`.

## Validation plan
- Upload a paper with a known DOI (e.g. arXiv or PLOS article) and confirm the DOI surfaces under the viewer.
- Upload a PDF without a DOI to ensure we persist with `doi = null` and display the correct status message.
- Inspect Supabase `user_papers` rows to verify the DOI column matches expectations.

## Follow-ups (optional)
- Consider keeping the first 1MB chunk in memory to reuse for additional heuristics (e.g. title detection).
- If accuracy becomes a problem, revisit pdf.js via a web worker or server-side function where bundling constraints differ.


## Implementation status (2025-02-18)
- The browser helper now reads the first 1MB chunk with `TextDecoder` and applies the DOI regex.
- Metadata heuristics inspect lines containing `doi`/`identifier` tokens before returning `null`.
- All errors fall back to `{ doi: null, source: "none" }`, keeping uploads non-blocking.
