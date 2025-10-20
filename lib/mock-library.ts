import { MOCK_SIMILAR_PAPERS_LIBRARY } from "./mock-similar-papers";

const FALLBACK_ENTRY_ID = "mock-similar-paper";
const FALLBACK_PUBLIC_PDF = "/mock-paper.pdf";

export type RawMockLibrary = typeof MOCK_SIMILAR_PAPERS_LIBRARY;

export type RawMockLibraryEntry = {
  id?: string;
  generatedAt?: string;
  updatedAt?: string;
  label?: string;
  sourcePdf?: {
    path?: string | null;
    publicPath?: string | null;
    title?: string | null;
    doi?: string | null;
    pages?: number | null;
  } | null;
  sourcePaper?: {
    title?: string | null;
    summary?: string | null;
    keyMethodSignals?: readonly string[] | null;
  } | null;
  agent?: Record<string, unknown> | null;
  claimsAnalysis?: Record<string, unknown> | null;
  similarPapers?: unknown;
  researchGroups?: unknown;
  researcherTheses?: unknown;
  patents?: unknown;
  verifiedClaims?: unknown;
  researchContacts?: unknown;
  [key: string]: unknown;
};

export interface MockLibraryEntrySummary {
  id: string;
  title: string;
  fileName: string;
  pdfUrl: string;
  doi: string | null;
  raw: RawMockLibraryEntry;
}

function normaliseId(candidate: string | undefined, fallback: string) {
  if (candidate && typeof candidate === "string") {
    const trimmed = candidate.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return fallback;
}

function deriveFileName(sourcePdf: RawMockLibraryEntry["sourcePdf"], fallbackId: string) {
  const rawPath = typeof sourcePdf?.path === "string" ? sourcePdf.path.trim() : "";
  if (rawPath.length > 0) {
    const segments = rawPath.split(/[\\/]/).filter(Boolean);
    const last = segments[segments.length - 1];
    if (last) {
      return last;
    }
  }
  return `${fallbackId}.pdf`;
}

function derivePdfUrl(sourcePdf: RawMockLibraryEntry["sourcePdf"], fallbackId: string) {
  const raw = typeof sourcePdf?.publicPath === "string" ? sourcePdf.publicPath.trim() : "";
  if (raw.length > 0) {
    return raw.startsWith("/") ? raw : `/${raw}`;
  }

  // Legacy datasets only expose the default mock path.
  if (typeof sourcePdf?.path === "string" && sourcePdf.path.trim().length > 0) {
    return FALLBACK_PUBLIC_PDF;
  }

  // Fall back to deterministic path for new entries even if the file is missing.
  return `/mock-papers/${fallbackId}.pdf`;
}

function deriveTitle(entry: RawMockLibraryEntry, fallbackFileName: string) {
  const fromEntry = entry?.sourcePaper?.title;
  if (typeof fromEntry === "string" && fromEntry.trim().length > 0) {
    return fromEntry.trim();
  }

  const fromPdf = entry?.sourcePdf?.title;
  if (typeof fromPdf === "string" && fromPdf.trim().length > 0) {
    return fromPdf.trim();
  }

  return fallbackFileName.replace(/\.[^.]+$/, "");
}

function deriveDoi(entry: RawMockLibraryEntry) {
  const doiFromPdf = entry?.sourcePdf?.doi;
  if (typeof doiFromPdf === "string" && doiFromPdf.trim().length > 0) {
    return doiFromPdf.trim();
  }
  const doiFromSource = (entry?.sourcePaper as Record<string, unknown> | null)?.doi;
  if (typeof doiFromSource === "string" && doiFromSource.trim().length > 0) {
    return doiFromSource.trim();
  }
  return null;
}

function coerceEntry(rawEntry: RawMockLibraryEntry | null | undefined, fallbackId: string): MockLibraryEntrySummary {
  const id = normaliseId(typeof rawEntry === "object" && rawEntry ? (rawEntry.id as string | undefined) : undefined, fallbackId);
  const sourcePdf = (rawEntry && typeof rawEntry === "object" ? rawEntry.sourcePdf : null) ?? null;
  const fileName = deriveFileName(sourcePdf, id);
  const pdfUrl = derivePdfUrl(sourcePdf, id);
  const title = deriveTitle(rawEntry ?? {}, fileName);
  const doi = deriveDoi(rawEntry ?? {});

  const coercedRaw: RawMockLibraryEntry = {
    ...(rawEntry ?? {}),
    id,
    sourcePdf: {
      ...(typeof sourcePdf === "object" && sourcePdf ? sourcePdf : {}),
      publicPath: pdfUrl
    }
  };

  return {
    id,
    title,
    fileName,
    pdfUrl,
    doi,
    raw: coercedRaw
  };
}

function extractEntries(library: RawMockLibrary): MockLibraryEntrySummary[] {
  if (library && Array.isArray((library as any).entries)) {
    const rawEntries = (library as any).entries as RawMockLibraryEntry[];
    return rawEntries.map((entry, index) => {
      const fallbackId = index === 0 ? FALLBACK_ENTRY_ID : `${FALLBACK_ENTRY_ID}-${index + 1}`;
      return coerceEntry(entry, fallbackId);
    });
  }

  const fallbackEntry = coerceEntry(library as RawMockLibraryEntry, FALLBACK_ENTRY_ID);
  return [fallbackEntry];
}

export const MOCK_LIBRARY_ENTRIES: MockLibraryEntrySummary[] = extractEntries(MOCK_SIMILAR_PAPERS_LIBRARY);

export const MOCK_LIBRARY_ENTRIES_BY_ID = new Map<string, MockLibraryEntrySummary>(
  MOCK_LIBRARY_ENTRIES.map((entry) => [entry.id, entry])
);

export const DEFAULT_MOCK_LIBRARY_ENTRY = MOCK_LIBRARY_ENTRIES[0];

export const DEFAULT_MOCK_LIBRARY_ENTRY_ID = DEFAULT_MOCK_LIBRARY_ENTRY?.id ?? FALLBACK_ENTRY_ID;

export function getMockLibraryEntry(id: string) {
  return MOCK_LIBRARY_ENTRIES_BY_ID.get(id) ?? null;
}

export function isMockLibraryEntryId(id: string | null | undefined) {
  if (!id) {
    return false;
  }
  return MOCK_LIBRARY_ENTRIES_BY_ID.has(id);
}

export function listMockLibraryEntryIds() {
  return MOCK_LIBRARY_ENTRIES.map((entry) => entry.id);
}

export function listMockLibrarySummaries() {
  return MOCK_LIBRARY_ENTRIES;
}
