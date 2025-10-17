export interface ExtractedDoiResult {
  doi: string | null;
  source: "text" | "metadata" | "none";
}

const DOI_REGEX = /10\.\d{4,9}\/[-._;()/:A-Z0-9]+/gi;
const SCAN_LIMIT_BYTES = 1_000_000; // read first 1MB of the PDF for quick scanning

function normaliseDoi(raw: string): string {
  return raw.replace(/[\s<>\]\).,;:]+$/g, "").replace(/^[\s"'(<\[]+/g, "").toLowerCase();
}

function sanitisePdfSegment(raw: string): string {
  // keep line breaks for metadata heuristics but strip non-printable chars
  const withoutControlChars = raw
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]+/g, " ");

  return withoutControlChars.replace(/[ \t]+/g, " ");
}

async function readPdfPreview(file: File, limit = SCAN_LIMIT_BYTES) {
  const chunk = file.slice(0, limit);
  const buffer = await chunk.arrayBuffer();
  const decoder = new TextDecoder("utf-8", { fatal: false, ignoreBOM: true });
  const decoded = decoder.decode(buffer);
  return sanitisePdfSegment(decoded);
}

function findMetadataLine(text: string): string | null {
  const lines = text.split(/\n+/).map((line) => line.trim()).filter((line) => line.length > 0);
  for (const line of lines) {
    if (/doi\s*[:=]/i.test(line) || /^doi\b/i.test(line) || /identifier\s*[:=]/i.test(line)) {
      return line;
    }
  }
  return null;
}

export async function extractDoiFromPdf(file: File): Promise<ExtractedDoiResult> {
  try {
    const preview = await readPdfPreview(file);

    const directMatch = preview.match(DOI_REGEX);
    if (directMatch && directMatch.length > 0) {
      return { doi: normaliseDoi(directMatch[0]), source: "text" };
    }

    const metadataLine = findMetadataLine(preview);
    if (metadataLine) {
      const metadataMatch = metadataLine.match(DOI_REGEX);
      if (metadataMatch && metadataMatch.length > 0) {
        return { doi: normaliseDoi(metadataMatch[0]), source: "metadata" };
      }
    }

    return { doi: null, source: "none" };
  } catch (error) {
    console.warn("Soft-failed DOI scan", error);
    return { doi: null, source: "none" };
  }
}
