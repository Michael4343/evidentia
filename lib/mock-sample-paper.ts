import { MOCK_SIMILAR_PAPERS_LIBRARY } from "./mock-similar-papers";

export const MOCK_SAMPLE_PAPER_ID = "mock-similar-paper";

export const MOCK_SAMPLE_PAPER_META = {
  id: MOCK_SAMPLE_PAPER_ID,
  name:
    MOCK_SIMILAR_PAPERS_LIBRARY.sourcePaper?.title?.trim() ||
    "Soil structure and microbiome functions (sample)",
  fileName: "mock-paper.pdf",
  pdfUrl: "/mock-paper.pdf",
  doi: MOCK_SIMILAR_PAPERS_LIBRARY.sourcePdf?.doi ?? null
} as const;
