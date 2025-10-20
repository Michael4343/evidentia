import {
  DEFAULT_MOCK_LIBRARY_ENTRY,
  DEFAULT_MOCK_LIBRARY_ENTRY_ID,
  listMockLibrarySummaries,
  type MockLibraryEntrySummary
} from "./mock-library";

export const MOCK_SAMPLE_PAPER_ID = DEFAULT_MOCK_LIBRARY_ENTRY_ID;

function toPaperMeta(summary: MockLibraryEntrySummary) {
  return {
    id: summary.id,
    name: summary.title,
    fileName: summary.fileName,
    pdfUrl: summary.pdfUrl,
    doi: summary.doi
  } as const;
}

export const MOCK_SAMPLE_PAPER_META = toPaperMeta(
  DEFAULT_MOCK_LIBRARY_ENTRY ?? {
    id: "mock-similar-paper",
    title: "Mock sample paper",
    fileName: "mock-paper.pdf",
    pdfUrl: "/mock-paper.pdf",
    doi: null,
    raw: {}
  }
);

export const MOCK_LIBRARY_PAPER_METAS = listMockLibrarySummaries().map(toPaperMeta);

export function getMockPaperMetaById(id: string) {
  return MOCK_LIBRARY_PAPER_METAS.find((entry) => entry.id === id) ?? null;
}
