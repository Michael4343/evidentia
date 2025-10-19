"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AppSidebar } from "@/components/app-sidebar";
import { PaperTabNav } from "@/components/paper-tab-nav";
import { PdfViewer } from "@/components/pdf-viewer";
import { UploadDropzone } from "@/components/upload-dropzone";
import { MockSimilarPapersShowcase } from "@/components/mock-similar-papers-showcase";
import { MOCK_SAMPLE_PAPER_ID, MOCK_SAMPLE_PAPER_META } from "@/lib/mock-sample-paper";
import { MOCK_SIMILAR_PAPERS_LIBRARY } from "@/lib/mock-similar-papers";
import { useAuthModal } from "@/components/auth-modal-provider";
import { ReaderTabKey } from "@/lib/reader-tabs";
import { extractDoiFromPdf } from "@/lib/pdf-doi";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { parseUploadError, validateFileSize } from "@/lib/upload-errors";
import { deleteUserPaper, fetchUserPapers, persistUserPaper, type UserPaperRecord } from "@/lib/user-papers";

const RESEARCH_CACHE_VERSION = "v1";

const MOCK_UPLOADED_PAPER_BASE = {
  id: MOCK_SAMPLE_PAPER_META.id,
  name: MOCK_SAMPLE_PAPER_META.name,
  fileName: MOCK_SAMPLE_PAPER_META.fileName,
  url: MOCK_SAMPLE_PAPER_META.pdfUrl,
  uploadedAt: new Date("2024-01-01T00:00:00Z"),
  size: 0,
  doi: MOCK_SAMPLE_PAPER_META.doi,
  source: "local" as const
};

interface ResearchGroupEntry {
  name: string;
  institution: string | null;
  website: string | null;
  notes: string | null;
  researchers: Array<{ name: string; email: string | null; role: string | null }>;
}

interface ResearchGroupPaperEntry {
  title: string;
  identifier: string | null;
  groups: ResearchGroupEntry[];
}

const MOCK_RESEARCH_GROUPS_TEXT =
  typeof MOCK_SIMILAR_PAPERS_LIBRARY?.researchGroups?.text === "string"
    ? MOCK_SIMILAR_PAPERS_LIBRARY.researchGroups.text
    : "";

const MOCK_RESEARCH_GROUPS_STRUCTURED: ResearchGroupPaperEntry[] | undefined = Array.isArray(
  MOCK_SIMILAR_PAPERS_LIBRARY?.researchGroups?.structured?.papers
)
  ? (MOCK_SIMILAR_PAPERS_LIBRARY.researchGroups.structured.papers as ResearchGroupPaperEntry[])
  : undefined;

function isMockPaper(paper: UploadedPaper | null | undefined) {
  return paper?.id === MOCK_SAMPLE_PAPER_ID;
}

type CacheStage = "similarPapers" | "groups" | "contacts" | "theses";

function getCacheKey(paperId: string, stage: CacheStage) {
  return `paper-cache:${RESEARCH_CACHE_VERSION}:${paperId}:${stage}`;
}

function readCachedState<T>(paperId: string, stage: CacheStage): T | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(getCacheKey(paperId, stage));
    if (!raw) {
      return null;
    }

    const payload = JSON.parse(raw);

    if (!payload || payload.version !== RESEARCH_CACHE_VERSION) {
      return null;
    }

    return payload.data as T;
  } catch (error) {
    console.warn(`[cache] Failed to read ${stage}`, error);
    return null;
  }
}

function writeCachedState<T>(paperId: string, stage: CacheStage, data: T) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      getCacheKey(paperId, stage),
      JSON.stringify({
        version: RESEARCH_CACHE_VERSION,
        timestamp: Date.now(),
        data
      })
    );
  } catch (error) {
    console.warn(`[cache] Failed to write ${stage}`, error);
  }
}

function extractAuthorsFromInfo(info: Record<string, any> | null | undefined): string[] | null {
  if (!info) {
    return null;
  }

  const candidateKeys = ["Author", "Authors", "Creator"];

  const raw = candidateKeys
    .map((key) => (typeof info[key] === "string" ? (info[key] as string).trim() : ""))
    .find((value) => value.length > 0);

  if (!raw) {
    return null;
  }

  const parts = raw
    .split(/[,;|\n]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return null;
  }

  return parts;
}

function extractAbstractFromInfo(info: Record<string, any> | null | undefined): string | null {
  if (!info) {
    return null;
  }

  const candidateKeys = ["Abstract", "Subject", "Description"];

  const raw = candidateKeys
    .map((key) => (typeof info[key] === "string" ? (info[key] as string).trim() : ""))
    .find((value) => value.length > 0);

  if (!raw) {
    return null;
  }

  return raw.length > 2_000 ? `${raw.slice(0, 2_000)}…` : raw;
}

interface UploadedPaper {
  id: string;
  name: string;
  fileName: string;
  url: string;
  uploadedAt: Date;
  size: number;
  doi: string | null;
  storagePath?: string;
  source: "local" | "remote";
}

const MOCK_UPLOADED_PAPER: UploadedPaper = {
  ...MOCK_UPLOADED_PAPER_BASE
};

interface ExtractedText {
  pages: number | null;
  info: Record<string, any> | null;
  text: string;
}

interface ResearcherThesisRecord {
  name: string | null;
  email: string | null;
  group: string | null;
  latest_publication: {
    title: string | null;
    year: number | null;
    venue: string | null;
    url: string | null;
  };
  phd_thesis: {
    title: string | null;
    year: number | null;
    institution: string | null;
    url: string | null;
  } | null;
  data_publicly_available: "yes" | "no" | "unknown";
}

type ExtractionState =
  | { status: "loading" }
  | { status: "success"; data: ExtractedText }
  | { status: "error"; message: string; hint?: string };

type ResearchGroupsState =
  | { status: "loading" }
  | {
      status: "success";
      text: string;
      structured?: ResearchGroupPaperEntry[];
    }
  | { status: "error"; message: string };

type SimilarPapersState =
  | { status: "loading" }
  | { status: "success"; text: string }
  | { status: "error"; message: string };

type ResearchGroupContactsState =
  | { status: "loading" }
  | { status: "success"; contacts: Array<{ group: string; people: Array<{ name: string | null; email: string | null }> }> }
  | { status: "error"; message: string };

type ResearcherThesesState =
  | { status: "loading" }
  | {
      status: "success";
      researchers: ResearcherThesisRecord[];
      text?: string;
    }
  | { status: "error"; message: string };

const MOCK_RESEARCH_THESES_TEXT =
  typeof MOCK_SIMILAR_PAPERS_LIBRARY?.researcherTheses?.text === "string"
    ? MOCK_SIMILAR_PAPERS_LIBRARY.researcherTheses.text
    : "";

const MOCK_RESEARCH_THESES_STRUCTURED: ResearcherThesisRecord[] = Array.isArray(
  MOCK_SIMILAR_PAPERS_LIBRARY?.researcherTheses?.structured?.researchers
)
  ? (MOCK_SIMILAR_PAPERS_LIBRARY.researcherTheses.structured
      .researchers as ResearcherThesisRecord[])
  : [];

const MOCK_RESEARCH_THESES_INITIAL_STATE: ResearcherThesesState =
  MOCK_RESEARCH_THESES_STRUCTURED.length > 0
    ? {
        status: "success",
        researchers: MOCK_RESEARCH_THESES_STRUCTURED,
        text: MOCK_RESEARCH_THESES_TEXT
      }
    : {
        status: "success",
        researchers: [],
        text: MOCK_RESEARCH_THESES_TEXT
      };

function sanitizeFileName(...values: Array<string | null | undefined>) {
  for (const raw of values) {
    if (!raw) {
      continue;
    }
    const trimmed = raw.trim();
    if (!trimmed) {
      continue;
    }
    const nameOnly = trimmed.split(/[\\/]/).filter(Boolean).pop();
    if (nameOnly && nameOnly.length > 0) {
      return nameOnly;
    }
  }
  return "paper.pdf";
}

function renderPlaintextSections(text: string): JSX.Element[] {
  const result: JSX.Element[] = [];
  let paragraphLines: string[] = [];
  let list: { type: "ul" | "ol"; items: string[] } | null = null;
  let key = 0;

  const flushParagraph = () => {
    if (paragraphLines.length === 0) {
      return;
    }
    const content = paragraphLines.join(" ").replace(/\s+/g, " ").trim();
    if (content.length > 0) {
      const paragraphKey = `paragraph-${key++}`;
      result.push(
        <p key={paragraphKey} className="text-sm leading-relaxed text-slate-700">
          {content}
        </p>
      );
    }
    paragraphLines = [];
  };

  const flushList = () => {
    if (!list) {
      return;
    }
    const listKey = `list-${key++}`;
    if (list.type === "ul") {
      result.push(
        <ul
          key={listKey}
          className="space-y-1.5 pl-4 text-sm leading-relaxed text-slate-700 list-disc marker:text-slate-400"
        >
          {list.items.map((item, index) => (
            <li key={`${listKey}-item-${index}`}>{item}</li>
          ))}
        </ul>
      );
    } else {
      result.push(
        <ol
          key={listKey}
          className="space-y-1.5 pl-5 text-sm leading-relaxed text-slate-700 list-decimal marker:text-slate-400"
        >
          {list.items.map((item, index) => (
            <li key={`${listKey}-item-${index}`}>{item}</li>
          ))}
        </ol>
      );
    }
    list = null;
  };

  text
    .split("\n")
    .map((line) => line.replace(/\s+$/g, ""))
    .forEach((rawLine) => {
      const line = rawLine.trim();

      if (!line) {
        flushParagraph();
        flushList();
        return;
      }

      if (/^[-•]/.test(line)) {
        flushParagraph();
        if (!list || list.type !== "ul") {
          flushList();
          list = { type: "ul", items: [] };
        }
        list.items.push(line.replace(/^[-•]\s*/, ""));
        return;
      }

      if (/^\d+\./.test(line)) {
        flushParagraph();
        if (!list || list.type !== "ol") {
          flushList();
          list = { type: "ol", items: [] };
        }
        list.items.push(line.replace(/^\d+\.\s*/, ""));
        return;
      }

      flushList();
      paragraphLines.push(line);
    });

  flushParagraph();
  flushList();

  return result;
}

function PaperTabContent({
  onUpload,
  activePaper,
  isUploading,
  helperText,
  viewerClassName
}: {
  onUpload: (file: File) => void;
  activePaper: UploadedPaper | null;
  isUploading: boolean;
  helperText?: string;
  viewerClassName?: string;
}) {
  if (!activePaper) {
    return (
      <UploadDropzone
        onUpload={onUpload}
        helperText={isUploading ? "Saving your paper to the library…" : helperText}
      />
    );
  }

  return (
    <PdfViewer
      fileUrl={activePaper.url}
      fileName={activePaper.fileName}
      source={activePaper.source}
      storagePath={activePaper.storagePath}
      className={viewerClassName ?? "h-[80vh] w-full"}
    />
  );
}

function ExtractionDebugPanel({
  state,
  paper
}: {
  state: ExtractionState | undefined;
  paper: UploadedPaper | null;
}) {
  if (!paper) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
        <p className="text-base font-medium text-slate-700">Upload a PDF to extract text.</p>
        <p className="text-sm text-slate-500">The extracted text will appear here once processing completes.</p>
      </div>
    );
  }

  if (!state || state.status === "loading") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-slate-300 border-t-primary" />
        <div className="space-y-1">
          <p className="text-base font-medium text-slate-700">Extracting text from PDF…</p>
          <p className="text-xs text-slate-500">This should only take a few seconds.</p>
        </div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <div className="rounded-full bg-red-50 p-3 text-red-600">⚠️</div>
        <div className="space-y-1">
          <p className="text-base font-semibold text-red-700">Extraction failed</p>
          <p className="text-sm text-red-600">{state.message}</p>
          {state.hint && <p className="text-xs text-red-500">{state.hint}</p>}
        </div>
      </div>
    );
  }

  const { data } = state;

  return (
    <div className="flex-1 space-y-4 overflow-auto p-6">
      {/* Metadata Section */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="mb-2 text-sm font-semibold text-slate-800">Document Info</h3>
        <div className="space-y-1 text-sm text-slate-600">
          <p>Pages: {data.pages ?? "Unknown"}</p>
          {data.info?.Title && <p>Title: {data.info.Title}</p>}
          {data.info?.Author && <p>Author: {data.info.Author}</p>}
        </div>
      </div>

      {/* Extracted Text Section */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="mb-2 text-sm font-semibold text-slate-800">Extracted Text</h3>
        <pre className="max-h-[600px] overflow-auto whitespace-pre-wrap rounded bg-slate-950/5 p-4 text-xs leading-relaxed text-slate-800">
          {data.text}
        </pre>
      </div>
    </div>
  );
}

function SimilarPapersPanel({
  paper,
  extraction,
  state,
  onRetry
}: {
  paper: UploadedPaper | null;
  extraction: ExtractionState | undefined;
  state: SimilarPapersState | undefined;
  onRetry: () => void;
}) {
  if (!paper) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
        <p className="text-base font-medium text-slate-700">Upload a PDF to find related methods.</p>
        <p className="text-sm text-slate-500">We’ll compare the paper against recent work once it’s processed.</p>
      </div>
    );
  }

  if (isMockPaper(paper)) {
    return (
      <div className="flex-1 overflow-auto">
        <MockSimilarPapersShowcase />
      </div>
    );
  }

  if (!extraction || extraction.status === "loading") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-slate-300 border-t-primary" />
        <div className="space-y-1">
          <p className="text-base font-medium text-slate-700">Preparing extracted text…</p>
          <p className="text-xs text-slate-500">We’ll run the similar paper pass once extraction finishes.</p>
        </div>
      </div>
    );
  }

  if (extraction.status === "error") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <div className="rounded-full bg-red-50 p-3 text-red-600">⚠️</div>
        <div className="space-y-1">
          <p className="text-base font-semibold text-red-700">Text extraction failed</p>
          <p className="text-sm text-red-600">
            {extraction.message || "We couldn’t extract text from this PDF, so the comparison can’t run."}
          </p>
        </div>
      </div>
    );
  }

  if (!state || state.status === "loading") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-slate-300 border-t-primary" />
        <div className="space-y-1">
          <p className="text-base font-medium text-slate-700">Compiling similar papers…</p>
          <p className="text-xs text-slate-500">GPT-5 is building the crosswalk dossier.</p>
        </div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <div className="rounded-full bg-red-50 p-3 text-red-600">⚠️</div>
        <div className="space-y-1">
          <p className="text-base font-semibold text-red-700">Similar paper search failed</p>
          <p className="text-sm text-red-600">{state.message}</p>
        </div>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="mx-auto w-full max-w-3xl space-y-6 px-6 py-8">
        <header className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Similarity scan</p>
          <h3 className="text-lg font-semibold text-slate-900">Cross-paper alignment</h3>
          <p className="text-sm text-slate-600">Findings for {paper?.name ?? "the current paper"}.</p>
        </header>
        <article className="space-y-4">
          {renderPlaintextSections(state.text)}
        </article>
      </div>
    </div>
  );
}

function ResearchGroupsPanel({
  paper,
  extraction,
  state,
  contacts,
  onRetry
}: {
  paper: UploadedPaper | null;
  extraction: ExtractionState | undefined;
  state: ResearchGroupsState | undefined;
  contacts: ResearchGroupContactsState | undefined;
  onRetry: () => void;
}) {
  if (!paper) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
        <p className="text-base font-medium text-slate-700">Upload a PDF to research related groups.</p>
        <p className="text-sm text-slate-500">We need a paper selected before running the deep search.</p>
      </div>
    );
  }

  const hasMockContent = Boolean(
    state &&
      state.status === "success" &&
      ((state.text && state.text.trim().length > 0) || (state.structured && state.structured.length > 0))
  );

  if (isMockPaper(paper) && !hasMockContent) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <p className="text-base font-medium text-slate-700">Coming soon</p>
        <p className="text-sm text-slate-500">
          Research groups will appear here once we wire this tab to the new crosswalk flow.
        </p>
      </div>
    );
  }

  if (!extraction || extraction.status === "loading") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-slate-300 border-t-primary" />
        <div className="space-y-1">
          <p className="text-base font-medium text-slate-700">Preparing extracted text…</p>
          <p className="text-xs text-slate-500">We’ll run the search as soon as extraction finishes.</p>
        </div>
      </div>
    );
  }

  if (extraction.status === "error") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <div className="rounded-full bg-red-50 p-3 text-red-600">⚠️</div>
        <div className="space-y-1">
          <p className="text-base font-semibold text-red-700">Text extraction failed</p>
          <p className="text-sm text-red-600">
            {extraction.message || "We couldn’t extract text from this PDF, so the search can’t run."}
          </p>
        </div>
      </div>
    );
  }

  if (!state || state.status === "loading") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-slate-300 border-t-primary" />
        <div className="space-y-1">
          <p className="text-base font-medium text-slate-700">Researching active groups…</p>
          <p className="text-xs text-slate-500">GPT-5 is compiling relevant organisations.</p>
        </div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <div className="rounded-full bg-red-50 p-3 text-red-600">⚠️</div>
        <div className="space-y-1">
          <p className="text-base font-semibold text-red-700">Research request failed</p>
          <p className="text-sm text-red-600">{state.message}</p>
        </div>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
        >
          Try again
        </button>
      </div>
    );
  }

  const renderGroupResearchers = (group: ResearchGroupEntry) => {
    if (!group.researchers.length) {
      return <p className="text-sm text-slate-500">No named contacts listed.</p>;
    }

    return (
      <ul className="space-y-1.5 text-sm leading-relaxed text-slate-700">
        {group.researchers.map((person, personIndex) => (
          <li key={`${group.name}-${person.name ?? person.email ?? personIndex}`} className="flex flex-wrap items-baseline gap-2">
            <span className="font-medium text-slate-800">{person.name || "Unnamed contact"}</span>
            {person.role && <span className="text-xs uppercase tracking-wide text-slate-400">{person.role}</span>}
            {person.email ? (
              <a href={`mailto:${person.email}`} className="text-sm text-primary underline-offset-4 hover:underline">
                {person.email}
              </a>
            ) : (
              <span className="text-sm text-slate-500">Email not provided</span>
            )}
          </li>
        ))}
      </ul>
    );
  };

  return (
    <div className="flex-1 overflow-auto">
      <div className="w-full space-y-8 px-6 py-8">
        <section className="space-y-6">
          <header className="space-y-2">
            <h2 className="text-xl font-semibold text-slate-900">Research Groups</h2>
            <p className="text-sm text-slate-600">
              Compiled for {paper?.name ?? "the selected paper"}.
            </p>
          </header>

          {state.structured && state.structured.length > 0 ? (
            <div className="space-y-4">
              {state.structured.map((paperEntry, paperIndex) => (
                <article
                  key={`${paperEntry.title}-${paperIndex}`}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-4 shadow-sm space-y-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                        Paper {paperIndex + 1}
                      </p>
                      <h3 className="text-base font-semibold text-slate-900">{paperEntry.title}</h3>
                      <p className="text-xs text-slate-500">
                        {paperEntry.identifier ? paperEntry.identifier : "Identifier not provided"}
                      </p>
                    </div>
                  </div>

                  {paperEntry.groups.length > 0 ? (
                    <div className="space-y-5">
                      {paperEntry.groups.map((group, groupIndex) => (
                        <div key={`${paperEntry.title}-${group.name}-${groupIndex}`} className="border-t border-slate-200 pt-4 first:border-t-0 first:pt-0">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="space-y-1">
                              <p className="text-sm font-semibold text-slate-900">{group.name}</p>
                              {group.institution && (
                                <p className="text-sm text-slate-600">{group.institution}</p>
                              )}
                            </div>
                            {group.website ? (
                              <a
                                href={group.website}
                                target="_blank"
                                rel="noreferrer"
                                className="text-xs font-medium text-primary underline-offset-4 hover:underline"
                              >
                                Visit site
                              </a>
                            ) : (
                              <span className="text-xs text-slate-400">No website listed</span>
                            )}
                          </div>

                          {group.notes && (
                            <p className="mt-2 text-sm leading-relaxed text-slate-700">{group.notes}</p>
                          )}

                          <div className="mt-3">
                            {renderGroupResearchers(group)}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-600">No groups reported for this paper.</p>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <article className="space-y-4">
              {renderPlaintextSections(state.text)}
            </article>
          )}
        </section>
      </div>
    </div>
  );
}

function ResearcherThesesPanel({
  state,
  hasResearchGroups,
  isMock,
  structuredGroups
}: {
  state: ResearcherThesesState | undefined;
  hasResearchGroups: boolean;
  isMock: boolean;
  structuredGroups?: ResearchGroupPaperEntry[];
}) {
  const hasLoadedResearchers = state?.status === "success" && state.researchers.length > 0;
  if (isMock && !hasLoadedResearchers) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <p className="text-base font-medium text-slate-700">Coming soon</p>
        <p className="text-sm text-slate-500">Researcher theses will appear here after we wire the new crosswalk prompts.</p>
      </div>
    );
  }

  if (!hasResearchGroups) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
        <p className="text-base font-medium text-slate-700">Run the Research Groups tab first.</p>
        <p className="text-sm text-slate-500">We need group results before we can look for theses.</p>
      </div>
    );
  }

  if (!state || state.status === "loading") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-slate-300 border-t-primary" />
        <p className="text-sm text-slate-600">Collecting latest publications and theses…</p>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <div className="rounded-full bg-red-50 p-3 text-red-600">⚠️</div>
        <div className="space-y-1">
          <p className="text-base font-semibold text-red-700">Researcher lookup failed</p>
          <p className="text-sm text-red-600">{state.message}</p>
        </div>
      </div>
    );
  }

  const researchers = state.researchers;

  if (researchers.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
        <p className="text-sm text-slate-600">No researcher publications or theses were found in the current summaries.</p>
      </div>
    );
  }

  const dataAvailabilityBadge = (value: ResearcherThesisRecord["data_publicly_available"]) => {
    const styles: Record<ResearcherThesisRecord["data_publicly_available"], string> = {
      yes: "border-emerald-100 bg-emerald-50 text-emerald-600",
      no: "border-rose-100 bg-rose-50 text-rose-600",
      unknown: "border-slate-200 bg-slate-100 text-slate-600"
    };

    const labels: Record<ResearcherThesisRecord["data_publicly_available"], string> = {
      yes: "Data available",
      no: "No public data",
      unknown: "Availability unknown"
    };

    return (
      <span
        className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${styles[value]}`}
      >
        {labels[value]}
      </span>
    );
  };

  const renderPublication = (entry: ResearcherThesisRecord["latest_publication"] | null | undefined) => {
    if (!entry || (!entry.title && !entry.venue && !entry.url && entry.year == null)) {
      return <p className="text-sm text-slate-600">No recent publication details captured.</p>;
    }

    return (
      <dl className="space-y-2 text-sm text-slate-600">
        {entry.title && (
          <div>
            <dt className="font-medium text-slate-700">Title</dt>
            <dd>{entry.title}</dd>
          </div>
        )}
        {entry.year !== null && (
          <div>
            <dt className="font-medium text-slate-700">Year</dt>
            <dd>{entry.year}</dd>
          </div>
        )}
        {entry.venue && (
          <div>
            <dt className="font-medium text-slate-700">Venue</dt>
            <dd>{entry.venue}</dd>
          </div>
        )}
        {entry.url && (
          <div>
            <dt className="font-medium text-slate-700">Link</dt>
            <dd>
              <a
                href={entry.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                View publication
              </a>
            </dd>
          </div>
        )}
      </dl>
    );
  };

  const renderThesis = (entry: ResearcherThesisRecord["phd_thesis"] | null | undefined) => {
    if (!entry) {
      return <p className="text-sm text-slate-600">No confirmed thesis on record.</p>;
    }

    return (
      <dl className="space-y-2 text-sm text-slate-600">
        {entry.title && (
          <div>
            <dt className="font-medium text-slate-700">Title</dt>
            <dd>{entry.title}</dd>
          </div>
        )}
        {entry.year !== null && (
          <div>
            <dt className="font-medium text-slate-700">Year</dt>
            <dd>{entry.year}</dd>
          </div>
        )}
        {entry.institution && (
          <div>
            <dt className="font-medium text-slate-700">Institution</dt>
            <dd>{entry.institution}</dd>
          </div>
        )}
        {entry.url && (
          <div>
            <dt className="font-medium text-slate-700">Link</dt>
            <dd>
              <a
                href={entry.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                View thesis
              </a>
            </dd>
          </div>
        )}
      </dl>
    );
  };

  const renderResearcherCard = (record: ResearcherThesisRecord, label: string) => (
    <article className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <header className="flex flex-col gap-3 border-b border-slate-100 pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
            <span>{label}</span>
          </div>
          <p className="text-base font-semibold text-slate-900">
            {record.name ?? record.email ?? "Unnamed researcher"}
          </p>
          {record.group && <p className="text-sm text-slate-600">{record.group}</p>}
          {record.email && (
            <p className="text-sm text-slate-600">
              <a href={`mailto:${record.email}`} className="text-primary hover:underline">
                {record.email}
              </a>
            </p>
          )}
        </div>
        {dataAvailabilityBadge(record.data_publicly_available)}
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <section className="space-y-2">
          <h5 className="text-sm font-semibold text-slate-700">Latest publication</h5>
          {renderPublication(record.latest_publication)}
        </section>
        <section className="space-y-2">
          <h5 className="text-sm font-semibold text-slate-700">PhD thesis</h5>
          {renderThesis(record.phd_thesis)}
        </section>
      </div>
    </article>
  );

  const flatList = (
    <ol className="space-y-5">
      {researchers.map((researcher, index) => {
        const key = researcher.name ?? researcher.email ?? index;
        return <li key={key}>{renderResearcherCard(researcher, `Researcher ${index + 1}`)}</li>;
      })}
    </ol>
  );

  if (!structuredGroups || structuredGroups.length === 0) {
    return (
      <div className="flex-1 overflow-auto">
        <section className="space-y-6 px-6 py-6">{flatList}</section>
      </div>
    );
  }

  const normaliseGroupKey = (value: string | null | undefined) =>
    value ? value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() : "";

  const groupedByGroup = new Map<string, ResearcherThesisRecord[]>();
  const grouplessResearchers: ResearcherThesisRecord[] = [];

  researchers.forEach((record) => {
    const key = normaliseGroupKey(record.group);
    if (key) {
      if (!groupedByGroup.has(key)) {
        groupedByGroup.set(key, []);
      }
      groupedByGroup.get(key)!.push(record);
    } else {
      grouplessResearchers.push(record);
    }
  });

  const remainingGroups = new Map(groupedByGroup);

  const renderGroupResearchers = (entries: ResearcherThesisRecord[]) => {
    if (!entries.length) {
      return <p className="text-sm text-slate-600">No thesis records captured for this group yet.</p>;
    }

    return (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {entries.map((entry, index) => {
          const key = entry.name ?? entry.email ?? `member-${index}`;
          return <div key={key}>{renderResearcherCard(entry, `Member ${index + 1}`)}</div>;
        })}
      </div>
    );
  };

  const paperSections = structuredGroups.map((paper, paperIndex) => {
    return (
      <article
        key={`${paper.title}-${paperIndex}`}
        className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
      >
        <header className="space-y-1 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
            <span>Paper {paperIndex + 1}</span>
          </div>
          <h3 className="text-lg font-semibold text-slate-900">{paper.title}</h3>
          <p className="text-sm text-slate-600">
            {[paper.identifier, paper.groups.length ? `${paper.groups.length} research groups` : null]
              .filter(Boolean)
              .join(" · ") || "Group assignments"}
          </p>
        </header>

        <div className="space-y-4">
          {paper.groups.map((group, groupIndex) => {
            const key = normaliseGroupKey(group.name);
            const entries = key && groupedByGroup.has(key) ? groupedByGroup.get(key)! : [];
            if (key) {
              remainingGroups.delete(key);
            }

            return (
              <section
                key={`${group.name}-${groupIndex}`}
                className="space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-slate-900">{group.name}</p>
                    {group.institution && <p className="text-sm text-slate-600">{group.institution}</p>}
                  </div>
                  {group.website ? (
                    <a
                      href={group.website}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs font-medium text-primary underline-offset-4 hover:underline"
                    >
                      Visit site
                    </a>
                  ) : (
                    <span className="text-xs text-slate-400">No website listed</span>
                  )}
                </div>

                {group.notes && (
                  <p className="text-sm leading-relaxed text-slate-700">{group.notes}</p>
                )}

                {renderGroupResearchers(entries)}
              </section>
            );
          })}
        </div>
      </article>
    );
  });

  const extraGroups = Array.from(remainingGroups.entries()).map(([key, entries]) => ({
    label: entries[0]?.group ?? key,
    entries
  }));

  const hasExtras = extraGroups.length > 0 || grouplessResearchers.length > 0;

  return (
    <div className="flex-1 overflow-auto">
      <section className="space-y-6 px-6 py-6">
        <div className="space-y-6">{paperSections}</div>

        {hasExtras && (
          <article className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <header className="space-y-1 border-b border-slate-100 pb-3">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                Additional thesis records
              </div>
              <p className="text-sm text-slate-600">
                These entries could not be matched to the current research group structure.
              </p>
            </header>

            <div className="space-y-4">
              {extraGroups.map((bucket, index) => (
                <section
                  key={`${bucket.label ?? "unlabelled"}-${index}`}
                  className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4"
                >
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-slate-900">{bucket.label ?? "Unnamed group"}</p>
                    <p className="text-xs text-slate-500">Unmapped group</p>
                  </div>
                  {renderGroupResearchers(bucket.entries)}
                </section>
              ))}

              {grouplessResearchers.length > 0 && (
                <section className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-slate-900">Researchers without group assignment</p>
                    <p className="text-xs text-slate-500">
                      Capture a research group before running the thesis pass to improve matching.
                    </p>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {grouplessResearchers.map((record, index) => {
                      const key = record.name ?? record.email ?? `unassigned-${index}`;
                      return <div key={key}>{renderResearcherCard(record, `Record ${index + 1}`)}</div>;
                    })}
                  </div>
                </section>
              )}
            </div>
          </article>
        )}
      </section>
    </div>
  );
}

function PatentsPanel({
  state,
  paper,
  isMock
}: {
  state: ExtractionState | undefined;
  paper: UploadedPaper | null;
  isMock: boolean;
}) {
  if (isMock) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center p-6">
        <p className="text-base font-medium text-slate-700">Patents tab coming soon</p>
        <p className="max-w-md text-sm text-slate-500">
          We’ll plug this into the Similar Papers crosswalk as soon as the patent prompts stabilise. For now the sample view is intentionally blank.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-auto">
      <div className="border-b border-slate-200 bg-slate-50 px-6 py-4">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-lg font-semibold text-slate-800">Patents</h2>
          <p className="mt-1 text-sm text-slate-600">
            This section currently displays raw PDF text extraction as a placeholder. We are actively working on implementing patent search and analysis features.
          </p>
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        <ExtractionDebugPanel state={state} paper={paper} />
      </div>
    </div>
  );
}

function ExpertNetworkPanel({ paper, isMock }: { paper: UploadedPaper | null; isMock: boolean }) {
  if (isMock) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center p-6">
        <p className="text-base font-medium text-slate-700">Expert review preview</p>
        <p className="max-w-md text-sm text-slate-500">
          We’re building expert matching on top of the crosswalk workflow. This sample keeps the UI simple while we wire the backend.
        </p>
      </div>
    );
  }

  if (!paper) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
        <p className="text-base font-medium text-slate-700">Upload a PDF to request expert consultation.</p>
        <p className="text-sm text-slate-500">We&apos;ll connect you with relevant experts once you select a paper.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="mx-auto max-w-3xl">
        {/* Header with placeholder notice */}
        <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 p-4">
          <p className="text-sm text-blue-800">
            This is a preview of the Expert Review feature. We are actively building the expert matching and scheduling system.
          </p>
        </div>

        {/* Expert Review Section */}
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-800">Expert Review</h2>
              <p className="mt-1 text-sm text-slate-600">Schedule a consultation with a domain expert to validate these findings.</p>
            </div>
            <button
              disabled
              className="rounded-full bg-slate-900 px-5 py-2 text-sm font-medium text-white opacity-50 cursor-not-allowed"
            >
              Request a call
            </button>
          </div>

          {/* Request Form */}
          <div className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Topic or question
              </label>
              <textarea
                disabled
                placeholder="Prefilled from current paper/protocol, editable"
                className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-600 cursor-not-allowed"
                rows={3}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Outcome</label>
                <select disabled className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-600 cursor-not-allowed">
                  <option>Quick advice</option>
                  <option>Method triage</option>
                  <option>Go or no go</option>
                  <option>Other</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Duration</label>
                <select disabled className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-600 cursor-not-allowed">
                  <option>30 minutes</option>
                  <option>60 minutes</option>
                  <option>90 minutes</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Urgency</label>
              <div className="flex gap-3">
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <input type="radio" disabled className="cursor-not-allowed" name="urgency" />
                  This week
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <input type="radio" disabled className="cursor-not-allowed" name="urgency" />
                  Next week
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <input type="radio" disabled className="cursor-not-allowed" name="urgency" />
                  Flexible
                </label>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Availability windows
              </label>
              <textarea
                disabled
                placeholder="e.g., Mon-Wed 2-5pm EST, Thu anytime"
                className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-600 cursor-not-allowed"
                rows={2}
              />
            </div>

            <div className="flex gap-6">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" disabled className="cursor-not-allowed rounded" />
                NDA required
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" disabled className="cursor-not-allowed rounded" />
                Share project context with expert
              </label>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Conflicts of interest to avoid
              </label>
              <input
                type="text"
                disabled
                placeholder="e.g., Companies, institutions, or individuals"
                className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-600 cursor-not-allowed"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Contact email
              </label>
              <input
                type="email"
                disabled
                placeholder="Auto-filled from account"
                className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-600 cursor-not-allowed"
              />
            </div>

            <button
              disabled
              className="w-full rounded-lg bg-slate-900 px-4 py-3 text-sm font-medium text-white opacity-50 cursor-not-allowed"
            >
              Submit request
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LandingPage() {
  const [activeTab, setActiveTab] = useState<ReaderTabKey>("paper");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { user, open } = useAuthModal();
  const prevUserRef = useRef(user);
  const objectUrlsRef = useRef<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadedPapers, setUploadedPapers] = useState<UploadedPaper[]>([MOCK_UPLOADED_PAPER]);
  const [activePaperId, setActivePaperId] = useState<string | null>(MOCK_SAMPLE_PAPER_ID);
  const [isSavingPaper, setIsSavingPaper] = useState(false);
  const [uploadStatusMessage, setUploadStatusMessage] = useState<string | null>(null);
  const [uploadErrorMessage, setUploadErrorMessage] = useState<string | null>(null);
  const [isFetchingLibrary, setIsFetchingLibrary] = useState(false);
  const [isStatusDismissed, setIsStatusDismissed] = useState(false);
  const [extractionStates, setExtractionStates] = useState<Record<string, ExtractionState>>({
    [MOCK_SAMPLE_PAPER_ID]: {
      status: "success",
      data: {
        pages: null,
        info: null,
        text: "Static Evidentia sample paper"
      }
    }
  });
  const [similarPapersStates, setSimilarPapersStates] = useState<Record<string, SimilarPapersState>>({
    [MOCK_SAMPLE_PAPER_ID]: {
      status: "success",
      text:
        typeof MOCK_SIMILAR_PAPERS_LIBRARY?.similarPapers === "string"
          ? MOCK_SIMILAR_PAPERS_LIBRARY.similarPapers
          : ""
    }
  });
  const [researchGroupsStates, setResearchGroupsStates] = useState<Record<string, ResearchGroupsState>>({
    [MOCK_SAMPLE_PAPER_ID]: {
      status: "success",
      text: MOCK_RESEARCH_GROUPS_TEXT,
      structured: MOCK_RESEARCH_GROUPS_STRUCTURED
    }
  });
  const [researchContactsStates, setResearchContactsStates] = useState<Record<string, ResearchGroupContactsState>>({
    [MOCK_SAMPLE_PAPER_ID]: { status: "success", contacts: [] }
  });
  const [researchThesesStates, setResearchThesesStates] = useState<Record<string, ResearcherThesesState>>({
    [MOCK_SAMPLE_PAPER_ID]: MOCK_RESEARCH_THESES_INITIAL_STATE
  });
  const activePaper = activePaperId
    ? uploadedPapers.find((item) => item.id === activePaperId) ?? null
    : null;
  const isActivePaperMock = isMockPaper(activePaper);
  const activeExtraction = activePaper ? extractionStates[activePaper.id] : undefined;
  const activeSimilarPapersState = activePaper ? similarPapersStates[activePaper.id] : undefined;
  const activeResearchGroupState = activePaper ? researchGroupsStates[activePaper.id] : undefined;
  const activeResearchContactsState = activePaper ? researchContactsStates[activePaper.id] : undefined;
  const activeResearchThesesState = activePaper
    ? researchThesesStates[activePaper.id] ??
      (isMockPaper(activePaper) ? MOCK_RESEARCH_THESES_INITIAL_STATE : undefined)
    : undefined;
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const isPaperViewerActive = activeTab === "paper" && Boolean(activePaper);
  const dropzoneHelperText = !user
    ? "Sign in to save papers to your library."
    : isFetchingLibrary
      ? "Loading your library…"
      : undefined;

  const clearObjectUrls = useCallback(() => {
    objectUrlsRef.current.forEach((url) => {
      URL.revokeObjectURL(url);
    });
    objectUrlsRef.current = [];
  }, []);

  useEffect(() => {
    if (!activePaper || isMockPaper(activePaper)) {
      return;
    }

    const paperId = activePaper.id;

    if (!activeSimilarPapersState) {
      const cachedSimilar = readCachedState<{ text: string }>(paperId, "similarPapers");
      if (cachedSimilar?.text) {
        setSimilarPapersStates((prev) => ({
          ...prev,
          [paperId]: {
            status: "success",
            text: cachedSimilar.text
          }
        }));
      }
    }

    if (!activeResearchGroupState) {
      const cachedGroups = readCachedState<{ text: string }>(paperId, "groups");
      if (cachedGroups?.text) {
        setResearchGroupsStates((prev) => ({
          ...prev,
          [paperId]: {
            status: "success",
            text: cachedGroups.text
          }
        }));
      }
    }

    if (!activeResearchContactsState) {
      const cachedContacts = readCachedState<{
        contacts: Array<{ group: string; people: Array<{ name: string | null; email: string | null }> }>;
      }>(paperId, "contacts");

      if (cachedContacts?.contacts) {
        setResearchContactsStates((prev) => ({
          ...prev,
          [paperId]: {
            status: "success",
            contacts: cachedContacts.contacts
          }
        }));
      }
    }

    if (!activeResearchThesesState) {
      const cachedTheses = readCachedState<{ researchers: ResearcherThesisRecord[] }>(paperId, "theses");
      if (cachedTheses?.researchers) {
        setResearchThesesStates((prev) => ({
          ...prev,
          [paperId]: {
            status: "success",
            researchers: cachedTheses.researchers
          }
        }));
      }
    }
  }, [
    activePaper,
    activeSimilarPapersState,
    activeResearchGroupState,
    activeResearchContactsState,
    activeResearchThesesState
  ]);

  const runExtraction = useCallback(
    async (paper: UploadedPaper, options?: { file?: File }) => {
      if (!paper) {
        return;
      }

      if (isMockPaper(paper)) {
        setExtractionStates((prev) => ({
          ...prev,
          [paper.id]: {
            status: "success",
            data: {
              pages: null,
              info: null,
              text: "Static Evidentia sample paper"
            }
          }
        }));
        return;
      }

      setExtractionStates((prev) => ({
        ...prev,
        [paper.id]: { status: "loading" }
      }));

      setSimilarPapersStates((prev) => {
        if (!(paper.id in prev)) {
          return prev;
        }
        const next = { ...prev };
        delete next[paper.id];
        return next;
      });

      setResearchGroupsStates((prev) => {
        if (!(paper.id in prev)) {
          return prev;
        }
        const next = { ...prev };
        delete next[paper.id];
        return next;
      });

      setResearchContactsStates((prev) => {
        if (!(paper.id in prev)) {
          return prev;
        }
        const next = { ...prev };
        delete next[paper.id];
        return next;
      });

      setResearchThesesStates((prev) => {
        if (!(paper.id in prev)) {
          return prev;
        }
        const next = { ...prev };
        delete next[paper.id];
        return next;
      });

      try {
        let workingFile: File | null = options?.file ?? null;

        if (!workingFile && !paper.storagePath) {
          if (!paper.url) {
            throw new Error("Missing PDF URL for extraction.");
          }

          const pdfResponse = await fetch(paper.url, {
            credentials: paper.source === "remote" ? "include" : "same-origin",
            cache: "no-store"
          });

          if (!pdfResponse.ok) {
            throw new Error(`Failed to download PDF for extraction (status ${pdfResponse.status}).`);
          }

          const blob = await pdfResponse.blob();
          workingFile = new File([blob], sanitizeFileName(paper.fileName, "paper.pdf"), {
            type: "application/pdf"
          });
        }

        const fileName = sanitizeFileName(paper.fileName, workingFile?.name, "paper.pdf");

        const formData = new FormData();
        formData.append("filename", fileName);

        if (paper.storagePath) {
          formData.append("storagePath", paper.storagePath);
        }

        if (paper.url) {
          formData.append("fileUrl", paper.url);
        }

        if (workingFile) {
          formData.append("file", workingFile, fileName);
        }

        const response = await fetch("/api/extract-text", {
          method: "POST",
          body: formData
        });

        if (!response.ok) {
          let message = "Failed to extract text from PDF.";
          let hint: string | undefined;
          try {
            const errorPayload = await response.json();
            if (typeof errorPayload?.error === "string") {
              message = errorPayload.error;
            }
            if (typeof errorPayload?.hint === "string") {
              hint = errorPayload.hint;
            }
          } catch (parseError) {
            console.warn("Extraction error payload parsing failed", parseError);
          }

          setExtractionStates((prev) => ({
            ...prev,
            [paper.id]: {
              status: "error",
              message,
              hint
            }
          }));
          return;
        }

        const payload = (await response.json()) as ExtractedText;

        if (!payload?.text) {
          throw new Error("Extraction response did not include text.");
        }

        setExtractionStates((prev) => ({
          ...prev,
          [paper.id]: {
            status: "success",
            data: payload
          }
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to extract text from PDF.";
        console.error("Extraction error", error);
        setExtractionStates((prev) => ({
          ...prev,
          [paper.id]: {
            status: "error",
            message
          }
        }));
      }
    },
    []
  );

  const runSimilarPapers = useCallback(
    async (paper: UploadedPaper, extraction: ExtractedText) => {
      if (!paper || isMockPaper(paper) || !extraction || typeof extraction.text !== "string" || extraction.text.trim().length === 0) {
        return;
      }

      console.log("[similar-papers] starting fetch", {
        paperId: paper.id,
        textLength: extraction.text.length
      });

      setSimilarPapersStates((prev) => ({
        ...prev,
        [paper.id]: { status: "loading" }
      }));

      try {
        const authors = extractAuthorsFromInfo(extraction.info);
        const abstract = extractAbstractFromInfo(extraction.info);
        const metadataTitle =
          extraction.info && typeof extraction.info.Title === "string" && extraction.info.Title.trim().length > 0
            ? extraction.info.Title.trim()
            : null;

        const response = await fetch("/api/similar-papers", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            text: extraction.text,
            paper: {
              title: metadataTitle ?? paper.name ?? null,
              doi: paper.doi ?? null,
              url: paper.url ?? null,
              authors: authors ?? null,
              abstract: abstract ?? null
            }
          })
        });

        if (!response.ok) {
          let message = "Failed to fetch similar papers.";
          try {
            const errorPayload = await response.json();
            if (typeof errorPayload?.error === "string") {
              message = errorPayload.error;
            }
          } catch (parseError) {
            console.warn("[similar-papers] error payload parsing failed", parseError);
          }
          throw new Error(message);
        }

        const payload = (await response.json()) as { text?: string | null };
        const outputText = typeof payload?.text === "string" ? payload.text.trim() : "";

        if (!outputText) {
          throw new Error("Similar paper response did not include text.");
        }

        console.log("[similar-papers] fetch success", {
          paperId: paper.id,
          textPreview: outputText.slice(0, 120)
        });

        writeCachedState(paper.id, "similarPapers", { text: outputText });

        setSimilarPapersStates((prev) => ({
          ...prev,
          [paper.id]: {
            status: "success",
            text: outputText
          }
        }));
      } catch (error) {
        const message =
          error instanceof Error && error.message ? error.message : "Failed to fetch similar papers.";

        console.error("[similar-papers] fetch error", {
          paperId: paper.id,
          error
        });

        setSimilarPapersStates((prev) => ({
          ...prev,
          [paper.id]: {
            status: "error",
            message
          }
        }));
      }
    },
    []
  );

  const runResearcherTheses = useCallback(
    async (
      paper: UploadedPaper,
      contacts: Array<{ group: string; people: Array<{ name: string | null; email: string | null }> }>
    ) => {
      if (!paper || isMockPaper(paper)) {
        return;
      }

      const researchersPayload = contacts.filter((entry) => entry.people.length > 0);

      if (researchersPayload.length === 0) {
        setResearchThesesStates((prev) => ({
          ...prev,
          [paper.id]: {
            status: "success",
            researchers: []
          }
        }));
        return;
      }

      console.log("[researcher-theses] starting fetch", {
        paperId: paper.id,
        groups: researchersPayload.length
      });

      setResearchThesesStates((prev) => ({
        ...prev,
        [paper.id]: { status: "loading" }
      }));

      try {
        const response = await fetch("/api/researcher-theses", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            contacts: researchersPayload
          })
        });

        if (!response.ok) {
          let message = "Failed to fetch researcher details.";
          try {
            const errorPayload = await response.json();
            if (typeof errorPayload?.error === "string") {
              message = errorPayload.error;
            }
          } catch (parseError) {
            console.warn("[researcher-theses] error payload parsing failed", parseError);
          }
          throw new Error(message);
        }

        const payload = (await response.json()) as {
          researchers?: ResearcherThesisRecord[];
        };

        const researchers = Array.isArray(payload?.researchers)
          ? payload.researchers
          : [];

        console.log("[researcher-theses] fetch success", {
          paperId: paper.id,
          researchers: researchers.length
        });

        writeCachedState(paper.id, "theses", { researchers });

        setResearchThesesStates((prev) => ({
          ...prev,
          [paper.id]: {
            status: "success",
            researchers
          }
        }));
      } catch (error) {
        const message =
          error instanceof Error && error.message
            ? error.message
            : "Failed to fetch researcher details.";

        console.error("[researcher-theses] fetch error", {
          paperId: paper.id,
          error
        });

        setResearchThesesStates((prev) => ({
          ...prev,
          [paper.id]: {
            status: "error",
            message
          }
        }));
      }
    },
    []
  );

  const runResearchGroupContacts = useCallback(async (paper: UploadedPaper, researchText: string) => {
    if (!paper || isMockPaper(paper) || researchText.trim().length === 0) {
      return;
    }

    console.log("[research-group-contacts] starting fetch", {
      paperId: paper.id,
      textLength: researchText.length
    });

    setResearchContactsStates((prev) => ({
      ...prev,
      [paper.id]: { status: "loading" }
    }));

    try {
      const response = await fetch("/api/research-group-contacts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          text: researchText
        })
      });

      if (!response.ok) {
        let message = "Failed to fetch contact details.";
        try {
          const errorPayload = await response.json();
          if (typeof errorPayload?.error === "string") {
            message = errorPayload.error;
          }
        } catch (parseError) {
          console.warn("[research-group-contacts] error payload parsing failed", parseError);
        }
        throw new Error(message);
      }

      const payload = (await response.json()) as {
        contacts?: Array<{ group: string; people: Array<{ name: string | null; email: string | null }> }>;
      };

      const contacts = Array.isArray(payload?.contacts) ? payload.contacts : [];

      console.log("[research-group-contacts] fetch success", {
        paperId: paper.id,
        groups: contacts.length
      });

      writeCachedState(paper.id, "contacts", { contacts });

      setResearchContactsStates((prev) => ({
        ...prev,
        [paper.id]: {
          status: "success",
          contacts
        }
      }));

      if (contacts.length > 0) {
        void runResearcherTheses(paper, contacts);
      }
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Failed to fetch contact details.";

      console.error("[research-group-contacts] fetch error", {
        paperId: paper.id,
        error
      });

      setResearchContactsStates((prev) => ({
        ...prev,
        [paper.id]: {
          status: "error",
          message
        }
      }));

      setResearchThesesStates((prev) => ({
        ...prev,
        [paper.id]: {
          status: "error",
          message: "Contact lookup failed, so thesis details are unavailable."
        }
      }));
    }
  }, [runResearcherTheses]);

  const runResearchGroups = useCallback(async (paper: UploadedPaper, extraction: ExtractedText) => {
    if (!paper || isMockPaper(paper) || !extraction?.text) {
      return;
    }

    console.log("[research-groups] starting fetch", {
      paperId: paper.id,
      extractionTextLength: extraction.text.length
    });

    setResearchGroupsStates((prev) => ({
      ...prev,
      [paper.id]: { status: "loading" }
    }));

    try {
      const response = await fetch("/api/research-groups", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          paperId: paper.id,
          paperName: paper.name,
          doi: paper.doi,
          text: extraction.text,
          metadata: {
            pages: extraction.pages,
            info: extraction.info
          }
        })
      });

      if (!response.ok) {
        let message = "Failed to fetch research groups.";
        try {
          const errorPayload = await response.json();
          if (typeof errorPayload?.error === "string") {
            message = errorPayload.error;
          }
        } catch (parseError) {
          console.warn("Research groups error payload parsing failed", parseError);
        }
        throw new Error(message);
      }

      const payload = (await response.json()) as { text?: string | null };
      const outputText = typeof payload?.text === "string" ? payload.text.trim() : "";

      if (!outputText) {
        throw new Error("Research response did not include text.");
      }

      console.log("[research-groups] fetch success", {
        paperId: paper.id,
        textPreview: outputText.slice(0, 120)
      });

      writeCachedState(paper.id, "groups", { text: outputText });

      setResearchGroupsStates((prev) => ({
        ...prev,
        [paper.id]: {
          status: "success",
          text: outputText
        }
      }));

      void runResearchGroupContacts(paper, outputText);
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Failed to gather research groups.";

      console.error("[research-groups] fetch error", {
        paperId: paper.id,
        error
      });

      setResearchGroupsStates((prev) => ({
        ...prev,
        [paper.id]: {
          status: "error",
          message
        }
      }));
    }
  }, [runResearchGroupContacts]);

  // Open sidebar when user logs in
  useEffect(() => {
    if (!prevUserRef.current && user) {
      setSidebarCollapsed(false);
    }
    prevUserRef.current = user;
  }, [user]);

  useEffect(() => {
    return () => {
      objectUrlsRef.current.forEach((url) => {
        URL.revokeObjectURL(url);
      });
      objectUrlsRef.current = [];
    };
  }, []);

  useEffect(() => {
    if (!user) {
      clearObjectUrls();
      setUploadedPapers([MOCK_UPLOADED_PAPER]);
      setActivePaperId(MOCK_SAMPLE_PAPER_ID);
      setUploadStatusMessage(null);
      setUploadErrorMessage(null);
      setExtractionStates({
        [MOCK_SAMPLE_PAPER_ID]: {
          status: "success",
          data: {
            pages: null,
            info: null,
            text: "Static Evidentia sample paper"
          }
        }
      });
      setSimilarPapersStates({
        [MOCK_SAMPLE_PAPER_ID]: {
          status: "success",
          text:
            typeof MOCK_SIMILAR_PAPERS_LIBRARY?.similarPapers === "string"
              ? MOCK_SIMILAR_PAPERS_LIBRARY.similarPapers
              : ""
        }
      });
    setResearchGroupsStates({
      [MOCK_SAMPLE_PAPER_ID]: {
        status: "success",
        text: MOCK_RESEARCH_GROUPS_TEXT,
        structured: MOCK_RESEARCH_GROUPS_STRUCTURED
      }
    });
    setResearchContactsStates({
      [MOCK_SAMPLE_PAPER_ID]: { status: "success", contacts: [] }
    });
    setResearchThesesStates({
      [MOCK_SAMPLE_PAPER_ID]: MOCK_RESEARCH_THESES_INITIAL_STATE
    });
    return;
  }

    if (!supabase) {
      return;
    }

    let isMounted = true;
    clearObjectUrls();
    setIsFetchingLibrary(true);
    setUploadErrorMessage(null);
    setUploadStatusMessage("Loading your library…");

    fetchUserPapers(supabase, user.id)
      .then((records) => {
        if (!isMounted) {
          return;
        }

        const mapped: UploadedPaper[] = records.map((record: UserPaperRecord) => {
          const publicUrl = record.publicUrl;
          const rawFileName = (record.file_name ?? "paper.pdf").replace(/\s+/g, " ").trim();
          const baseName = rawFileName.replace(/\.pdf$/i, "").trim();
          const fallbackName = baseName.length > 0 ? baseName : rawFileName;
          const displayName = record.title?.trim()?.length ? record.title.trim() : fallbackName || "Untitled paper";

          return {
            id: record.id,
            name: displayName,
            fileName: rawFileName.length > 0 ? rawFileName : "paper.pdf",
            url: publicUrl ?? "",
            uploadedAt: new Date(record.uploaded_at ?? new Date().toISOString()),
            size: record.file_size ?? 0,
            doi: record.doi ?? null,
            storagePath: record.storage_path,
            source: record.storage_path ? "remote" : "local"
          };
        });

        setUploadedPapers(mapped);
        setActivePaperId((prev) => {
          if (!prev || !mapped.some((paper) => paper.id === prev)) {
            return mapped[0]?.id ?? null;
          }
          return prev;
        });

        setExtractionStates((prev) => {
          if (!(MOCK_SAMPLE_PAPER_ID in prev)) {
            return prev;
          }
          const { [MOCK_SAMPLE_PAPER_ID]: _omitted, ...rest } = prev;
          return rest;
        });
        setSimilarPapersStates((prev) => {
          if (!(MOCK_SAMPLE_PAPER_ID in prev)) {
            return prev;
          }
          const { [MOCK_SAMPLE_PAPER_ID]: _omitted, ...rest } = prev;
          return rest;
        });
        setResearchGroupsStates((prev) => {
          if (!(MOCK_SAMPLE_PAPER_ID in prev)) {
            return prev;
          }
          const { [MOCK_SAMPLE_PAPER_ID]: _omitted, ...rest } = prev;
          return rest;
        });
        setResearchContactsStates((prev) => {
          if (!(MOCK_SAMPLE_PAPER_ID in prev)) {
            return prev;
          }
          const { [MOCK_SAMPLE_PAPER_ID]: _omitted, ...rest } = prev;
          return rest;
        });
        setResearchThesesStates((prev) => {
          if (!(MOCK_SAMPLE_PAPER_ID in prev)) {
            return prev;
          }
          const { [MOCK_SAMPLE_PAPER_ID]: _omitted, ...rest } = prev;
          return rest;
        });

        setUploadStatusMessage(null);
      })
      .catch((error) => {
        if (!isMounted) {
          return;
        }
        console.error("Failed to fetch saved papers", error);
        const parsedError = parseUploadError(error);
        setUploadErrorMessage(parsedError.message);
      })
      .finally(() => {
        if (!isMounted) {
          return;
        }
        setIsFetchingLibrary(false);
        setUploadStatusMessage(null);
      });

    return () => {
      isMounted = false;
    };
  }, [clearObjectUrls, supabase, user]);

  useEffect(() => {
    if (!activePaper || isMockPaper(activePaper)) {
      return;
    }

    const state = extractionStates[activePaper.id];

    if (!state) {
      void runExtraction(activePaper);
    }
  }, [activePaper, extractionStates, runExtraction]);

  useEffect(() => {
    if (!activePaper) {
      return;
    }

    if (!activeExtraction || activeExtraction.status !== "success") {
      return;
    }

    if (activeSimilarPapersState) {
      return;
    }

    void runSimilarPapers(activePaper, activeExtraction.data);
  }, [activePaper, activeExtraction, activeSimilarPapersState, runSimilarPapers]);

  useEffect(() => {
    if (activeTab !== "researchGroups") {
      return;
    }

    if (!activePaper) {
      return;
    }

    if (!activeExtraction || activeExtraction.status !== "success") {
      return;
    }

    if (activeResearchGroupState) {
      return;
    }

    void runResearchGroups(activePaper, activeExtraction.data);
  }, [activeTab, activePaper, activeExtraction, activeResearchGroupState, runResearchGroups]);

  useEffect(() => {
    if (activeTab !== "theses") {
      return;
    }

    if (!activePaper) {
      return;
    }

    if (activeResearchThesesState) {
      return;
    }

    if (!activeResearchContactsState || activeResearchContactsState.status !== "success") {
      return;
    }

    if (activeResearchContactsState.contacts.length === 0) {
      return;
    }

    void runResearcherTheses(activePaper, activeResearchContactsState.contacts);
  }, [
    activeTab,
    activePaper,
    activeResearchContactsState,
    activeResearchThesesState,
    runResearcherTheses
  ]);

  const handlePaperUpload = useCallback(
    async (file: File) => {
      // Check authentication FIRST before any processing
      if (!user) {
        open("login");
        return;
      }

      if (isSavingPaper) {
        return;
      }

      // Reset dismiss state on new upload
      setIsStatusDismissed(false);

      // Validate file size before proceeding
      const validation = validateFileSize(file);
      if (!validation.valid) {
        setUploadStatusMessage(null);
        setUploadErrorMessage(validation.error.message);
        return;
      }

      setUploadErrorMessage(null);
      setUploadStatusMessage("Extracting DOI…");
      setIsSavingPaper(true);

      const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const rawName = file.name.replace(/\s+/g, " ").trim();
      const nameWithoutExtension = rawName.replace(/\.pdf$/i, "");
      const displayName = nameWithoutExtension.length > 0 ? nameWithoutExtension : rawName || "Untitled paper";

      try {
        const doiResult = await extractDoiFromPdf(file);
        const doi = doiResult.doi;

        if (supabase) {
          setUploadStatusMessage("Saving paper to your library…");
          const { record, publicUrl } = await persistUserPaper({
            client: supabase,
            userId: user.id,
            file,
            doi,
            title: displayName
          });

          const paperUrl = publicUrl ?? URL.createObjectURL(file);
          if (!publicUrl) {
            objectUrlsRef.current.push(paperUrl);
          }

          const nextPaper: UploadedPaper = {
            id: record.id ?? id,
            name: record.title?.trim() && record.title.trim().length > 0 ? record.title.trim() : displayName,
            fileName: record.file_name ?? rawName ?? "upload.pdf",
            url: paperUrl,
            uploadedAt: new Date(record.uploaded_at ?? new Date().toISOString()),
            size: record.file_size ?? file.size,
            doi: record.doi ?? doi,
            storagePath: record.storage_path,
            source: record.storage_path ? "remote" : "local"
          };

          setUploadedPapers((prev) => [
            nextPaper,
            ...prev.filter((item) => item.id !== nextPaper.id && !isMockPaper(item))
          ]);
          setActivePaperId(nextPaper.id);
          setActiveTab("paper");
          void runExtraction(nextPaper, { file });
          setUploadStatusMessage(
            doi
              ? `Saved and linked DOI ${doi}`
              : "Saved, but we could not detect a DOI."
          );
        } else {
          setUploadStatusMessage("Saving locally (Supabase is not configured).");
          const url = URL.createObjectURL(file);
          objectUrlsRef.current.push(url);

          const nextPaper: UploadedPaper = {
            id,
            name: displayName,
            fileName: rawName || "upload.pdf",
            url,
            uploadedAt: new Date(),
            size: file.size,
            doi,
            source: "local"
          };

          setUploadedPapers((prev) => [
            nextPaper,
            ...prev.filter((item) => item.id !== nextPaper.id && !isMockPaper(item))
          ]);
          setActivePaperId(id);
          setActiveTab("paper");
          void runExtraction(nextPaper, { file });
        }
      } catch (error) {
        console.error("Failed to process upload", error);
        const parsedError = parseUploadError(error);
        setUploadErrorMessage(parsedError.message);
      } finally {
        setIsSavingPaper(false);
      }
    },
    [isSavingPaper, open, runExtraction, setActiveTab, supabase, user]
  );

  const handleSelectPaper = useCallback(
    (paperId: string) => {
      setActivePaperId(paperId);
      setActiveTab("paper");
    },
    [setActiveTab]
  );

  const handleShowUpload = useCallback(() => {
    setActivePaperId(null);
    setActiveTab("paper");
    // Trigger file picker immediately
    setTimeout(() => {
      fileInputRef.current?.click();
    }, 0);
  }, [setActivePaperId, setActiveTab]);

  const handleRetrySimilarPapers = useCallback(() => {
    if (!activePaper) {
      return;
    }

    if (!activeExtraction || activeExtraction.status !== "success") {
      return;
    }

    void runSimilarPapers(activePaper, activeExtraction.data);
  }, [activePaper, activeExtraction, runSimilarPapers]);

  const handleRetryResearchGroups = useCallback(() => {
    if (!activePaper) {
      return;
    }

    if (!activeExtraction || activeExtraction.status !== "success") {
      return;
    }

    void runResearchGroups(activePaper, activeExtraction.data);
  }, [activePaper, activeExtraction, runResearchGroups]);

  const handleDeletePaper = useCallback(
    async (paperId: string) => {
      if (paperId === MOCK_SAMPLE_PAPER_ID) {
        return;
      }

      if (!user || !supabase) {
        return;
      }

      const paperToDelete = uploadedPapers.find((p) => p.id === paperId);
      if (!paperToDelete) {
        return;
      }

      // Show browser confirmation
      const paperName = paperToDelete.name || "this paper";
      const confirmed = window.confirm(`Delete "${paperName}"? This cannot be undone.`);
      if (!confirmed) {
        return;
      }

      try {
        // Calculate remaining papers before deletion
        const remainingPapers = uploadedPapers.filter((p) => p.id !== paperId);

        // Optimistically remove from UI
        setUploadedPapers(remainingPapers);

        // If deleted paper was active, select another or show upload
        if (activePaperId === paperId) {
          if (remainingPapers.length > 0) {
            // Select the first remaining paper
            setActivePaperId(remainingPapers[0].id);
          } else {
            // No papers left - show upload UI
            setActivePaperId(null);
            setActiveTab("paper");
          }
        }

        // Delete from Supabase
        if (paperToDelete.storagePath) {
          await deleteUserPaper({
            client: supabase,
            userId: user.id,
            paperId,
            storagePath: paperToDelete.storagePath
          });
        }

        setUploadStatusMessage(`Deleted "${paperName}"`);
        setUploadErrorMessage(null);
        setIsStatusDismissed(false);
      } catch (error) {
        console.error("Failed to delete paper", error);
        const parsedError = parseUploadError(error);
        setUploadErrorMessage(parsedError.message);

        // Revert optimistic update on error
        setUploadedPapers((prev) => {
          const exists = prev.find((p) => p.id === paperId);
          if (!exists && paperToDelete) {
            return [paperToDelete, ...prev].sort(
              (a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime()
            );
          }
          return prev;
        });
      }
    },
    [activePaperId, supabase, uploadedPapers, user, setActiveTab]
  );

  const resolvedStatusText =
    uploadErrorMessage ??
    uploadStatusMessage ??
    (isSavingPaper ? "Saving your paper…" : isFetchingLibrary ? "Loading your library…" : null);

  const statusTone: "error" | "info" | null = uploadErrorMessage
    ? "error"
    : resolvedStatusText
      ? "info"
      : null;

  const renderActiveTab = () => {
    if (activeTab === "paper") {
      return (
        <PaperTabContent
          onUpload={handlePaperUpload}
          activePaper={activePaper}
          isUploading={isSavingPaper}
          helperText={dropzoneHelperText}
          viewerClassName={isPaperViewerActive ? "!h-full w-full flex-1" : undefined}
        />
      );
    }

    if (activeTab === "similarPapers") {
      return (
        <SimilarPapersPanel
          paper={activePaper}
          extraction={activeExtraction}
          state={activeSimilarPapersState}
          onRetry={handleRetrySimilarPapers}
        />
      );
    }

    if (activeTab === "researchGroups") {
      return (
        <ResearchGroupsPanel
          paper={activePaper}
          extraction={activeExtraction}
          state={activeResearchGroupState}
          contacts={activeResearchContactsState}
          onRetry={handleRetryResearchGroups}
        />
      );
    }

    if (activeTab === "theses") {
      return (
        <ResearcherThesesPanel
          state={activeResearchThesesState}
          hasResearchGroups={Boolean(activeResearchGroupState && activeResearchGroupState.status === "success")}
          isMock={Boolean(isActivePaperMock)}
          structuredGroups={
            isActivePaperMock ? MOCK_RESEARCH_GROUPS_STRUCTURED : activeResearchGroupState?.structured
          }
        />
      );
    }

    if (activeTab === "experts") {
      return <ExpertNetworkPanel paper={activePaper} isMock={Boolean(isActivePaperMock)} />;
    }

    if (activeTab === "patents") {
      return <PatentsPanel state={activeExtraction} paper={activePaper} isMock={Boolean(isActivePaperMock)} />;
    }

    return <ExtractionDebugPanel state={activeExtraction} paper={activePaper} />;
  };

  return (
    <div className="flex min-h-screen bg-gradient-to-br from-slate-100 via-white to-slate-100 text-slate-900">
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            void handlePaperUpload(file);
          }
          // Reset input so the same file can be selected again
          if (event.target.value) {
            event.target.value = "";
          }
        }}
      />
      <AppSidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((prev) => !prev)}
        papers={uploadedPapers}
        activePaperId={activePaperId}
        onSelectPaper={handleSelectPaper}
        onShowUpload={handleShowUpload}
        onDeletePaper={handleDeletePaper}
        isLoading={isFetchingLibrary}
      />
      <div className="flex flex-1 flex-col">
        <main
          className="flex flex-1 flex-col"
          data-has-uploads={uploadedPapers.length > 0 ? "true" : "false"}
          data-active-paper={activePaperId ?? ""}
        >
          <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
            <div className="mx-auto flex w-full max-w-6xl items-center justify-center gap-4 px-4 py-2 sm:px-6 lg:px-10">
              <PaperTabNav
                activeTab={activeTab}
                onTabChange={setActiveTab}
                variant="horizontal"
              />
            </div>
          </header>
          {statusTone && resolvedStatusText && !isStatusDismissed && (
            <div
              className={`relative flex items-center justify-between gap-4 px-4 py-2 text-sm sm:px-6 lg:px-10 ${
                statusTone === "error"
                  ? "border-b border-red-200 bg-red-50 text-red-700"
                  : "border-b border-slate-200 bg-slate-50 text-slate-600"
              }`}
            >
              <span>{resolvedStatusText}</span>
              <button
                type="button"
                onClick={() => setIsStatusDismissed(true)}
                className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full transition hover:bg-black/10 ${
                  statusTone === "error" ? "text-red-700" : "text-slate-600"
                }`}
                aria-label="Dismiss message"
              >
                ×
              </button>
            </div>
          )}
          <div
            className={
              isPaperViewerActive
                ? "flex flex-1 overflow-hidden"
                : "flex-1 overflow-y-auto px-2 pb-8 pt-2"
            }
          >
            {renderActiveTab()}
          </div>
        </main>
      </div>
    </div>
  );
}
