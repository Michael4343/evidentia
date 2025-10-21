"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { AppSidebar } from "@/components/app-sidebar";
import { PaperTabNav } from "@/components/paper-tab-nav";
import { PdfViewer } from "@/components/pdf-viewer";
import { UploadDropzone } from "@/components/upload-dropzone";
import { MockSimilarPapersShowcase } from "@/components/mock-similar-papers-showcase";
import { MOCK_SAMPLE_PAPER_ID, MOCK_SAMPLE_PAPER_META } from "@/lib/mock-sample-paper";
import {
  listMockLibrarySummaries,
  listMockLibraryEntryIds,
  type MockLibraryEntrySummary,
  type RawMockLibraryEntry
} from "@/lib/mock-library";
import { useAuthModal } from "@/components/auth-modal-provider";
import { ReaderTabKey } from "@/lib/reader-tabs";
import { extractDoiFromPdf } from "@/lib/pdf-doi";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { parseUploadError, validateFileSize } from "@/lib/upload-errors";
import { deleteUserPaper, fetchUserPapers, persistUserPaper, saveClaimsToStorage, loadClaimsFromStorage, saveSimilarPapersToStorage, loadSimilarPapersFromStorage, savePatentsToStorage, loadPatentsFromStorage, saveVerifiedClaimsToStorage, loadVerifiedClaimsFromStorage, saveResearchGroupsToStorage, loadResearchGroupsFromStorage, saveContactsToStorage, loadContactsFromStorage, saveThesesToStorage, loadThesesFromStorage, type UserPaperRecord } from "@/lib/user-papers";

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

const MOCK_LIBRARY_SUMMARIES = listMockLibrarySummaries();
const MOCK_LIBRARY_ENTRY_IDS = listMockLibraryEntryIds();
const MOCK_LIBRARY_ENTRY_IDS_SET = new Set(MOCK_LIBRARY_ENTRY_IDS);
const MOCK_SUMMARIES_BY_ID = new Map<string, MockLibraryEntrySummary>(
  MOCK_LIBRARY_SUMMARIES.map((summary) => [summary.id, summary])
);

// Module-level storage for countdown start times (persists across remounts)
const countdownStartTimes = new Map<string, number>();

function useCountdown(durationMs: number, isActive: boolean, key: string) {
  const [remaining, setRemaining] = useState(durationMs);

  useEffect(() => {
    if (!isActive) {
      // Clear the stored start time when inactive
      if (key) {
        countdownStartTimes.delete(key);
      }
      setRemaining(durationMs);
      return;
    }

    // Check if we already have a start time for this step
    let startTime = countdownStartTimes.get(key);

    if (!startTime) {
      // New step - record the start time
      startTime = Date.now();
      countdownStartTimes.set(key, startTime);
    }

    // Calculate initial remaining time based on stored start
    const initialElapsed = Date.now() - startTime;
    const initialRemaining = Math.max(0, durationMs - initialElapsed);
    setRemaining(initialRemaining);

    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime!;
      const left = Math.max(0, durationMs - elapsed);
      setRemaining(left);

      if (left === 0) {
        clearInterval(interval);
      }
    }, 100);

    return () => clearInterval(interval);
  }, [durationMs, isActive, key]);

  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function toMockUploadedPaper(summary: MockLibraryEntrySummary): UploadedPaper {
  const generatedAt = summary.raw.updatedAt ?? summary.raw.generatedAt ?? new Date().toISOString();
  return {
    id: summary.id,
    name: summary.title,
    fileName: summary.fileName,
    url: summary.pdfUrl,
    uploadedAt: new Date(generatedAt),
    size: 0,
    doi: summary.doi,
    source: "local"
  };
}

const MOCK_UPLOADED_PAPERS_FROM_SUMMARIES = MOCK_LIBRARY_SUMMARIES.map(toMockUploadedPaper);
const DEFAULT_MOCK_SUMMARY = MOCK_SUMMARIES_BY_ID.get(MOCK_SAMPLE_PAPER_ID) ?? MOCK_LIBRARY_SUMMARIES[0];
const DEFAULT_ENTRY_RAW: RawMockLibraryEntry = DEFAULT_MOCK_SUMMARY?.raw ?? {};

const MOCK_RESEARCH_GROUPS_TEXT =
  typeof (DEFAULT_ENTRY_RAW?.researchGroups as any)?.text === "string"
    ? (DEFAULT_ENTRY_RAW.researchGroups as any).text
    : "";

const MOCK_RESEARCH_GROUPS_STRUCTURED: ResearchGroupPaperEntry[] | undefined = Array.isArray(
  (DEFAULT_ENTRY_RAW?.researchGroups as any)?.structured?.papers
)
  ? ((DEFAULT_ENTRY_RAW.researchGroups as any).structured.papers as ResearchGroupPaperEntry[])
  : undefined;

const PIPELINE_TIMEOUT_MS = 300_000;
const PIPELINE_TIMEOUT_LABEL = `${PIPELINE_TIMEOUT_MS / 1000}s`;

function isMockPaper(paper: UploadedPaper | null | undefined) {
  if (!paper?.id) {
    return false;
  }
  return MOCK_LIBRARY_ENTRY_IDS_SET.has(paper.id);
}

function removeMockState<T>(state: Record<string, T>): Record<string, T> {
  const entries = Object.entries(state).filter(([paperId]) => !MOCK_LIBRARY_ENTRY_IDS_SET.has(paperId));
  return Object.fromEntries(entries) as Record<string, T>;
}

type CacheStage = "similarPapers" | "groups" | "contacts" | "theses" | "patents" | "verifiedClaims";

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

function ensureSourcePaperInSimilarStructured(
  paper: UploadedPaper,
  structured?: SimilarPapersStructured
): SimilarPapersStructured | undefined {
  if (!structured) {
    return structured;
  }

  const similarArray = Array.isArray(structured.similarPapers)
    ? structured.similarPapers.filter(Boolean)
    : [];

  const normalizedDoi = typeof paper.doi === "string" ? paper.doi.trim().toLowerCase() : null;
  const existingIndex = similarArray.findIndex((entry) => {
    if (!entry) {
      return false;
    }
    const entryId = typeof entry.identifier === "string" ? entry.identifier : "";
    const entryDoi = typeof entry.doi === "string" ? entry.doi.trim().toLowerCase() : null;
    if (normalizedDoi && entryDoi && entryDoi === normalizedDoi) {
      return true;
    }
    return entryId === paper.id;
  });

  let changed = false;
  let nextSimilar = similarArray;

  if (existingIndex === -1) {
    const sourceEntry: NonNullable<SimilarPapersStructured["similarPapers"]>[number] = {
      identifier: paper.doi ?? paper.id,
      title: paper.name ?? "Uploaded paper",
      doi: paper.doi ?? null,
      url: paper.url ?? undefined,
      clusterLabel: "Source paper",
      whyRelevant: "Original uploaded paper used for this comparison."
    };

    if (structured.sourcePaper?.methodMatrix) {
      sourceEntry.methodMatrix = structured.sourcePaper.methodMatrix;
    }

    nextSimilar = [sourceEntry, ...similarArray];
    changed = true;
  } else if (existingIndex > 0) {
    nextSimilar = [...similarArray];
    const [existing] = nextSimilar.splice(existingIndex, 1);
    nextSimilar = [existing, ...nextSimilar];
    changed = true;
  }

  const existingSummary = structured.sourcePaper?.summary;
  const fallbackSummary = `Original paper: ${paper.name ?? "Untitled paper"}`;
  const wantedSummary = existingSummary && existingSummary.trim().length > 0 ? existingSummary : fallbackSummary;

  let nextSourcePaper = structured.sourcePaper;
  if (!existingSummary || existingSummary.trim().length === 0) {
    nextSourcePaper = {
      ...(structured.sourcePaper ?? {}),
      summary: wantedSummary
    };
    changed = true;
  }

  if (!changed) {
    return structured;
  }

  return {
    ...structured,
    sourcePaper: nextSourcePaper,
    similarPapers: nextSimilar
  };
}

function normalizeResearchGroupsStructured(raw: unknown): ResearchGroupPaperEntry[] | undefined {
  if (!raw) {
    return undefined;
  }

  const candidate = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as any).papers)
      ? (raw as any).papers
      : [];

  if (!Array.isArray(candidate) || candidate.length === 0) {
    return undefined;
  }

  return candidate
    .map((entry: any) => {
      const groups = Array.isArray(entry?.groups)
        ? entry.groups.map((group: any) => ({
            name: typeof group?.name === "string" ? group.name : "Unknown group",
            institution: typeof group?.institution === "string" ? group.institution : null,
            website: typeof group?.website === "string" ? group.website : null,
            notes: typeof group?.notes === "string" ? group.notes : null,
            researchers: Array.isArray(group?.researchers)
              ? group.researchers.map((person: any) => ({
                  name: typeof person?.name === "string" ? person.name : null,
                  email: typeof person?.email === "string" ? person.email : null,
                  role: typeof person?.role === "string" ? person.role : null
                }))
              : []
          }))
        : [];

      const title = typeof entry?.title === "string" ? entry.title : "Untitled paper";
      const identifier = typeof entry?.identifier === "string" ? entry.identifier : null;

      return {
        title,
        identifier,
        groups
      } satisfies ResearchGroupPaperEntry;
    })
    .filter((entry) => entry);
}

function normalizePatentEntry(raw: any): PatentEntry | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const patentNumber = typeof raw.patentNumber === "string" && raw.patentNumber.trim().length > 0 ? raw.patentNumber.trim() : null;
  const title = typeof raw.title === "string" && raw.title.trim().length > 0 ? raw.title.trim() : null;
  const assignee = typeof raw.assignee === "string" && raw.assignee.trim().length > 0 ? raw.assignee.trim() : null;
  const filingDate = typeof raw.filingDate === "string" && raw.filingDate.trim().length > 0 ? raw.filingDate.trim() : null;
  const grantDate = typeof raw.grantDate === "string" && raw.grantDate.trim().length > 0 ? raw.grantDate.trim() : null;
  const summary = typeof raw.abstract === "string" && raw.abstract.trim().length > 0 ? raw.abstract.trim() : null;
  const url = typeof raw.url === "string" && raw.url.trim().length > 0 ? raw.url.trim() : null;

  const overlapRaw = raw.overlapWithPaper;
  const claimIds = Array.isArray(overlapRaw?.claimIds)
    ? overlapRaw.claimIds
        .map((claim: any) => (typeof claim === "string" ? claim.trim() : ""))
        .filter((claim: string) => claim.length > 0)
    : [];
  const overlapSummary =
    overlapRaw && typeof overlapRaw.summary === "string" && overlapRaw.summary.trim().length > 0
      ? overlapRaw.summary.trim()
      : null;

  const overlap: PatentOverlapWithPaper | null = claimIds.length > 0 || overlapSummary
    ? {
        claimIds,
        summary: overlapSummary
      }
    : null;

  return {
    patentNumber,
    title,
    assignee,
    filingDate,
    grantDate,
    abstract: summary,
    url,
    overlapWithPaper: overlap
  };
}

function normalizePatentsStructured(raw: unknown): PatentsStructured | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }

  const rawObject = raw as { patents?: unknown; promptNotes?: unknown };
  const promptNotes = typeof rawObject.promptNotes === "string" && rawObject.promptNotes.trim().length > 0 ? rawObject.promptNotes.trim() : null;
  const patentsArray = Array.isArray(rawObject.patents) ? rawObject.patents : [];

  const patents = patentsArray
    .map((entry) => normalizePatentEntry(entry))
    .filter((entry): entry is PatentEntry => Boolean(entry));

  if (patents.length === 0 && !promptNotes) {
    return undefined;
  }

  return {
    ...(patents.length > 0 ? { patents } : {}),
    ...(promptNotes ? { promptNotes } : {})
  };
}

function normalizeVerifiedClaimEvidence(raw: any): VerifiedClaimEvidence | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const source = typeof raw.source === "string" && raw.source.trim().length > 0 ? raw.source.trim() : "";
  const title = typeof raw.title === "string" && raw.title.trim().length > 0 ? raw.title.trim() : "";
  const relevance = typeof raw.relevance === "string" && raw.relevance.trim().length > 0 ? raw.relevance.trim() : null;

  if (!source || !title) {
    return null;
  }

  return {
    source,
    title,
    ...(relevance ? { relevance } : {})
  };
}

function normalizeVerifiedClaimsStructured(raw: unknown): VerifiedClaimsStructured | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }

  const rawObject = raw as { claims?: unknown; overallAssessment?: unknown; promptNotes?: unknown };

  const claimsArray = Array.isArray(rawObject.claims) ? rawObject.claims : [];

  const claims = claimsArray
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const claimId = typeof (entry as any).claimId === "string" && (entry as any).claimId.trim().length > 0
        ? (entry as any).claimId.trim()
        : null;
      const originalClaim = typeof (entry as any).originalClaim === "string" && (entry as any).originalClaim.trim().length > 0
        ? (entry as any).originalClaim.trim()
        : null;

      if (!claimId || !originalClaim) {
        return null;
      }

      const verificationStatusRaw = typeof (entry as any).verificationStatus === "string"
        ? (entry as any).verificationStatus.trim()
        : "";
      const verificationStatus: VerifiedClaimStatus =
        verificationStatusRaw === "Verified" ||
        verificationStatusRaw === "Partially Verified" ||
        verificationStatusRaw === "Contradicted" ||
        verificationStatusRaw === "Insufficient Evidence"
          ? verificationStatusRaw
          : "Insufficient Evidence";

      const confidenceRaw = typeof (entry as any).confidenceLevel === "string"
        ? (entry as any).confidenceLevel.trim()
        : "";
      const confidenceLevel: VerifiedClaimConfidence =
        confidenceRaw === "High" || confidenceRaw === "Moderate" || confidenceRaw === "Low"
          ? confidenceRaw
          : "Low";

      const supportingEvidence = Array.isArray((entry as any).supportingEvidence)
        ? (entry as any).supportingEvidence.map(normalizeVerifiedClaimEvidence).filter(Boolean)
        : [];
      const contradictingEvidence = Array.isArray((entry as any).contradictingEvidence)
        ? (entry as any).contradictingEvidence.map(normalizeVerifiedClaimEvidence).filter(Boolean)
        : [];

      const verificationSummary = typeof (entry as any).verificationSummary === "string"
        ? (entry as any).verificationSummary.trim()
        : null;

      return {
        claimId,
        originalClaim,
        verificationStatus,
        supportingEvidence: supportingEvidence as VerifiedClaimEvidence[],
        contradictingEvidence: contradictingEvidence as VerifiedClaimEvidence[],
        ...(verificationSummary ? { verificationSummary } : {}),
        confidenceLevel
      } satisfies VerifiedClaimEntry;
    })
    .filter((entry): entry is VerifiedClaimEntry => Boolean(entry));

  if (claims.length === 0) {
    return undefined;
  }

  const overallAssessment = typeof rawObject.overallAssessment === "string" && rawObject.overallAssessment.trim().length > 0
    ? rawObject.overallAssessment.trim()
    : undefined;
  const promptNotes = typeof rawObject.promptNotes === "string" && rawObject.promptNotes.trim().length > 0
    ? rawObject.promptNotes.trim()
    : undefined;

  return {
    claims,
    ...(overallAssessment ? { overallAssessment } : {}),
    ...(promptNotes ? { promptNotes } : {})
  };
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

interface ResearcherThesisDeepDiveThesis {
  thesis_title: string | null;
  author: string | null;
  year: number | null;
  research_group: string | null;
  principal_investigator: string | null;
  thesis_url: string | null;
  data_url: string | null;
  data_synopsis: string | null;
  data_access: "public" | "restricted" | "unknown";
  notes: string | null;
}

interface ResearcherThesisDeepDive {
  generatedAt?: string | null;
  paper: {
    title: string | null;
    identifier: string | null;
    year: number | null;
  };
  group: {
    name: string | null;
    institution: string | null;
    website: string | null;
  };
  text?: string | null;
  structured?: {
    theses: ResearcherThesisDeepDiveThesis[];
    sources_checked?: string[];
    follow_up?: string[];
    promptNotes?: string | null;
  };
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

interface SimilarPapersStructured {
  sourcePaper?: {
    summary?: string;
    keyMethodSignals?: string[];
    searchQueries?: string[];
    methodMatrix?: Record<string, string>;
  };
  similarPapers?: Array<{
    identifier: string;
    title: string;
    doi?: string | null;
    url?: string | null;
    authors?: string[];
    year?: number | null;
    venue?: string | null;
    clusterLabel?: string;
    whyRelevant?: string;
    overlapHighlights?: string[];
    methodMatrix?: Record<string, string>;
    gapsOrUncertainties?: string | null;
  }>;
  promptNotes?: string;
}

type SimilarPapersState =
  | { status: "loading" }
  | { status: "success"; text: string; structured?: SimilarPapersStructured }
  | { status: "error"; message: string };

interface PatentOverlapWithPaper {
  claimIds: string[];
  summary: string | null;
}

interface PatentEntry {
  patentNumber: string | null;
  title: string | null;
  assignee: string | null;
  filingDate: string | null;
  grantDate: string | null;
  abstract: string | null;
  url: string | null;
  overlapWithPaper: PatentOverlapWithPaper | null;
}

interface PatentsStructured {
  patents?: PatentEntry[];
  promptNotes?: string | null;
}

type PatentsState =
  | { status: "loading" }
  | { status: "success"; text?: string; structured?: PatentsStructured }
  | { status: "error"; message: string };

type VerifiedClaimStatus = "Verified" | "Partially Verified" | "Contradicted" | "Insufficient Evidence";
type VerifiedClaimConfidence = "High" | "Moderate" | "Low";

interface VerifiedClaimEvidence {
  source: string;
  title: string;
  relevance?: string | null;
}

interface VerifiedClaimEntry {
  claimId: string;
  originalClaim: string;
  verificationStatus: VerifiedClaimStatus;
  supportingEvidence: VerifiedClaimEvidence[];
  contradictingEvidence: VerifiedClaimEvidence[];
  verificationSummary?: string | null;
  confidenceLevel: VerifiedClaimConfidence;
}

interface VerifiedClaimsStructured {
  claims?: VerifiedClaimEntry[];
  overallAssessment?: string | null;
  promptNotes?: string | null;
}

type VerifiedClaimsState =
  | { status: "loading" }
  | { status: "success"; text?: string; structured?: VerifiedClaimsStructured }
  | { status: "error"; message: string };

type ClaimsAnalysisStrength = "High" | "Moderate" | "Low" | "Unclear";

interface ClaimsAnalysisClaim {
  readonly id: string;
  readonly claim: string;
  readonly evidenceSummary?: string | null;
  readonly keyNumbers?: string[] | readonly string[];
  readonly source?: string | null;
  readonly strength?: ClaimsAnalysisStrength;
  readonly assumptions?: string | null;
  readonly evidenceType?: string | null;
}

interface ClaimsAnalysisGap {
  readonly category: string;
  readonly detail: string;
  readonly relatedClaimIds?: string[] | readonly string[];
}

interface ClaimsAnalysisRiskItem {
  readonly item: string;
  readonly status: "met" | "partial" | "missing" | "unclear";
  readonly note?: string | null;
}

interface ClaimsAnalysisStructured {
  executiveSummary?: string[] | readonly string[];
  claims?: ClaimsAnalysisClaim[] | readonly ClaimsAnalysisClaim[];
  gaps?: ClaimsAnalysisGap[] | readonly ClaimsAnalysisGap[];
  methodsSnapshot?: string[] | readonly string[];
  riskChecklist?: ClaimsAnalysisRiskItem[] | readonly ClaimsAnalysisRiskItem[];
  openQuestions?: string[] | readonly string[];
  crossPaperComparison?: string[] | readonly string[];
}

type ClaimsAnalysisState =
  | { status: "loading" }
  | {
      status: "success";
      text?: string;
      structured?: ClaimsAnalysisStructured;
    }
  | { status: "error"; message: string };

type ResearchGroupContactsState =
  | { status: "loading" }
  | { status: "success"; contacts: Array<{ group: string; people: Array<{ name: string | null; email: string | null }> }> }
  | { status: "error"; message: string };

type ResearcherThesesState =
  | { status: "loading"; deepDives?: ResearcherThesisDeepDive[] }
  | {
      status: "success";
      researchers: ResearcherThesisRecord[];
      text?: string;
      deepDives?: ResearcherThesisDeepDive[];
    }
  | { status: "error"; message: string; deepDives?: ResearcherThesisDeepDive[] };

interface ClaimsGenerationResult {
  text?: string;
  structured?: ClaimsAnalysisStructured;
}

interface SimilarPapersResult {
  text: string;
  structured?: SimilarPapersStructured;
}

interface ResearchGroupsResult {
  text: string;
  structured?: ResearchGroupPaperEntry[];
}

interface ResearchContactsResult {
  contacts: Array<{ group: string; people: Array<{ name: string | null; email: string | null }> }>;
}

interface ResearcherThesesResult {
  researchers: ResearcherThesisRecord[];
  text?: string;
  deepDives?: ResearcherThesisDeepDive[];
}

interface PatentsResult {
  text?: string;
  structured?: PatentsStructured;
}

interface VerifiedClaimsResult {
  text?: string;
  structured?: VerifiedClaimsStructured;
}

type PipelineStageId =
  | "extraction"
  | "claims"
  | "similarPapers"
  | "researchGroups"
  | "contacts"
  | "theses"
  | "patents"
  | "verifiedClaims";

const PIPELINE_STAGE_ORDER: readonly PipelineStageId[] = [
  "extraction",
  "claims",
  "similarPapers",
  "researchGroups",
  "contacts",
  "theses",
  "patents",
  "verifiedClaims"
];

const PIPELINE_STAGE_INDEX: Record<PipelineStageId, number> = {
  extraction: 0,
  claims: 1,
  similarPapers: 2,
  researchGroups: 3,
  contacts: 4,
  theses: 5,
  patents: 6,
  verifiedClaims: 7
};

const PIPELINE_STAGE_METADATA: Record<PipelineStageId, { label: string; helper: string }> = {
  extraction: {
    label: "PDF Upload",
    helper: "Extracting the paper contents"
  },
  claims: {
    label: "Claims Brief",
    helper: "Summarising core assertions"
  },
  similarPapers: {
    label: "Similar Papers",
    helper: "Finding related research"
  },
  researchGroups: {
    label: "Research Groups",
    helper: "Mapping active teams"
  },
  contacts: {
    label: "Contacts",
    helper: "Finding researcher contacts"
  },
  theses: {
    label: "PhD Theses",
    helper: "Pulling thesis insights"
  },
  patents: {
    label: "Patents",
    helper: "Checking overlapping patents"
  },
  verifiedClaims: {
    label: "Verified Claims",
    helper: "Running fact checks"
  }
};

const PIPELINE_STAGE_EMOJI: Record<PipelineStageId, string> = {
  extraction: "📄",
  claims: "🗂️",
  similarPapers: "🔍",
  researchGroups: "🧪",
  contacts: "👥",
  theses: "🎓",
  patents: "🛠️",
  verifiedClaims: "✅"
};

const PIPELINE_STAGE_TO_TAB: Partial<Record<PipelineStageId, ReaderTabKey>> = {
  extraction: "paper",
  claims: "claims",
  similarPapers: "similarPapers",
  researchGroups: "researchGroups",
  theses: "theses",
  patents: "patents",
  verifiedClaims: "verifiedClaims"
};

type StageStatus = "idle" | "loading" | "success" | "error";

interface PipelineStageView {
  id: PipelineStageId;
  index: number;
  label: string;
  helper: string;
  status: StageStatus;
  errorMessage?: string;
}

function createExtractionStateFromSummary(summary: MockLibraryEntrySummary): ExtractionState {
  const pages = summary.raw.sourcePdf?.pages;
  return {
    status: "success",
    data: {
      pages: typeof pages === "number" ? pages : null,
      info: null,
      text: summary.title || "Mock paper"
    }
  };
}

function createClaimsStateFromRaw(raw: RawMockLibraryEntry): ClaimsAnalysisState {
  const text = typeof raw.claimsAnalysis?.text === "string" ? raw.claimsAnalysis.text : undefined;
  const structured = raw.claimsAnalysis?.structured && typeof raw.claimsAnalysis.structured === "object"
    ? (raw.claimsAnalysis.structured as ClaimsAnalysisStructured)
    : undefined;
  return {
    status: "success",
    ...(text ? { text } : {}),
    ...(structured ? { structured } : {})
  };
}

function createSimilarStateFromRaw(raw: RawMockLibraryEntry): SimilarPapersState {
  const structured: SimilarPapersStructured | undefined = raw.similarPapers || raw.sourcePaper
    ? {
        sourcePaper: raw.sourcePaper as SimilarPapersStructured["sourcePaper"],
        similarPapers: Array.isArray(raw.similarPapers)
          ? (raw.similarPapers as NonNullable<SimilarPapersStructured["similarPapers"]>)
          : undefined,
        promptNotes: typeof raw.agent?.promptNotes === "string" ? raw.agent.promptNotes : undefined
      }
    : undefined;

  return {
    status: "success",
    text: typeof raw.similarPapers === "string" ? raw.similarPapers : "",
    ...(structured ? { structured } : {})
  };
}

function createPatentsStateFromRaw(raw: RawMockLibraryEntry): PatentsState {
  const text = typeof raw.patents?.text === "string" ? raw.patents.text : undefined;
  const structured = raw.patents?.structured && typeof raw.patents.structured === "object"
    ? (raw.patents.structured as PatentsStructured)
    : undefined;
  return {
    status: "success",
    ...(text ? { text } : {}),
    ...(structured ? { structured } : {})
  };
}

function createVerifiedClaimsStateFromRaw(raw: RawMockLibraryEntry): VerifiedClaimsState {
  const text = typeof raw.verifiedClaims?.text === "string" ? raw.verifiedClaims.text : undefined;
  const structuredClaims = raw.verifiedClaims?.structured;
  const claimsArray = Array.isArray(structuredClaims?.claims) ? structuredClaims.claims : undefined;
  const overallAssessment = typeof structuredClaims?.overallAssessment === "string"
    ? structuredClaims.overallAssessment
    : undefined;
  const promptNotes = typeof raw.verifiedClaims?.promptNotes === "string" ? raw.verifiedClaims.promptNotes : undefined;
  const structured: VerifiedClaimsStructured | undefined = claimsArray || overallAssessment || promptNotes
    ? {
        claims: claimsArray as VerifiedClaimEntry[] | undefined,
        overallAssessment,
        promptNotes
      }
    : undefined;

  return {
    status: "success",
    ...(text ? { text } : {}),
    ...(structured ? { structured } : {})
  };
}

function createResearchGroupsStateFromRaw(raw: RawMockLibraryEntry): ResearchGroupsState {
  const text = typeof raw.researchGroups?.text === "string" ? raw.researchGroups.text : "";
  const structured = Array.isArray(raw.researchGroups?.structured?.papers)
    ? (raw.researchGroups.structured.papers as ResearchGroupPaperEntry[])
    : undefined;
  return {
    status: "success",
    text,
    structured
  };
}

function createResearchContactsStateFromRaw(): ResearchGroupContactsState {
  return {
    status: "success",
    contacts: []
  };
}

function createResearchThesesStateFromRaw(raw: RawMockLibraryEntry): ResearcherThesesState {
  const text = typeof raw.researcherTheses?.text === "string" ? raw.researcherTheses.text : undefined;
  const researchers = Array.isArray(raw.researcherTheses?.structured?.researchers)
    ? (raw.researcherTheses.structured.researchers as ResearcherThesisRecord[])
    : [];
  const deepDives = Array.isArray(raw.researcherTheses?.deepDives?.entries)
    ? (raw.researcherTheses.deepDives.entries as ResearcherThesisDeepDive[])
    : undefined;

  return {
    status: "success",
    researchers,
    ...(text ? { text } : {}),
    ...(deepDives ? { deepDives } : {})
  };
}

const MOCK_RESEARCH_THESES_TEXT =
  typeof (DEFAULT_ENTRY_RAW?.researcherTheses as any)?.text === "string"
    ? (DEFAULT_ENTRY_RAW.researcherTheses as any).text
    : "";

const MOCK_RESEARCH_THESES_STRUCTURED: ResearcherThesisRecord[] = Array.isArray(
  (DEFAULT_ENTRY_RAW?.researcherTheses as any)?.structured?.researchers
)
  ? ((DEFAULT_ENTRY_RAW.researcherTheses as any).structured
      .researchers as ResearcherThesisRecord[])
  : [];

const MOCK_RESEARCH_THESES_DEEP_DIVES: ResearcherThesisDeepDive[] = Array.isArray(
  (DEFAULT_ENTRY_RAW?.researcherTheses as any)?.deepDives?.entries
)
  ? ((DEFAULT_ENTRY_RAW.researcherTheses as any).deepDives.entries as ResearcherThesisDeepDive[])
  : [];

const MOCK_RESEARCH_THESES_INITIAL_STATE: ResearcherThesesState =
  MOCK_RESEARCH_THESES_STRUCTURED.length > 0
    ? {
        status: "success",
        researchers: MOCK_RESEARCH_THESES_STRUCTURED,
        text: MOCK_RESEARCH_THESES_TEXT,
        deepDives: MOCK_RESEARCH_THESES_DEEP_DIVES
      }
    : {
        status: "success",
        researchers: [],
        text: MOCK_RESEARCH_THESES_TEXT,
        deepDives: MOCK_RESEARCH_THESES_DEEP_DIVES
      };

const MOCK_CLAIMS_ANALYSIS =
  typeof DEFAULT_ENTRY_RAW?.claimsAnalysis === "object"
    ? (DEFAULT_ENTRY_RAW.claimsAnalysis as any)
    : null;

const MOCK_CLAIMS_TEXT =
  typeof MOCK_CLAIMS_ANALYSIS?.text === "string" ? MOCK_CLAIMS_ANALYSIS.text : "";

const MOCK_CLAIMS_STRUCTURED: ClaimsAnalysisStructured | undefined =
  MOCK_CLAIMS_ANALYSIS &&
  typeof MOCK_CLAIMS_ANALYSIS.structured === "object" &&
  MOCK_CLAIMS_ANALYSIS.structured
    ? (MOCK_CLAIMS_ANALYSIS.structured as ClaimsAnalysisStructured)
    : undefined;

const MOCK_CLAIMS_INITIAL_STATE: ClaimsAnalysisState =
  MOCK_CLAIMS_TEXT || (MOCK_CLAIMS_STRUCTURED && Object.keys(MOCK_CLAIMS_STRUCTURED).length > 0)
    ? {
        status: "success",
        text: MOCK_CLAIMS_TEXT,
        structured: MOCK_CLAIMS_STRUCTURED
      }
    : {
        status: "success"
      };

const MOCK_PATENTS =
  typeof DEFAULT_ENTRY_RAW?.patents === "object"
    ? (DEFAULT_ENTRY_RAW.patents as any)
    : null;

const MOCK_PATENTS_TEXT = typeof MOCK_PATENTS?.text === "string" ? MOCK_PATENTS.text : "";
const MOCK_PATENTS_STRUCTURED = normalizePatentsStructured(MOCK_PATENTS?.structured);
const MOCK_PATENTS_LIST = MOCK_PATENTS_STRUCTURED?.patents ?? [];

const MOCK_PATENTS_INITIAL_STATE: PatentsState =
  MOCK_PATENTS_LIST.length > 0 || MOCK_PATENTS_TEXT
    ? {
        status: "success",
        ...(MOCK_PATENTS_TEXT ? { text: MOCK_PATENTS_TEXT } : {}),
        ...(MOCK_PATENTS_STRUCTURED ? { structured: MOCK_PATENTS_STRUCTURED } : {})
      }
    : { status: "success" };

const MOCK_VERIFIED_CLAIMS =
  typeof DEFAULT_ENTRY_RAW?.verifiedClaims === "object"
    ? (DEFAULT_ENTRY_RAW.verifiedClaims as any)
    : null;

const MOCK_VERIFIED_CLAIMS_LIST = Array.isArray(MOCK_VERIFIED_CLAIMS?.structured?.claims)
  ? MOCK_VERIFIED_CLAIMS.structured.claims
  : [];

const MOCK_VERIFIED_CLAIMS_OVERALL = typeof MOCK_VERIFIED_CLAIMS?.structured?.overallAssessment === "string"
  ? MOCK_VERIFIED_CLAIMS.structured.overallAssessment
  : "";

const MOCK_VERIFIED_CLAIMS_PROMPT_NOTES =
  typeof MOCK_VERIFIED_CLAIMS?.structured?.promptNotes === "string"
    ? MOCK_VERIFIED_CLAIMS.structured.promptNotes
    : null;

const MOCK_VERIFIED_CLAIMS_TEXT = typeof MOCK_VERIFIED_CLAIMS?.text === "string" ? MOCK_VERIFIED_CLAIMS.text : "";

const MOCK_VERIFIED_CLAIMS_STRUCTURED_DATA: VerifiedClaimsStructured | undefined =
  MOCK_VERIFIED_CLAIMS_LIST.length > 0
    ? {
        claims: MOCK_VERIFIED_CLAIMS_LIST as unknown as VerifiedClaimEntry[],
        ...(MOCK_VERIFIED_CLAIMS_OVERALL ? { overallAssessment: MOCK_VERIFIED_CLAIMS_OVERALL } : {}),
        ...(MOCK_VERIFIED_CLAIMS_PROMPT_NOTES ? { promptNotes: MOCK_VERIFIED_CLAIMS_PROMPT_NOTES } : {})
      }
    : undefined;

const MOCK_VERIFIED_CLAIMS_INITIAL_STATE: VerifiedClaimsState =
  MOCK_VERIFIED_CLAIMS_TEXT || MOCK_VERIFIED_CLAIMS_STRUCTURED_DATA
    ? {
        status: "success",
        ...(MOCK_VERIFIED_CLAIMS_TEXT ? { text: MOCK_VERIFIED_CLAIMS_TEXT } : {}),
        ...(MOCK_VERIFIED_CLAIMS_STRUCTURED_DATA ? { structured: MOCK_VERIFIED_CLAIMS_STRUCTURED_DATA } : {})
      }
    : { status: "success" };

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

function PipelineStageTracker({
  stages,
  activeStageId,
  countdown,
  onStageSelect,
  isStageInteractive
}: {
  stages: PipelineStageView[];
  activeStageId: PipelineStageId | null;
  countdown?: string;
  onStageSelect?: (stageId: PipelineStageId) => void;
  isStageInteractive?: (stageId: PipelineStageId) => boolean;
}) {
  if (!stages || stages.length === 0) {
    return null;
  }

  const truncate = (value: string, limit = 80) => {
    if (value.length <= limit) {
      return value;
    }
    return `${value.slice(0, limit - 1)}…`;
  };

  return (
    <div className="w-full border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="flex w-full flex-col gap-3 px-4 py-3 sm:px-6 md:px-10">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
            Processing Pipeline
          </span>
          {activeStageId && (
            <span className="text-xs text-slate-500">
              Active: {PIPELINE_STAGE_METADATA[activeStageId].label}
            </span>
          )}
        </div>
        <div className="overflow-x-auto pb-1">
          <div className="grid min-w-full grid-cols-1 gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
            {stages.map((stage) => {
              const isActive = stage.id === activeStageId;
              const baseClasses =
                "flex min-w-0 flex-col gap-2 rounded-xl border px-3 py-3 text-left transition";
              const statusClass =
                stage.status === "success"
                  ? "border-emerald-200 bg-emerald-50/70"
                  : stage.status === "loading"
                    ? "border-sky-200 bg-sky-50/70"
                    : stage.status === "error"
                      ? "border-red-200 bg-red-50/70"
                      : "border-slate-200 bg-white";
              const activeClass = isActive ? "shadow-sm" : "shadow-none";

              let description: string;
              if (stage.status === "loading") {
                description = isActive && countdown ? `${countdown} remaining` : "Running…";
              } else if (stage.status === "success") {
                description = "Complete";
              } else if (stage.status === "error") {
                description = stage.errorMessage ? truncate(stage.errorMessage) : "Needs attention";
              } else {
                description = stage.helper;
              }

              let icon: ReactNode;
              if (stage.status === "loading") {
                icon = (
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-sky-200 bg-white">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-sky-400 border-t-transparent" />
                  </span>
                );
              } else if (stage.status === "success") {
                icon = (
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-emerald-200 bg-white text-emerald-600">
                    ✓
                  </span>
                );
              } else if (stage.status === "error") {
                icon = (
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-red-200 bg-white text-red-600">
                    !
                  </span>
                );
              } else {
                icon = (
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-xs font-semibold text-slate-500">
                    {stage.index + 1}
                  </span>
                );
              }

              const descriptionClass =
                stage.status === "error"
                  ? "text-xs leading-snug text-red-700"
                  : stage.status === "loading"
                    ? "text-xs leading-snug text-sky-700"
                    : stage.status === "success"
                      ? "text-xs leading-snug text-emerald-700"
                      : "text-xs leading-snug text-slate-500";

              const selectable = isStageInteractive?.(stage.id) ?? Boolean(onStageSelect);

              const content = (
                <>
                  <div className="flex items-center gap-3">
                    {icon}
                    <div className="flex flex-col">
                      <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                        Step {stage.index + 1}
                      </span>
                      <span className="text-sm font-medium text-slate-800">{stage.label}</span>
                    </div>
                  </div>
                  <div className={descriptionClass}>{description}</div>
                </>
              );

              if (selectable) {
                return (
                  <button
                    key={stage.id}
                    type="button"
                    onClick={() => onStageSelect?.(stage.id)}
                    className={`${baseClasses} ${statusClass} ${activeClass} cursor-pointer text-left shadow-sm transition-transform hover:-translate-y-0.5 hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40`}
                  >
                    {content}
                  </button>
                );
              }

              return (
                <div key={stage.id} className={`${baseClasses} ${statusClass} ${activeClass}`}>
                  {content}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function PipelineStagePlaceholder({
  stageId,
  waitingForStageId,
  countdown
}: {
  stageId: PipelineStageId;
  waitingForStageId?: PipelineStageId | null;
  countdown?: string;
}) {
  const stageMeta = PIPELINE_STAGE_METADATA[stageId];
  const waitingMeta = waitingForStageId ? PIPELINE_STAGE_METADATA[waitingForStageId] : null;
  const emoji = PIPELINE_STAGE_EMOJI[waitingForStageId ?? stageId];

  const headline = waitingMeta
    ? `Up next: ${stageMeta.label}`
    : `${stageMeta.label} in progress`;

  const supportingText = waitingMeta
    ? `We’ll kick this off right after ${waitingMeta.label.toLowerCase()} finishes up.`
    : countdown
      ? `${stageMeta.helper}. ${countdown} to go.`
      : `${stageMeta.helper}. Hang tight!`;

  return (
    <div className="flex flex-1 items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white/90 p-6 text-center shadow-sm">
        <div className="mb-3 text-3xl" aria-hidden>{emoji}</div>
        <p className="text-base font-semibold text-slate-900">{headline}</p>
        <p className="mt-2 text-sm text-slate-600">{supportingText}</p>
      </div>
    </div>
  );
}

function ExtractionDebugPanel({
  state,
  paper,
  countdown,
  currentLoadingStep
}: {
  state: ExtractionState | undefined;
  paper: UploadedPaper | null;
  countdown?: string;
  currentLoadingStep?: string | null;
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
          {countdown && <p className="text-xs text-slate-500">{countdown} remaining</p>}
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

function hasStructuredClaimsContent(structured?: ClaimsAnalysisStructured): boolean {
  if (!structured) {
    return false;
  }

  if (Array.isArray(structured.executiveSummary) && structured.executiveSummary.some((item) => typeof item === "string" && item.trim().length > 0)) {
    return true;
  }

  if (Array.isArray(structured.claims) && structured.claims.length > 0) {
    return true;
  }

  if (Array.isArray(structured.gaps) && structured.gaps.length > 0) {
    return true;
  }

  if (Array.isArray(structured.methodsSnapshot) && structured.methodsSnapshot.length > 0) {
    return true;
  }

  if (Array.isArray(structured.riskChecklist) && structured.riskChecklist.length > 0) {
    return true;
  }

  if (Array.isArray(structured.openQuestions) && structured.openQuestions.length > 0) {
    return true;
  }

  if (Array.isArray(structured.crossPaperComparison) && structured.crossPaperComparison.length > 0) {
    return true;
  }

  return false;
}

function ClaimsStructuredView({
  structured,
  text
}: {
  structured?: ClaimsAnalysisStructured;
  text?: string;
}) {
  const hasStructured = hasStructuredClaimsContent(structured);

  if (!hasStructured && (!text || text.trim().length === 0)) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-slate-600">Paste the cleaned JSON from the claims script to populate this mock view.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {hasStructured && (
        <>
          {Array.isArray(structured?.executiveSummary) && structured?.executiveSummary?.length ? (
            <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Executive Summary</h3>
              <ul className="mt-3 space-y-2 pl-4 text-sm leading-relaxed text-slate-700 list-disc marker:text-slate-400">
                {structured.executiveSummary.map((item, index) => (
                  <li key={`summary-${index}`}>{item}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {Array.isArray(structured?.claims) && structured.claims.length > 0 ? (
            <section className="space-y-4">
              <header>
                <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Key Claims &amp; Evidence</h3>
              </header>
              <div className="space-y-4">
                {structured.claims.map((claim) => (
                  <article key={claim.id ?? claim.claim} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                          {claim.id?.replace(/^C(\d+)$/, 'Claim $1') ?? "Claim"}
                        </p>
                        <h4 className="mt-1 text-base font-semibold text-slate-900">{claim.claim}</h4>
                      </div>
                    </div>
                    {typeof claim.evidenceSummary === "string" && claim.evidenceSummary.trim().length > 0 && (
                      <p className="mt-3 text-sm leading-relaxed text-slate-700">{claim.evidenceSummary}</p>
                    )}
                    <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                      {Array.isArray(claim.keyNumbers) && claim.keyNumbers.length > 0 && (
                        <div>
                          <dt className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Key numbers</dt>
                          <dd className="mt-1 space-y-1 text-sm text-slate-700">
                            {claim.keyNumbers.map((entry, index) => (
                              <p key={`numbers-${claim.id}-${index}`}>{entry}</p>
                            ))}
                          </dd>
                        </div>
                      )}
                      {typeof claim.source === "string" && claim.source.trim().length > 0 && (
                        <div>
                          <dt className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Source</dt>
                          <dd className="mt-1 text-sm text-slate-700">{claim.source}</dd>
                        </div>
                      )}
                      {(typeof claim.evidenceType === "string" && claim.evidenceType.trim().length > 0) ||
                      (typeof claim.strength === "string" && claim.strength.trim().length > 0 && claim.strength.trim().toLowerCase() !== "unclear") ? (
                        <div>
                          <dt className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Evidence type</dt>
                          <dd className="mt-1 text-sm text-slate-700">
                            {typeof claim.evidenceType === "string" && claim.evidenceType.trim().length > 0 ? claim.evidenceType : "Not specified"}
                            {typeof claim.strength === "string" && claim.strength.trim().length > 0 && claim.strength.trim().toLowerCase() !== "unclear"
                              ? ` (${claim.strength.trim()} evidence)`
                              : ""}
                          </dd>
                        </div>
                      ) : null}
                      {typeof claim.assumptions === "string" && claim.assumptions.trim().length > 0 && (
                        <div className="sm:col-span-2">
                          <dt className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Assumptions</dt>
                          <dd className="mt-1 text-sm text-slate-700">{claim.assumptions}</dd>
                        </div>
                      )}
                    </dl>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          {Array.isArray(structured?.gaps) && structured.gaps.length > 0 ? (
            <section className="rounded-lg border border-amber-100 bg-amber-50/60 p-6">
              <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">Gaps &amp; Limitations</h3>
              <div className="mt-3 space-y-3">
                {structured.gaps.map((gap, index) => (
                  <div key={`gap-${index}`} className="rounded-md border border-amber-200 bg-white/80 p-4">
                    <p className="text-sm font-semibold text-amber-900">{gap.category}</p>
                    <p className="mt-1 text-sm text-amber-800">{gap.detail}</p>
                    {Array.isArray(gap.relatedClaimIds) && gap.relatedClaimIds.length > 0 && (
                      <p className="mt-2 text-xs uppercase tracking-[0.2em] text-amber-600">
                        Related: {gap.relatedClaimIds.map(id => id.replace(/^C(\d+)$/, 'Claim $1')).join(", ")}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {Array.isArray(structured?.methodsSnapshot) && structured.methodsSnapshot.length > 0 ? (
            <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Methods Snapshot</h3>
              <ul className="mt-3 space-y-2 pl-4 text-sm leading-relaxed text-slate-700 list-disc marker:text-slate-400">
                {structured.methodsSnapshot.map((item, index) => (
                  <li key={`methods-${index}`}>{item}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {Array.isArray(structured?.riskChecklist) && structured.riskChecklist.length > 0 ? (
            <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Risk of Bias</h3>
              <ul className="mt-3 space-y-2">
                {structured.riskChecklist.map((entry, index) => (
                  <li key={`risk-${index}`} className="flex items-start justify-between gap-4 rounded-md border border-slate-100 bg-slate-50/80 px-4 py-3">
                    <div>
                      <p className="text-sm font-medium text-slate-900">{entry.item}</p>
                      {entry.note && entry.note.trim().length > 0 && (
                        <p className="mt-1 text-xs text-slate-600">{entry.note}</p>
                      )}
                    </div>
                    <span className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">{entry.status}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {Array.isArray(structured?.openQuestions) && structured.openQuestions.length > 0 ? (
            <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Open Questions &amp; Next Steps</h3>
              <ul className="mt-3 space-y-2 pl-4 text-sm leading-relaxed text-slate-700 list-disc marker:text-slate-400">
                {structured.openQuestions.map((item, index) => (
                  <li key={`next-${index}`}>{item}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {Array.isArray(structured?.crossPaperComparison) && structured.crossPaperComparison.length > 0 ? (
            <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Cross-Paper Comparison</h3>
              <ul className="mt-3 space-y-2 pl-4 text-sm leading-relaxed text-slate-700 list-disc marker:text-slate-400">
                {structured.crossPaperComparison.map((item, index) => (
                  <li key={`cross-${index}`}>{item}</li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

function ClaimsPanel({
  paper,
  extraction,
  state,
  onRetry,
  countdown
}: {
  paper: UploadedPaper | null;
  extraction: ExtractionState | undefined;
  state: ClaimsAnalysisState | undefined;
  onRetry?: () => void;
  countdown?: string;
}) {

  if (!paper) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
        <p className="text-base font-medium text-slate-700">Upload a PDF to inspect its claims and evidence.</p>
        <p className="text-sm text-slate-500">We&apos;ll surface the structured claims summary once the analysis runs.</p>
      </div>
    );
  }

  if (!extraction || extraction.status === "loading") {
    return <PipelineStagePlaceholder stageId="claims" waitingForStageId="extraction" />;
  }

  if (extraction.status === "error") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <div className="rounded-full bg-red-50 p-3 text-red-600">⚠️</div>
        <div className="space-y-1">
          <p className="text-base font-semibold text-red-700">Extraction required</p>
          <p className="text-sm text-red-600">
            {extraction.message || "We couldn’t extract text from this PDF, so claims can’t run yet."}
          </p>
          {extraction.hint && <p className="text-xs text-red-500">{extraction.hint}</p>}
        </div>
      </div>
    );
  }

  if (!state || state.status === "loading") {
    return <PipelineStagePlaceholder stageId="claims" countdown={countdown} />;
  }

  if (state.status === "error") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <div className="rounded-full bg-red-50 p-3 text-red-600">⚠️</div>
        <div className="space-y-1">
          <p className="text-base font-semibold text-red-700">Claims analysis failed</p>
          <p className="text-sm text-red-600">{state.message}</p>
        </div>
      </div>
    );
  }

  const isMock = isMockPaper(paper);
  const hasStructured = hasStructuredClaimsContent(state.structured);
  const hasText = typeof state.text === "string" && state.text.trim().length > 0;

  if (!isMock && (!hasStructured && !hasText)) {
    if (!extraction || extraction.status !== "success") {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <p className="text-base font-medium text-slate-700">Run extraction before claims review</p>
          <p className="text-sm text-slate-500">Upload a paper and wait for the PDF extraction to complete so claims can be assessed.</p>
        </div>
      );
    }

    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <p className="text-base font-medium text-slate-700">Claims agent not yet wired</p>
        <p className="text-sm text-slate-500">
          We’ll hook this flow into the LLM after the prototype. For now, use the claims script to populate mock data.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="w-full space-y-6 px-6 py-8">
        <header className="flex items-center justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold text-slate-900">Claims Analysis</h2>
            <p className="text-sm text-slate-600">Key claims, evidence, and assertions from the paper</p>
          </div>
          {onRetry && (
            <button
              onClick={onRetry}
              className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
              title="Re-run claims analysis"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          )}
        </header>
        <ClaimsStructuredView structured={state.structured} text={state.text} />
      </div>
    </div>
  );
}

function SimilarPapersStructuredView({ structured }: { structured: SimilarPapersStructured }) {
  const methodRows = [
    { label: "Sample / model", key: "sampleModel" },
    { label: "Materials", key: "materialsSetup" },
    { label: "Equipment", key: "equipmentSetup" },
    { label: "Procedure", key: "procedureSteps" },
    { label: "Controls", key: "controls" },
    { label: "Outputs / metrics", key: "outputsMetrics" },
    { label: "Quality checks", key: "qualityChecks" },
    { label: "Outcome summary", key: "outcomeSummary" }
  ] as const;

  const similarPapers = Array.isArray(structured.similarPapers) ? structured.similarPapers : [];

  if (similarPapers.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-slate-600">No similar papers found in the structured response.</p>
      </div>
    );
  }

  const getMatrixValue = (paper: typeof similarPapers[number], key: string) => {
    const value = paper?.methodMatrix?.[key];
    if (!value || !value.trim()) {
      return "Not reported";
    }
    return value;
  };

  return (
    <div className="space-y-8">
      {structured.sourcePaper?.summary && (
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-700">Source Paper Summary</h3>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">{structured.sourcePaper.summary}</p>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full border-collapse text-sm">
          <thead>
            <tr className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <th className="sticky left-0 z-10 bg-slate-50 px-4 py-3 text-slate-500">Method dimension</th>
              {similarPapers.map((paper, index) => (
                <th key={paper.identifier ?? index} className="px-4 py-3 text-slate-600">
                  <div className="space-y-0.5">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                      Paper #{index + 1}
                    </p>
                    <p className="text-sm font-semibold text-slate-900 leading-snug">
                      {paper.title ?? "Untitled"}
                    </p>
                    <p className="text-xs text-slate-500">
                      {[paper.year, paper.venue].filter(Boolean).join(" · ") || "Metadata pending"}
                    </p>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {methodRows.map((row) => (
              <tr key={row.key} className="border-t border-slate-100 align-top">
                <th className="sticky left-0 z-10 bg-white px-4 py-4 text-left text-sm font-medium text-slate-700">
                  {row.label}
                </th>
                {similarPapers.map((paper, index) => (
                  <td key={`${paper.identifier ?? index}-${row.key}`} className="px-4 py-4 text-sm leading-relaxed text-slate-700">
                    {getMatrixValue(paper, row.key)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-6">
        {similarPapers.map((paper, index) => (
          <div key={paper.identifier ?? index} className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <div className="space-y-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                  Paper #{index + 1}
                </p>
                <h4 className="mt-1 text-base font-semibold text-slate-900">{paper.title}</h4>
                {paper.authors && paper.authors.length > 0 && (
                  <p className="mt-1 text-sm text-slate-600">{paper.authors.join(", ")}</p>
                )}
                {(paper.doi || paper.url) && (
                  <p className="mt-1 text-xs text-slate-500">
                    {paper.doi ? `DOI: ${paper.doi}` : paper.url}
                  </p>
                )}
              </div>

              {paper.whyRelevant && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Why relevant</p>
                  <p className="mt-1 text-sm leading-relaxed text-slate-700">{paper.whyRelevant}</p>
                </div>
              )}

              {paper.overlapHighlights && paper.overlapHighlights.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Overlap highlights</p>
                  <ul className="mt-2 space-y-1 pl-4 text-sm text-slate-700 list-disc marker:text-slate-400">
                    {paper.overlapHighlights.map((highlight, idx) => (
                      <li key={idx}>{highlight}</li>
                    ))}
                  </ul>
                </div>
              )}

              {paper.gapsOrUncertainties && (
                <div className="rounded-md border border-amber-200 bg-amber-50/60 p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">Gaps or uncertainties</p>
                  <p className="mt-1 text-sm text-amber-800">{paper.gapsOrUncertainties}</p>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SimilarPapersPanel({
  paper,
  extraction,
  state,
  claimsState,
  onRetry,
  countdown
}: {
  paper: UploadedPaper | null;
  extraction: ExtractionState | undefined;
  state: SimilarPapersState | undefined;
  claimsState: ClaimsAnalysisState | undefined;
  onRetry: () => void;
  countdown?: string;
}) {

  if (!paper) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
        <p className="text-base font-medium text-slate-700">Upload a PDF to find related methods.</p>
        <p className="text-sm text-slate-500">We&apos;ll compare the paper against recent work once it&apos;s processed.</p>
      </div>
    );
  }

  if (!extraction || extraction.status === "loading") {
    if (isMockPaper(paper)) {
      return (
        <div className="flex-1 overflow-auto">
          <MockSimilarPapersShowcase paperId={paper.id} />
        </div>
      );
    }
    return <PipelineStagePlaceholder stageId="similarPapers" waitingForStageId="extraction" />;
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

  const claimsStatus = claimsState?.status;

  if (!claimsState || claimsStatus === "loading") {
    if (isMockPaper(paper) && (!state || state.status === "loading")) {
      return (
        <div className="flex-1 overflow-auto">
          <MockSimilarPapersShowcase paperId={paper.id} />
        </div>
      );
    }
    return <PipelineStagePlaceholder stageId="similarPapers" waitingForStageId="claims" />;
  }

  if (claimsStatus === "error") {
    const claimsMessage =
      claimsState && "message" in claimsState && typeof claimsState.message === "string"
        ? claimsState.message
        : "Claims analysis failed, so we can't compute similar papers yet.";

    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <div className="rounded-full bg-red-50 p-3 text-red-600">⚠️</div>
        <div className="space-y-1">
          <p className="text-base font-semibold text-red-700">Claims analysis required</p>
          <p className="text-sm text-red-600">{claimsMessage}</p>
        </div>
        <p className="max-w-sm text-xs text-slate-500">
          Re-run the claims tab or retry the upload to unblock the similar papers step.
        </p>
      </div>
    );
  }

  if (!state || state.status === "loading") {
    if (isMockPaper(paper)) {
      return (
        <div className="flex-1 overflow-auto">
          <MockSimilarPapersShowcase paperId={paper.id} />
        </div>
      );
    }
    return <PipelineStagePlaceholder stageId="similarPapers" countdown={countdown} />;
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
      <div className="w-full space-y-6 px-6 py-8">
        <header className="flex items-start justify-between gap-3">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Similarity scan</p>
            <h3 className="text-xl font-semibold text-slate-900">Cross-paper alignment</h3>
            <p className="text-sm text-slate-600">Compiled for {paper?.name ?? "the selected paper"}.</p>
          </div>
          <button
            onClick={onRetry}
            className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            title="Re-run similar papers search"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </header>
        {state.structured && state.structured.similarPapers && state.structured.similarPapers.length > 0 ? (
          <SimilarPapersStructuredView structured={state.structured} />
        ) : (
          <article className="space-y-4">
            {renderPlaintextSections(state.text)}
          </article>
        )}
      </div>
    </div>
  );
}

function ResearchGroupsPanel({
  paper,
  extraction,
  state,
  contacts,
  claimsState,
  similarState,
  countdown,
  onRetry
}: {
  paper: UploadedPaper | null;
  extraction: ExtractionState | undefined;
  state: ResearchGroupsState | undefined;
  contacts: ResearchGroupContactsState | undefined;
  claimsState: ClaimsAnalysisState | undefined;
  similarState: SimilarPapersState | undefined;
  countdown?: string;
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
    return <PipelineStagePlaceholder stageId="researchGroups" waitingForStageId="extraction" />;
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

  if (!claimsState || claimsState.status === "loading") {
    return <PipelineStagePlaceholder stageId="researchGroups" waitingForStageId="claims" />;
  }

  if (claimsState.status === "error") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <div className="rounded-full bg-red-50 p-3 text-red-600">⚠️</div>
        <div className="space-y-1">
          <p className="text-base font-semibold text-red-700">Claims analysis required</p>
          <p className="text-sm text-red-600">
            {"message" in claimsState && typeof claimsState.message === "string"
              ? claimsState.message
              : "Finish the claims tab before we scout research groups."}
          </p>
        </div>
      </div>
    );
  }

  if (!similarState || similarState.status === "loading") {
    return <PipelineStagePlaceholder stageId="researchGroups" waitingForStageId="similarPapers" />;
  }

  if (similarState.status === "error") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <div className="rounded-full bg-red-50 p-3 text-red-600">⚠️</div>
        <div className="space-y-1">
          <p className="text-base font-semibold text-red-700">Similar papers required</p>
          <p className="text-sm text-red-600">Resolve the similar papers tab so we know what to look for.</p>
        </div>
      </div>
    );
  }

  if (!state || state.status === "loading") {
    return <PipelineStagePlaceholder stageId="researchGroups" countdown={countdown} />;
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

  function renderGroupContacts(group: ResearchGroupEntry) {
    const researchers = Array.isArray(group.researchers) ? group.researchers : [];

    if (researchers.length === 0) {
      return <p className="text-sm text-slate-500">No named contacts listed.</p>;
    }

    return (
      <ul className="space-y-2">
        {researchers.map((person, personIndex) => {
          const key = `${group.name}-${person.name ?? person.email ?? personIndex}`;
          const roleBadge = person.role
            ? (
                <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  {person.role}
                </span>
              )
            : null;

          return (
            <li
              key={key}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2 text-sm text-slate-700"
            >
              <span className="font-semibold text-slate-900">{person.name || "Unnamed contact"}</span>
              {roleBadge}
              {person.email ? (
                <a
                  href={`mailto:${person.email}`}
                  className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                >
                  {person.email}
                </a>
              ) : (
                <span className="text-xs text-slate-500">Email not provided</span>
              )}
            </li>
          );
        })}
      </ul>
    );
  }

  const structuredEntries = Array.isArray(state.structured) ? state.structured : [];
  const totalGroups = structuredEntries.reduce((count, entry) => count + entry.groups.length, 0);
  const uniqueContacts = structuredEntries.reduce((set, entry) => {
    entry.groups.forEach((group) => {
      const researchers = Array.isArray(group.researchers) ? group.researchers : [];
      researchers.forEach((person) => {
        const key = `${person.email ?? ""}-${person.name ?? ""}`;
        set.add(key);
      });
    });
    return set;
  }, new Set<string>()).size;

  return (
    <div className="flex-1 overflow-auto">
      <div className="w-full space-y-8 px-6 py-8">
        <section className="space-y-6">
          <header className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-2">
                <h2 className="text-xl font-semibold text-slate-900">Research Groups</h2>
                <p className="text-sm text-slate-600">Compiled for {paper?.name ?? "the selected paper"}.</p>
              </div>
              <button
                onClick={onRetry}
                className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                title="Re-run research groups search"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            </div>
            {structuredEntries.length > 0 && (
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Matched papers</p>
                  <p className="mt-1 text-2xl font-semibold text-slate-900">{structuredEntries.length}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Active groups</p>
                  <p className="mt-1 text-2xl font-semibold text-slate-900">{totalGroups}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Named contacts</p>
                  <p className="mt-1 text-2xl font-semibold text-slate-900">{uniqueContacts}</p>
                </div>
              </div>
            )}
          </header>

          {structuredEntries.length > 0 ? (
            <div className="space-y-5">
              {structuredEntries.map((paperEntry, paperIndex) => (
                <article
                  key={`${paperEntry.title}-${paperIndex}`}
                  className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="space-y-1">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                        Paper {paperIndex + 1}
                      </p>
                      <h3 className="text-lg font-semibold text-slate-900">{paperEntry.title}</h3>
                      <p className="text-xs text-slate-500">
                        {paperEntry.identifier ? paperEntry.identifier : "Identifier not provided"}
                      </p>
                    </div>
                  </div>

                  {paperEntry.groups.length > 0 ? (
                    <div className="mt-5 space-y-5">
                      {paperEntry.groups.map((group, groupIndex) => (
                        <div
                          key={`${paperEntry.title}-${group.name}-${groupIndex}`}
                          className="rounded-xl border border-slate-200 bg-slate-50/80 p-4"
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
                            <p className="mt-3 text-sm leading-relaxed text-slate-700">{group.notes}</p>
                          )}

                          <div className="mt-4 space-y-2">
                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                              Contacts
                            </p>
                          {renderGroupContacts(group)}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-slate-600">No groups reported for this paper.</p>
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
  structuredGroups,
  deepDives,
  countdown,
  onRetry
}: {
  state: ResearcherThesesState | undefined;
  hasResearchGroups: boolean;
  isMock: boolean;
  structuredGroups?: ResearchGroupPaperEntry[];
  deepDives?: ResearcherThesisDeepDive[];
  countdown?: string;
  onRetry?: () => void;
}) {
  const hasLoadedResearchers =
    state?.status === "success" &&
    (state.researchers.length > 0 || (state.deepDives && state.deepDives.length > 0));
  if (isMock && !hasLoadedResearchers) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <p className="text-base font-medium text-slate-700">Coming soon</p>
        <p className="text-sm text-slate-500">Researcher theses will appear here after we wire the new crosswalk prompts.</p>
      </div>
    );
  }

  if (!hasResearchGroups) {
    return <PipelineStagePlaceholder stageId="theses" waitingForStageId="researchGroups" />;
  }

  if (!state || state.status === "loading") {
    return <PipelineStagePlaceholder stageId="theses" countdown={countdown} />;
  }

  if (state.status === "error") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <div className="rounded-full bg-red-50 p-3 text-red-600">⚠️</div>
        <div className="space-y-1">
          <p className="text-base font-semibold text-red-700">Researcher lookup failed</p>
          <p className="text-sm text-red-600">{state.message}</p>
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
          >
            Try again
          </button>
        )}
      </div>
    );
  }

  const researchers = state.researchers;
  const deepDiveEntries =
    Array.isArray(deepDives) && deepDives.length > 0
      ? deepDives
      : state?.status === "success" && Array.isArray(state.deepDives)
        ? state.deepDives ?? []
        : [];

  const normaliseTimestamp = (value: string | null | undefined) => {
    if (!value) {
      return 0;
    }
    const parsed = new Date(value);
    const time = parsed.getTime();
    return Number.isNaN(time) ? 0 : time;
  };

  const orderedDeepDives = [...deepDiveEntries].sort((a, b) => normaliseTimestamp(b.generatedAt) - normaliseTimestamp(a.generatedAt));

  if (researchers.length === 0) {
    return (
      <div className="flex-1 overflow-auto">
        <section className="space-y-6 px-6 py-6">
          <header className="flex items-center justify-between gap-3">
            <div className="space-y-1">
              <h2 className="text-xl font-semibold text-slate-900">Researcher Theses</h2>
              <p className="text-sm text-slate-600">PhD theses and publications from research group members</p>
            </div>
            {onRetry && (
              <button
                onClick={onRetry}
                className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                title="Re-run researcher theses search"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            )}
          </header>
          <div className="flex flex-col items-center justify-center gap-2 text-center py-12">
            <p className="text-sm text-slate-600">No researcher publications or theses were found in the current summaries.</p>
          </div>
        </section>
      </div>
    );
  }

  function dataAvailabilityBadge(value: ResearcherThesisRecord["data_publicly_available"]) {
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
  }

  function renderPublication(entry: ResearcherThesisRecord["latest_publication"] | null | undefined) {
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
  }

  function renderThesis(entry: ResearcherThesisRecord["phd_thesis"] | null | undefined) {
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
  }

  function renderResearcherCard(record: ResearcherThesisRecord, label: string) {
    return (
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
          {dataAvailabilityBadge(record.data_publicly_available ?? "unknown")}
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
  }

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
        <section className="space-y-6 px-6 py-6">
          <header className="flex items-center justify-between gap-3 mb-6">
            <div className="space-y-1">
              <h2 className="text-xl font-semibold text-slate-900">Researcher Theses</h2>
              <p className="text-sm text-slate-600">PhD theses and publications from research group members</p>
            </div>
            {onRetry && (
              <button
                onClick={onRetry}
                className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                title="Re-run researcher theses search"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            )}
          </header>
          {flatList}
          {orderedDeepDives.length > 0 && (
            <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <header className="space-y-1 border-b border-slate-100 pb-3">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                  Deep-dive datasets
                </div>
                <p className="text-sm text-slate-600">
                  Focused thesis passes are available for this paper. Assign groups to surface them inline.
                </p>
              </header>
              <div className="space-y-4">
                {renderStandaloneDeepDives(orderedDeepDives)}
              </div>
            </div>
          )}
        </section>
      </div>
    );
  }

  const normaliseKey = (value: string | null | undefined) =>
    value ? value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() : "";

  const normaliseGroupKey = normaliseKey;

  const makePaperKey = (title: string | null | undefined, identifier: string | null | undefined) => {
    const titleKey = normaliseKey(title);
    const identifierKey = normaliseKey(identifier);
    return `${titleKey}::${identifierKey}`;
  };

  const deepDiveBuckets = new Map<string, ResearcherThesisDeepDive[]>();

  orderedDeepDives.forEach((entry) => {
    const groupKey = normaliseGroupKey(entry.group?.name ?? null);
    if (!groupKey) {
      return;
    }
    const paperKey = makePaperKey(entry.paper?.title ?? null, entry.paper?.identifier ?? null);
    const bucketKey = `${paperKey}::${groupKey}`;
    if (!deepDiveBuckets.has(bucketKey)) {
      deepDiveBuckets.set(bucketKey, []);
    }
    deepDiveBuckets.get(bucketKey)!.push(entry);
  });

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

  function renderThesisGroupResearchers(entries: ResearcherThesisRecord[]) {
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
  }

  function formatTimestamp(value: string | null | undefined) {
    if (!value) {
      return null;
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return value;
    }
    return parsed.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function dataAccessBadge(value: ResearcherThesisDeepDiveThesis["data_access"]) {
    const styles: Record<ResearcherThesisDeepDiveThesis["data_access"], string> = {
      public: "border-emerald-100 bg-emerald-50 text-emerald-700",
      restricted: "border-amber-100 bg-amber-50 text-amber-700",
      unknown: "border-slate-200 bg-slate-100 text-slate-600"
    };

    const labels: Record<ResearcherThesisDeepDiveThesis["data_access"], string> = {
      public: "Public dataset",
      restricted: "Restricted access",
      unknown: "Access unknown"
    };

    return (
      <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${styles[value]}`}>
        {labels[value]}
      </span>
    );
  }

  function renderDeepDiveTheses(theses: ResearcherThesisDeepDiveThesis[]) {
    if (!theses.length) {
      return <p className="text-sm text-slate-600">No theses confirmed in this pass.</p>;
    }

    return (
      <ol className="space-y-4">
        {theses.map((thesis, index) => {
          const title = thesis.thesis_title || "Thesis title unavailable";
          const subtitle = [thesis.author, thesis.year ? String(thesis.year) : null]
            .filter(Boolean)
            .join(" · ");

          return (
            <li
              key={`${title}-${thesis.author ?? "unknown"}-${index}`}
              className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4"
            >
              <div className="space-y-1">
                <p className="text-sm font-semibold text-slate-900">{title}</p>
                {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
                {(thesis.research_group || thesis.principal_investigator) && (
                  <p className="text-xs text-slate-500">
                    {[thesis.research_group, thesis.principal_investigator]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                )}
              </div>
              {thesis.data_synopsis && (
                <p className="text-sm leading-relaxed text-slate-700">{thesis.data_synopsis}</p>
              )}

              <div className="flex flex-wrap items-center gap-3 text-xs">
                {dataAccessBadge(thesis.data_access)}
                {thesis.thesis_url && (
                  <a
                    href={thesis.thesis_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    Thesis PDF
                  </a>
                )}
                {thesis.data_url && (
                  <a
                    href={thesis.data_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    Dataset link
                  </a>
                )}
              </div>

          {thesis.notes && (
            <p className="text-xs text-slate-500">Notes: {thesis.notes}</p>
          )}
        </li>
      );
    })}
  </ol>
    );
  }

  function renderDeepDiveExtras(entry: ResearcherThesisDeepDive) {
    const sources = entry.structured?.sources_checked ?? [];
    const followUp = entry.structured?.follow_up ?? [];
    const notes = entry.structured?.promptNotes;

    if (!sources.length && !followUp.length && !notes) {
      return null;
    }

    return (
      <div className="space-y-3 text-sm text-slate-600">
        {sources.length > 0 && (
          <div>
            <p className="font-medium text-slate-700">Sources checked</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">
              {sources.map((source, index) => (
                <li key={`${source}-${index}`}>{source}</li>
              ))}
            </ul>
          </div>
        )}
        {followUp.length > 0 && (
          <div>
            <p className="font-medium text-slate-700">Follow-up</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">
              {followUp.map((item, index) => (
                <li key={`${item}-${index}`}>{item}</li>
              ))}
            </ul>
          </div>
        )}
        {notes && (
          <div>
            <p className="font-medium text-slate-700">Prompt notes</p>
            <p className="mt-1 text-sm text-slate-600">{notes}</p>
          </div>
        )}
      </div>
    );
  }

  function renderStandaloneDeepDives(entries: ResearcherThesisDeepDive[]) {
    if (!entries.length) {
      return null;
    }

    return entries.map((entry, index) => (
      <article
        key={`${entry.group?.name ?? "deep-dive"}-${index}`}
        className="space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4"
      >
        <header className="flex flex-wrap items-center justify-between gap-2">
          <div className="space-y-1">
            <p className="text-sm font-semibold text-slate-900">
              {entry.group?.name ?? "Research group"}
            </p>
            {entry.group?.institution && <p className="text-xs text-slate-500">{entry.group.institution}</p>}
          </div>
          {formatTimestamp(entry.generatedAt) && (
            <p className="text-xs text-slate-500">Run {formatTimestamp(entry.generatedAt)}</p>
          )}
        </header>
        {renderDeepDiveTheses(entry.structured?.theses ?? [])}
        {renderDeepDiveExtras(entry)}
      </article>
    ));
  }

  function renderGroupDeepDives(entries: ResearcherThesisDeepDive[]) {
    if (!entries.length) {
      return null;
    }

    return (
      <div className="space-y-4 rounded-lg border border-emerald-100 bg-emerald-50/60 p-4">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-600">
            Deep-dive datasets
          </p>
          {formatTimestamp(entries[0]?.generatedAt) && (
            <p className="text-xs text-emerald-700">
              Last run {formatTimestamp(entries[0]?.generatedAt)}
            </p>
          )}
        </header>
        <div className="space-y-4">
          {entries.map((entry, index) => (
            <article key={`${entry.generatedAt ?? "entry"}-${index}`} className="space-y-4 rounded-lg border border-emerald-100 bg-white p-4 shadow-sm">
              {entries.length > 1 && (
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-500">
                  Pass {index + 1}
                </p>
              )}
              {renderDeepDiveTheses(entry.structured?.theses ?? [])}
              {renderDeepDiveExtras(entry)}
            </article>
          ))}
        </div>
      </div>
    );
  }
  const paperSections = structuredGroups.map((paper, paperIndex) => {
    const paperKey = makePaperKey(paper.title, paper.identifier);
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

            const deepDiveKey = `${paperKey}::${key}`;
            const groupDeepDiveEntries = key && deepDiveBuckets.has(deepDiveKey)
              ? deepDiveBuckets.get(deepDiveKey) ?? []
              : [];

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

                {renderThesisGroupResearchers(entries)}

                {renderGroupDeepDives(groupDeepDiveEntries)}
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
        <header className="flex items-center justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold text-slate-900">Researcher Theses</h2>
            <p className="text-sm text-slate-600">PhD theses and publications from research group members</p>
          </div>
          {onRetry && (
            <button
              onClick={onRetry}
              className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
              title="Re-run researcher theses search"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          )}
        </header>
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
                  {renderThesisGroupResearchers(bucket.entries)}
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

  function renderPatentCards(patents: PatentEntry[]) {
    return (
      <div className="space-y-4">
        {patents.map((patent, index) => {
          const key = patent.patentNumber || patent.title || `patent-${index}`;
          const claimIds = patent.overlapWithPaper?.claimIds ?? [];
          return (
            <article key={key} className="rounded-lg border border-slate-200 bg-white px-5 py-4 shadow-sm">
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      {patent.url ? (
                        <a
                          href={patent.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400 transition hover:text-primary"
                        >
                          {patent.patentNumber ?? "View patent"}
                        </a>
                      ) : (
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                          {patent.patentNumber ?? "Patent"}
                        </p>
                      )}
                      <h3 className="text-base font-semibold text-slate-900">{patent.title ?? "Untitled patent"}</h3>
                    </div>
                    {patent.url && (
                      <a
                        href={patent.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center rounded-full border border-primary px-3 py-1 text-xs font-semibold text-primary transition hover:bg-primary/5"
                      >
                        View patent
                      </a>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
                    {patent.assignee && <span className="font-medium">{patent.assignee}</span>}
                    {patent.filingDate && <span className="text-slate-400">•</span>}
                    {patent.filingDate && <span>Filed: {patent.filingDate}</span>}
                    {patent.grantDate && <span className="text-slate-400">•</span>}
                    {patent.grantDate && <span>Granted: {patent.grantDate}</span>}
                  </div>
                </div>

                {patent.abstract && <p className="text-sm leading-relaxed text-slate-700">{patent.abstract}</p>}

                {claimIds.length > 0 || patent.overlapWithPaper?.summary ? (
                  <div className="rounded border border-blue-200 bg-blue-50/60 px-4 py-3">
                    <div className="space-y-1.5">
                      {claimIds.length > 0 && (
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-700">
                          Overlaps with paper claims: {claimIds.join(", ")}
                        </p>
                      )}
                      {patent.overlapWithPaper?.summary && (
                        <p className="text-sm leading-relaxed text-blue-800">{patent.overlapWithPaper.summary}</p>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    );
  }

function PatentsPanel({
  extraction: _extraction,
  state,
  paper,
  isMock,
  claimsState,
  countdown,
  onRetry
}: {
  extraction: ExtractionState | undefined;
  state: PatentsState | undefined;
  paper: UploadedPaper | null;
  isMock: boolean;
  claimsState: ClaimsAnalysisState | undefined;
  countdown?: string;
  onRetry?: () => void;
}) {

  function renderPatentsView(
    patents: PatentEntry[],
    promptNotes?: string | null,
    analystNotes?: string
  ) {
    return (
      <div className="flex flex-1 flex-col overflow-auto">
        <div className="flex-1 overflow-auto bg-slate-50">
          <section className="w-full space-y-6 px-6 py-8">
            <header className="flex items-start justify-between gap-3">
              <div className="space-y-2">
                <h2 className="text-xl font-semibold text-slate-900">Related Patents</h2>
                <p className="text-sm leading-relaxed text-slate-600">
                  Patents covering similar methods, compositions, or systems described in the paper&apos;s claims.
                </p>
              </div>
              {onRetry && (
                <button
                  onClick={onRetry}
                  className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                  title="Re-run patent search"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </button>
              )}
            </header>

            {promptNotes && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                {promptNotes}
              </div>
            )}

            {analystNotes && (
              <details className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                <summary className="cursor-pointer font-medium text-slate-900">Analyst notes</summary>
                <pre className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-slate-700">{analystNotes}</pre>
              </details>
            )}

            {patents.length > 0 ? (
              renderPatentCards(patents)
            ) : (
              <div className="rounded-lg border border-slate-200 bg-white px-5 py-4 text-sm text-slate-600">
                No patents surfaced yet.
              </div>
            )}
          </section>
        </div>
      </div>
    );
  }

  if (isMock) {
    if (state?.status === "success") {
      const mockPatents = state.structured?.patents ?? [];
      const mockPromptNotes = state.structured?.promptNotes ?? null;
      const mockAnalystNotes = state.text && state.text.trim().length > 0 ? state.text.trim() : undefined;

      if (mockPatents.length > 0 || mockPromptNotes || mockAnalystNotes) {
        return renderPatentsView(mockPatents as PatentEntry[], mockPromptNotes, mockAnalystNotes);
      }
    }

    if (state?.status === "loading") {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center p-6">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-slate-300 border-t-primary" />
          <p className="text-sm text-slate-600">Loading mock patent data…</p>
        </div>
      );
    }

    if (state?.status === "error") {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center p-6">
          <div className="rounded-full bg-red-50 p-3 text-red-600">⚠️</div>
          <div className="space-y-2">
            <p className="text-base font-semibold text-red-700">Mock patent data unavailable</p>
            <p className="text-sm text-red-600">{state.message}</p>
          </div>
        </div>
      );
    }

    if (
      MOCK_PATENTS_LIST.length > 0 ||
      (MOCK_PATENTS_STRUCTURED?.promptNotes && MOCK_PATENTS_STRUCTURED.promptNotes.length > 0) ||
      (MOCK_PATENTS_TEXT && MOCK_PATENTS_TEXT.trim().length > 0)
    ) {
      return renderPatentsView(
        MOCK_PATENTS_LIST,
        MOCK_PATENTS_STRUCTURED?.promptNotes ?? null,
        MOCK_PATENTS_TEXT && MOCK_PATENTS_TEXT.trim().length > 0 ? MOCK_PATENTS_TEXT : undefined
      );
    }

    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center p-6">
        <p className="text-base font-medium text-slate-700">No patent data yet</p>
        <p className="max-w-md text-sm text-slate-500">
          Run the patent search script to populate this tab with relevant patents.
        </p>
      </div>
    );
  }

  if (!paper) {
    return <PipelineStagePlaceholder stageId="patents" waitingForStageId="claims" />;
  }

  if (!claimsState || claimsState.status === "loading") {
    return <PipelineStagePlaceholder stageId="patents" waitingForStageId="claims" />;
  }

  if (claimsState.status === "error") {
    const message =
      "message" in claimsState && typeof claimsState.message === "string"
        ? claimsState.message
        : "Claims analysis didn’t finish, so we can’t run the patent scan.";
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center p-6">
        <div className="rounded-full bg-red-50 p-3 text-red-600">⚠️</div>
        <div className="space-y-2">
          <p className="text-base font-semibold text-red-700">Claims analysis required</p>
          <p className="text-sm text-red-600">{message}</p>
        </div>
      </div>
    );
  }

  if (!state || state.status === "loading") {
    return <PipelineStagePlaceholder stageId="patents" countdown={countdown} />;
  }

  if (state.status === "error") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center p-6">
        <div className="rounded-full bg-red-50 p-3 text-red-600">⚠️</div>
        <div className="space-y-2">
          <p className="text-base font-semibold text-red-700">Patent search failed</p>
          <p className="text-sm text-red-600">{state.message}</p>
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary/90"
          >
            Try again
          </button>
        )}
      </div>
    );
  }

  const patents = state.structured?.patents ?? [];
  const promptNotes = state.structured?.promptNotes ?? null;
  const analystNotes = state.text && state.text.trim().length > 0 ? state.text.trim() : undefined;

  if (patents.length === 0 && !promptNotes && !analystNotes) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center p-6">
        <p className="text-base font-medium text-slate-700">No patents found yet</p>
        <p className="text-sm text-slate-500">
          We could not surface overlapping patents for this paper. Try re-running the search after refining claims.
        </p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary/90"
          >
            Re-run search
          </button>
        )}
      </div>
    );
  }

  return renderPatentsView(patents, promptNotes, analystNotes);
}

function VerifiedClaimsPanel({
  state,
  isMock,
  onRetry,
  claimsState,
  similarState,
  groupsState,
  patentsState,
  countdown
}: {
  state: VerifiedClaimsState | undefined;
  isMock: boolean;
  onRetry?: () => void;
  claimsState: ClaimsAnalysisState | undefined;
  similarState: SimilarPapersState | undefined;
  groupsState: ResearchGroupsState | undefined;
  patentsState: PatentsState | undefined;
  countdown?: string;
}) {
  const getStatusBadgeClasses = (status: string) => {
    switch (status) {
      case "Verified":
        return "bg-green-100 text-green-800 border-green-300";
      case "Partially Verified":
        return "bg-yellow-100 text-yellow-800 border-yellow-300";
      case "Contradicted":
        return "bg-red-100 text-red-800 border-red-300";
      case "Insufficient Evidence":
      default:
        return "bg-slate-100 text-slate-700 border-slate-300";
    }
  };

  const getConfidenceBadgeClasses = (confidence: string) => {
    switch (confidence) {
      case "High":
        return "bg-blue-100 text-blue-800";
      case "Moderate":
        return "bg-indigo-100 text-indigo-800";
      case "Low":
      default:
        return "bg-slate-100 text-slate-600";
    }
  };

  const renderClaimsView = (
    claims: VerifiedClaimEntry[],
    overallAssessment?: string | null,
    promptNotes?: string | null,
    analystNotes?: string
  ) => (
    <div className="flex flex-1 flex-col overflow-auto">
      <div className="flex-1 overflow-auto bg-slate-50">
        <section className="w-full space-y-6 px-6 py-8">
          <header className="flex items-start justify-between gap-3">
            <div className="space-y-2">
              <h2 className="text-xl font-semibold text-slate-900">Verified Claims</h2>
              <p className="text-sm leading-relaxed text-slate-600">
                Claims cross-referenced against similar papers, research groups, PhD theses, and patents.
              </p>
            </div>
            {onRetry && (
              <button
                onClick={onRetry}
                className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                title="Re-run verified claims analysis"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            )}
          </header>

          {promptNotes && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {promptNotes}
            </div>
          )}

          {analystNotes && (
            <details className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
              <summary className="cursor-pointer font-medium text-slate-900">Analyst notes</summary>
              <pre className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-slate-700">{analystNotes}</pre>
            </details>
          )}

          {overallAssessment && (
            <article className="rounded-lg border border-slate-300 bg-white px-5 py-4 shadow-sm">
              <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-400 mb-3">
                Overall Assessment
              </h3>
              <p className="text-sm leading-relaxed text-slate-700">{overallAssessment}</p>
            </article>
          )}

          <div className="space-y-4">
            {claims.map((claim, index) => (
              <article key={claim.claimId ?? index} className="rounded-lg border border-slate-200 bg-white px-5 py-4 shadow-sm">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                        {claim.claimId ?? `Claim ${index + 1}`}
                      </span>
                      <span
                        className={`rounded-full border px-3 py-1 text-xs font-semibold ${getStatusBadgeClasses(claim.verificationStatus)}`}
                      >
                        {claim.verificationStatus}
                      </span>
                    </div>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${getConfidenceBadgeClasses(claim.confidenceLevel)}`}
                    >
                      Confidence: {claim.confidenceLevel}
                    </span>
                  </div>

                  <div>
                    <p className="text-sm font-semibold text-slate-600 mb-1">Original Claim:</p>
                    <p className="text-sm leading-relaxed text-slate-700">{claim.originalClaim}</p>
                  </div>

                  {claim.supportingEvidence.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-green-700">✓ Supporting Evidence</p>
                      <ul className="space-y-2 pl-4">
                        {claim.supportingEvidence.map((evidence, evIndex) => (
                          <li key={evIndex} className="text-sm leading-relaxed text-slate-700">
                            <span className="inline-block rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 mr-2">
                              {evidence.source}
                            </span>
                            <span className="font-medium">{evidence.title}</span>
                            {evidence.relevance && (
                              <p className="mt-1 text-sm text-slate-600 ml-0">{evidence.relevance}</p>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {claim.contradictingEvidence.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-red-700">✗ Contradicting Evidence</p>
                      <ul className="space-y-2 pl-4">
                        {claim.contradictingEvidence.map((evidence, evIndex) => (
                          <li key={evIndex} className="text-sm leading-relaxed text-slate-700">
                            <span className="inline-block rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800 mr-2">
                              {evidence.source}
                            </span>
                            <span className="font-medium">{evidence.title}</span>
                            {evidence.relevance && (
                              <p className="mt-1 text-sm text-slate-600 ml-0">{evidence.relevance}</p>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {claim.verificationSummary && (
                    <div className="rounded border border-blue-200 bg-blue-50/60 px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-700 mb-1.5">
                        Verification Summary
                      </p>
                      <p className="text-sm leading-relaxed text-blue-800">{claim.verificationSummary}</p>
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  );

  if (!claimsState || claimsState.status === "loading") {
    return <PipelineStagePlaceholder stageId="verifiedClaims" waitingForStageId="claims" countdown={countdown} />;
  }

  if (claimsState.status === "error") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center p-6">
        <div className="rounded-full bg-red-50 p-3 text-red-600">⚠️</div>
        <div className="space-y-2">
          <p className="text-base font-semibold text-red-700">Claims analysis required</p>
          <p className="text-sm text-red-600">
            {"message" in claimsState && typeof claimsState.message === "string"
              ? claimsState.message
              : "Finish the claims step to unlock verification."}
          </p>
        </div>
      </div>
    );
  }

  if (!similarState || similarState.status === "loading") {
    return <PipelineStagePlaceholder stageId="verifiedClaims" waitingForStageId="similarPapers" countdown={countdown} />;
  }

  if (similarState.status === "error") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center p-6">
        <div className="rounded-full bg-red-50 p-3 text-red-600">⚠️</div>
        <div className="space-y-2">
          <p className="text-base font-semibold text-red-700">Similar papers required</p>
          <p className="text-sm text-red-600">Resolve the similar papers tab so we can cross-reference claims.</p>
        </div>
      </div>
    );
  }

  if (!groupsState || groupsState.status === "loading") {
    return <PipelineStagePlaceholder stageId="verifiedClaims" waitingForStageId="researchGroups" countdown={countdown} />;
  }

  if (groupsState.status === "error") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center p-6">
        <div className="rounded-full bg-red-50 p-3 text-red-600">⚠️</div>
        <div className="space-y-2">
          <p className="text-base font-semibold text-red-700">Research groups required</p>
          <p className="text-sm text-red-600">Fix the research groups tab to give the verifier team context.</p>
        </div>
      </div>
    );
  }

  if (!patentsState || patentsState.status === "loading") {
    return <PipelineStagePlaceholder stageId="verifiedClaims" waitingForStageId="patents" countdown={countdown} />;
  }

  if (patentsState.status === "error") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center p-6">
        <div className="rounded-full bg-red-50 p-3 text-red-600">⚠️</div>
        <div className="space-y-2">
          <p className="text-base font-semibold text-red-700">Patent scan required</p>
          <p className="text-sm text-red-600">Re-run the patent tab before verifying claims.</p>
        </div>
      </div>
    );
  }

  if (isMock) {
    if (state?.status === "success") {
      const mockClaims = (state.structured?.claims ?? []) as VerifiedClaimEntry[];
      const mockOverall = state.structured?.overallAssessment ?? null;
      const mockPromptNotes = state.structured?.promptNotes ?? null;
      const mockAnalystNotes = state.text && state.text.trim().length > 0 ? state.text.trim() : undefined;

      if (mockClaims.length > 0 || mockOverall || mockPromptNotes || mockAnalystNotes) {
        return renderClaimsView(mockClaims, mockOverall, mockPromptNotes, mockAnalystNotes);
      }
    }

    if (state?.status === "loading") {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center p-6">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-slate-300 border-t-primary" />
          <p className="text-sm text-slate-600">Loading mock verified claims…</p>
        </div>
      );
    }

    if (state?.status === "error") {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center p-6">
          <div className="rounded-full bg-red-50 p-3 text-red-600">⚠️</div>
          <div className="space-y-2">
            <p className="text-base font-semibold text-red-700">Mock verified claims unavailable</p>
            <p className="text-sm text-red-600">{state.message}</p>
          </div>
        </div>
      );
    }

    if (
      (MOCK_VERIFIED_CLAIMS_STRUCTURED_DATA?.claims?.length ?? 0) > 0 ||
      MOCK_VERIFIED_CLAIMS_OVERALL ||
      (MOCK_VERIFIED_CLAIMS_PROMPT_NOTES && MOCK_VERIFIED_CLAIMS_PROMPT_NOTES.length > 0) ||
      (MOCK_VERIFIED_CLAIMS_TEXT && MOCK_VERIFIED_CLAIMS_TEXT.trim().length > 0)
    ) {
      return renderClaimsView(
        (MOCK_VERIFIED_CLAIMS_STRUCTURED_DATA?.claims ?? []) as VerifiedClaimEntry[],
        MOCK_VERIFIED_CLAIMS_OVERALL,
        MOCK_VERIFIED_CLAIMS_PROMPT_NOTES,
        MOCK_VERIFIED_CLAIMS_TEXT && MOCK_VERIFIED_CLAIMS_TEXT.trim().length > 0
          ? MOCK_VERIFIED_CLAIMS_TEXT
          : undefined
      );
    }

    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center p-6">
        <p className="text-base font-medium text-slate-700">No verified claims yet</p>
        <p className="max-w-md text-sm text-slate-500">
          Run the verified claims script to cross-reference claims against all gathered evidence.
        </p>
      </div>
    );
  }

  if (!similarState || similarState.status === "loading") {
    return <PipelineStagePlaceholder stageId="verifiedClaims" waitingForStageId="similarPapers" />;
  }

  if (similarState.status === "error") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center p-6">
        <div className="rounded-full bg-red-50 p-3 text-red-600">⚠️</div>
        <div className="space-y-2">
          <p className="text-base font-semibold text-red-700">Similar papers required</p>
          <p className="text-sm text-red-600">Resolve the similar papers tab so we can cross-reference claims.</p>
        </div>
      </div>
    );
  }

  if (!groupsState || groupsState.status === "loading") {
    return <PipelineStagePlaceholder stageId="verifiedClaims" waitingForStageId="researchGroups" />;
  }

  if (groupsState.status === "error") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center p-6">
        <div className="rounded-full bg-red-50 p-3 text-red-600">⚠️</div>
        <div className="space-y-2">
          <p className="text-base font-semibold text-red-700">Research groups required</p>
          <p className="text-sm text-red-600">Fix the research groups tab to give the verifier team context.</p>
        </div>
      </div>
    );
  }

  if (!patentsState || patentsState.status === "loading") {
    return <PipelineStagePlaceholder stageId="verifiedClaims" waitingForStageId="patents" />;
  }

  if (patentsState.status === "error") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center p-6">
        <div className="rounded-full bg-red-50 p-3 text-red-600">⚠️</div>
        <div className="space-y-2">
          <p className="text-base font-semibold text-red-700">Patent scan required</p>
          <p className="text-sm text-red-600">Re-run the patent tab before verifying claims.</p>
        </div>
      </div>
    );
  }

  if (!state || state.status === "loading") {
    return <PipelineStagePlaceholder stageId="verifiedClaims" countdown={countdown} />;
  }

  if (state.status === "error") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center p-6">
        <div className="rounded-full bg-red-50 p-3 text-red-600">⚠️</div>
        <div className="space-y-2">
          <p className="text-base font-semibold text-red-700">Verified claims failed</p>
          <p className="text-sm text-red-600">{state.message}</p>
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary/90"
          >
            Try again
          </button>
        )}
      </div>
    );
  }

  const claims = state.structured?.claims ?? [];
  const overallAssessment = state.structured?.overallAssessment;
  const promptNotes = state.structured?.promptNotes ?? null;
  const analystNotes = state.text && state.text.trim().length > 0 ? state.text.trim() : undefined;

  if (claims.length === 0 && !overallAssessment && !promptNotes && !analystNotes) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center p-6">
        <p className="text-base font-medium text-slate-700">No verified claims yet</p>
        <p className="text-sm text-slate-500">
          We could not synthesise verified claims. You can retry after confirming the upstream tabs look good.
        </p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary/90"
          >
            Re-run verification
          </button>
        )}
      </div>
    );
  }

  return renderClaimsView(claims, overallAssessment, promptNotes ?? undefined, analystNotes);
}

function ExpertNetworkPanel({ paper, isMock }: { paper: UploadedPaper | null; isMock: boolean }) {
  if (!paper && !isMock) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
        <p className="text-base font-medium text-slate-700">Upload a PDF to request expert consultation.</p>
        <p className="text-sm text-slate-500">We&apos;ll connect you with relevant experts once you select a paper.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="mx-auto max-w-3xl space-y-6">
        {/* Header with placeholder notice */}
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
          <p className="text-sm text-blue-800">
            {isMock
              ? "Sample view of the Expert Network request flow. Sign in to submit a real consultation request."
              : "This is a preview of the Expert Review feature. We are actively building the expert matching and scheduling system."}
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
  const similarStorageFetchesRef = useRef<Set<string>>(new Set<string>());
  const similarStorageResolvedRef = useRef<Set<string>>(new Set<string>());
  const similarPapersGenerationRef = useRef<Set<string>>(new Set<string>());
  const patentsStorageFetchesRef = useRef<Set<string>>(new Set<string>());
  const patentsStorageResolvedRef = useRef<Set<string>>(new Set<string>());
  const patentsGenerationRef = useRef<Set<string>>(new Set<string>());
  const verifiedClaimsStorageFetchesRef = useRef<Set<string>>(new Set<string>());
  const verifiedClaimsStorageResolvedRef = useRef<Set<string>>(new Set<string>());
  const verifiedClaimsGenerationRef = useRef<Set<string>>(new Set<string>());
  const researchGroupsStorageFetchesRef = useRef<Set<string>>(new Set<string>());
  const researchGroupsGenerationRef = useRef<Set<string>>(new Set<string>());
  const contactsStorageFetchesRef = useRef<Set<string>>(new Set<string>());
  const thesesStorageFetchesRef = useRef<Set<string>>(new Set<string>());
  const thesesStorageResolvedRef = useRef<Set<string>>(new Set<string>());
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const initialMockPapers =
    MOCK_UPLOADED_PAPERS_FROM_SUMMARIES.length > 0
      ? MOCK_UPLOADED_PAPERS_FROM_SUMMARIES
      : [MOCK_UPLOADED_PAPER];
  const defaultActivePaperId = initialMockPapers[0]?.id ?? null;
  const defaultSummary = defaultActivePaperId ? MOCK_SUMMARIES_BY_ID.get(defaultActivePaperId) : undefined;
  const initialExtractionState: ExtractionState = defaultSummary
    ? createExtractionStateFromSummary(defaultSummary)
    : {
        status: "success",
        data: {
          pages: null,
          info: null,
          text: "Static Evidentia sample paper"
        }
      };
  const initialClaimsState = defaultSummary ? createClaimsStateFromRaw(defaultSummary.raw) : MOCK_CLAIMS_INITIAL_STATE;
  const initialSimilarState = defaultSummary
    ? createSimilarStateFromRaw(defaultSummary.raw)
    : {
        status: "success",
        text: ""
      } as SimilarPapersState;
  const initialPatentsState = defaultSummary ? createPatentsStateFromRaw(defaultSummary.raw) : MOCK_PATENTS_INITIAL_STATE;
  const initialVerifiedClaimsState = defaultSummary
    ? createVerifiedClaimsStateFromRaw(defaultSummary.raw)
    : MOCK_VERIFIED_CLAIMS_INITIAL_STATE;
  const initialResearchGroupsState: ResearchGroupsState = defaultSummary
    ? createResearchGroupsStateFromRaw(defaultSummary.raw)
    : {
        status: "success",
        text: MOCK_RESEARCH_GROUPS_TEXT,
        structured: MOCK_RESEARCH_GROUPS_STRUCTURED
      };
  const initialResearchContactsState = createResearchContactsStateFromRaw();
  const initialResearchThesesState = defaultSummary
    ? createResearchThesesStateFromRaw(defaultSummary.raw)
    : MOCK_RESEARCH_THESES_INITIAL_STATE;
  const [uploadedPapers, setUploadedPapers] = useState<UploadedPaper[]>(initialMockPapers);
  const [activePaperId, setActivePaperId] = useState<string | null>(defaultActivePaperId);
  const [isSavingPaper, setIsSavingPaper] = useState(false);
  const [uploadStatusMessage, setUploadStatusMessage] = useState<string | null>(null);
  const [uploadErrorMessage, setUploadErrorMessage] = useState<string | null>(null);
  const [isFetchingLibrary, setIsFetchingLibrary] = useState(false);
  const [isStatusDismissed, setIsStatusDismissed] = useState(false);
  const [extractionStates, setExtractionStates] = useState<Record<string, ExtractionState>>(
    defaultActivePaperId ? { [defaultActivePaperId]: initialExtractionState } : {}
  );
  const [claimsStates, setClaimsStates] = useState<Record<string, ClaimsAnalysisState>>(
    defaultActivePaperId ? { [defaultActivePaperId]: initialClaimsState } : {}
  );
  const [similarPapersStates, setSimilarPapersStates] = useState<Record<string, SimilarPapersState>>(
    defaultActivePaperId ? { [defaultActivePaperId]: initialSimilarState } : {}
  );
  const [patentsStates, setPatentsStates] = useState<Record<string, PatentsState>>(
    defaultActivePaperId ? { [defaultActivePaperId]: initialPatentsState } : {}
  );
  const [verifiedClaimsStates, setVerifiedClaimsStates] = useState<Record<string, VerifiedClaimsState>>(
    defaultActivePaperId ? { [defaultActivePaperId]: initialVerifiedClaimsState } : {}
  );
  const [researchGroupsStates, setResearchGroupsStates] = useState<Record<string, ResearchGroupsState>>(
    defaultActivePaperId ? { [defaultActivePaperId]: initialResearchGroupsState } : {}
  );
  const [researchContactsStates, setResearchContactsStates] =
    useState<Record<string, ResearchGroupContactsState>>(
      defaultActivePaperId ? { [defaultActivePaperId]: initialResearchContactsState } : {}
    );
  const [researchThesesStates, setResearchThesesStates] = useState<Record<string, ResearcherThesesState>>(
    defaultActivePaperId ? { [defaultActivePaperId]: initialResearchThesesState } : {}
  );

  const extractionStatesRef = useRef(extractionStates);
  const claimsStatesRef = useRef(claimsStates);
  const similarPapersStatesRef = useRef(similarPapersStates);
  const patentsStatesRef = useRef(patentsStates);
  const verifiedClaimsStatesRef = useRef(verifiedClaimsStates);
  const researchGroupsStatesRef = useRef(researchGroupsStates);
  const researchContactsStatesRef = useRef(researchContactsStates);
  const researchThesesStatesRef = useRef(researchThesesStates);

  useEffect(() => {
    extractionStatesRef.current = extractionStates;
  }, [extractionStates]);

  useEffect(() => {
    claimsStatesRef.current = claimsStates;
  }, [claimsStates]);

  useEffect(() => {
    similarPapersStatesRef.current = similarPapersStates;
  }, [similarPapersStates]);

  useEffect(() => {
    patentsStatesRef.current = patentsStates;
  }, [patentsStates]);

  useEffect(() => {
    verifiedClaimsStatesRef.current = verifiedClaimsStates;
  }, [verifiedClaimsStates]);

  useEffect(() => {
    researchGroupsStatesRef.current = researchGroupsStates;
  }, [researchGroupsStates]);

  useEffect(() => {
    researchContactsStatesRef.current = researchContactsStates;
  }, [researchContactsStates]);

  useEffect(() => {
    researchThesesStatesRef.current = researchThesesStates;
  }, [researchThesesStates]);

  const pipelineRunsRef = useRef<Map<string, Promise<void>>>(new Map());
  const activePaper = activePaperId
    ? uploadedPapers.find((item) => item.id === activePaperId) ?? null
    : null;
  const isActivePaperMock = isMockPaper(activePaper);
  const activeExtraction = activePaper ? extractionStates[activePaper.id] : undefined;
  const activeClaimsState = activePaper ? claimsStates[activePaper.id] : undefined;
  const activeSimilarPapersState = activePaper ? similarPapersStates[activePaper.id] : undefined;
  const activePatentsState = activePaper ? patentsStates[activePaper.id] : undefined;
  const activeVerifiedClaimsState = activePaper ? verifiedClaimsStates[activePaper.id] : undefined;
  const activeResearchGroupState = activePaper ? researchGroupsStates[activePaper.id] : undefined;
  const activeResearchContactsState = activePaper ? researchContactsStates[activePaper.id] : undefined;
  const activeResearchThesesState = activePaper ? researchThesesStates[activePaper.id] : undefined;
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const isPaperViewerActive = activeTab === "paper" && Boolean(activePaper);
  const dropzoneHelperText = !user
    ? "Sign in to save papers to your library."
    : isFetchingLibrary
      ? "Loading your library…"
      : undefined;

  const pipelineStages = useMemo<PipelineStageView[] | null>(() => {
    if (!activePaper || isMockPaper(activePaper)) {
      return null;
    }

    const paperId = activePaper.id;

    const deriveStatus = (state: any): { status: StageStatus; errorMessage?: string } => {
      if (!state) {
        return { status: "idle" };
      }
      if (state.status === "loading") {
        return { status: "loading" };
      }
      if (state.status === "error") {
        return { status: "error", errorMessage: state.message ?? state.hint };
      }
      return { status: "success" };
    };

    return PIPELINE_STAGE_ORDER.map((stageId, index) => {
      const meta = PIPELINE_STAGE_METADATA[stageId];
      let status: StageStatus = "idle";
      let errorMessage: string | undefined;

      switch (stageId) {
        case "extraction": {
          const extractionState = extractionStates[paperId];
          ({ status, errorMessage } = deriveStatus(extractionState));
          if (extractionState?.status === "error" && extractionState.hint && !errorMessage) {
            errorMessage = extractionState.hint;
          }
          break;
        }
        case "claims": {
          const claimsState = claimsStates[paperId];
          ({ status, errorMessage } = deriveStatus(claimsState));
          break;
        }
        case "similarPapers": {
          const similarState = similarPapersStates[paperId];
          ({ status, errorMessage } = deriveStatus(similarState));
          break;
        }
        case "researchGroups": {
          const groupsState = researchGroupsStates[paperId];
          ({ status, errorMessage } = deriveStatus(groupsState));
          const contactsState = researchContactsStates[paperId];
          if (contactsState?.status === "loading" && status === "success") {
            status = "loading";
            errorMessage = undefined;
          }
          if (contactsState?.status === "error") {
            status = "error";
            errorMessage = contactsState.message;
          }
          break;
        }
        case "theses": {
          const thesesState = researchThesesStates[paperId];
          ({ status, errorMessage } = deriveStatus(thesesState));
          break;
        }
        case "patents": {
          const patentsState = patentsStates[paperId];
          ({ status, errorMessage } = deriveStatus(patentsState));
          break;
        }
        case "verifiedClaims": {
          const verifiedState = verifiedClaimsStates[paperId];
          ({ status, errorMessage } = deriveStatus(verifiedState));
          break;
        }
      }

      return {
        id: stageId,
        index,
        label: meta.label,
        helper: meta.helper,
        status,
        errorMessage
      } satisfies PipelineStageView;
    });
  }, [
    activePaper,
    claimsStates,
    extractionStates,
    patentsStates,
    researchContactsStates,
    researchGroupsStates,
    researchThesesStates,
    similarPapersStates,
    verifiedClaimsStates
  ]);

  useEffect(() => {
    if (!activePaper || !isMockPaper(activePaper)) {
      return;
    }

    const summary = MOCK_SUMMARIES_BY_ID.get(activePaper.id);
    if (!summary) {
      return;
    }
    const raw = summary.raw;

    setExtractionStates((prev) => ({
      ...prev,
      [activePaper.id]: createExtractionStateFromSummary(summary)
    }));
    setClaimsStates((prev) => ({
      ...prev,
      [activePaper.id]: createClaimsStateFromRaw(raw)
    }));
    setSimilarPapersStates((prev) => ({
      ...prev,
      [activePaper.id]: createSimilarStateFromRaw(raw)
    }));
    setPatentsStates((prev) => ({
      ...prev,
      [activePaper.id]: createPatentsStateFromRaw(raw)
    }));
    setVerifiedClaimsStates((prev) => ({
      ...prev,
      [activePaper.id]: createVerifiedClaimsStateFromRaw(raw)
    }));
    setResearchGroupsStates((prev) => ({
      ...prev,
      [activePaper.id]: createResearchGroupsStateFromRaw(raw)
    }));
    setResearchContactsStates((prev) => ({
      ...prev,
      [activePaper.id]: createResearchContactsStateFromRaw()
    }));
    setResearchThesesStates((prev) => ({
      ...prev,
      [activePaper.id]: createResearchThesesStateFromRaw(raw)
    }));
  }, [activePaper]);

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
    const cachedSimilar = readCachedState<{ text: string; structured?: SimilarPapersStructured }>(
      paperId,
      "similarPapers"
    );
    const cachedStructured = cachedSimilar?.structured
      ? ensureSourcePaperInSimilarStructured(activePaper, cachedSimilar.structured)
      : undefined;

    if (!activeSimilarPapersState && cachedSimilar?.text) {
      if (cachedSimilar.structured && cachedStructured !== cachedSimilar.structured) {
        writeCachedState(paperId, "similarPapers", {
          text: cachedSimilar.text,
          structured: cachedStructured
        });
      }

      setSimilarPapersStates((prev) => ({
        ...prev,
        [paperId]: {
          status: "success",
          text: cachedSimilar.text,
          structured: cachedStructured
        }
      }));

      similarStorageResolvedRef.current.add(paperId);
    }

    let cancelled = false;
    const hasAttemptedStorageLoad = similarStorageFetchesRef.current.has(paperId);

    if (
      !activeSimilarPapersState &&
      !cachedSimilar?.text &&
      activePaper.storagePath &&
      supabase &&
      !hasAttemptedStorageLoad
    ) {
      similarStorageFetchesRef.current.add(paperId);
      similarStorageResolvedRef.current.delete(paperId);

      setSimilarPapersStates((prev) => ({
        ...prev,
        [paperId]: { status: "loading" }
      }));

      const storagePromise = loadSimilarPapersFromStorage({
        client: supabase,
        storagePath: activePaper.storagePath
      })
        .then((storedData) => {
          if (cancelled) {
            return;
          }

          const rawText = typeof storedData?.text === "string" ? storedData.text : "";
          const trimmedText = rawText.trim();
          const hasStructured = storedData && typeof storedData.structured === "object";
          if (trimmedText || hasStructured) {
            const structured = hasStructured
              ? ensureSourcePaperInSimilarStructured(activePaper, storedData!.structured as SimilarPapersStructured)
              : undefined;
            const text = trimmedText || rawText || "Similar papers loaded from cache.";

            console.log("[similar-papers] loaded from Supabase", {
              paperId,
              textLength: text.length,
              hasStructured: Boolean(structured)
            });

            writeCachedState(paperId, "similarPapers", { text, structured });
            setSimilarPapersStates((prev) => ({
              ...prev,
              [paperId]: {
                status: "success",
                text,
                structured
              }
            }));
            return;
          }

          console.log("[similar-papers] Supabase load empty", {
            paperId,
            hasStructured: Boolean(storedData?.structured)
          });

          setSimilarPapersStates((prev) => {
            const next = { ...prev };
            delete next[paperId];
            return next;
          });
        })
        .catch((error) => {
          if (cancelled) {
            return;
          }
          console.error("[similar-papers] failed to load from storage", error);
          setSimilarPapersStates((prev) => {
            const next = { ...prev };
            delete next[paperId];
            return next;
          });
        })
        .finally(() => {
          similarStorageFetchesRef.current.delete(paperId);
          similarStorageResolvedRef.current.add(paperId);
        });

      void storagePromise;
    } else if (!similarStorageResolvedRef.current.has(paperId)) {
      similarStorageResolvedRef.current.add(paperId);
    }

    const cachedPatents = readCachedState<{ text?: string; structured?: PatentsStructured | any }>(
      paperId,
      "patents"
    );

    if (
      !activePatentsState &&
      (typeof cachedPatents?.text === "string" || (cachedPatents?.structured && typeof cachedPatents.structured === "object"))
    ) {
      const text = typeof cachedPatents?.text === "string" ? cachedPatents.text : undefined;
      const structured = cachedPatents?.structured ? normalizePatentsStructured(cachedPatents.structured) : undefined;

      setPatentsStates((prev) => ({
        ...prev,
        [paperId]: {
          status: "success",
          ...(text ? { text } : {}),
          ...(structured ? { structured } : {})
        }
      }));

      patentsStorageResolvedRef.current.add(paperId);
    }

    const hasAttemptedPatentsLoad = patentsStorageFetchesRef.current.has(paperId);
    if (
      !activePatentsState &&
      !cachedPatents &&
      activePaper.storagePath &&
      supabase &&
      !hasAttemptedPatentsLoad
    ) {
      patentsStorageFetchesRef.current.add(paperId);
      patentsStorageResolvedRef.current.delete(paperId);
      setPatentsStates((prev) => ({
        ...prev,
        [paperId]: { status: "loading" }
      }));

      const patentsPromise = loadPatentsFromStorage({
        client: supabase,
        storagePath: activePaper.storagePath
      })
        .then((storedData) => {
          if (cancelled) {
            return;
          }

          const rawText = typeof storedData?.text === "string" ? storedData.text : "";
          const trimmedText = rawText.trim();
          const structured = storedData?.structured
            ? normalizePatentsStructured((storedData as any).structured)
            : undefined;

          if (trimmedText || structured) {
            const text = trimmedText || rawText || "Patent notes loaded from cache.";
            writeCachedState(paperId, "patents", {
              ...(text ? { text } : {}),
              ...(structured ? { structured } : {})
            });
            setPatentsStates((prev) => ({
              ...prev,
              [paperId]: {
                status: "success",
                ...(text ? { text } : {}),
                ...(structured ? { structured } : {})
              }
            }));
            return;
          }

          setPatentsStates((prev) => {
            const next = { ...prev };
            delete next[paperId];
            return next;
          });
        })
        .catch((error) => {
          if (cancelled) {
            return;
          }
          console.error("[patents] failed to load from storage", error);
          setPatentsStates((prev) => {
            const next = { ...prev };
            delete next[paperId];
            return next;
          });
        })
        .finally(() => {
          patentsStorageFetchesRef.current.delete(paperId);
          patentsStorageResolvedRef.current.add(paperId);
        });

      void patentsPromise;
    } else if (!patentsStorageResolvedRef.current.has(paperId)) {
      patentsStorageResolvedRef.current.add(paperId);
    }

    const cachedVerified = readCachedState<{ text?: string; structured?: VerifiedClaimsStructured | any }>(
      paperId,
      "verifiedClaims"
    );

    if (
      !activeVerifiedClaimsState &&
      (typeof cachedVerified?.text === "string" || (cachedVerified?.structured && typeof cachedVerified.structured === "object"))
    ) {
      const text = typeof cachedVerified?.text === "string" ? cachedVerified.text : undefined;
      const structured = cachedVerified?.structured
        ? normalizeVerifiedClaimsStructured(cachedVerified.structured)
        : undefined;

      setVerifiedClaimsStates((prev) => ({
        ...prev,
        [paperId]: {
          status: "success",
          ...(text ? { text } : {}),
          ...(structured ? { structured } : {})
        }
      }));

      verifiedClaimsStorageResolvedRef.current.add(paperId);
    }

    const hasAttemptedVerifiedLoad = verifiedClaimsStorageFetchesRef.current.has(paperId);
    if (
      !activeVerifiedClaimsState &&
      !cachedVerified &&
      activePaper.storagePath &&
      supabase &&
      !hasAttemptedVerifiedLoad
    ) {
      verifiedClaimsStorageFetchesRef.current.add(paperId);
      verifiedClaimsStorageResolvedRef.current.delete(paperId);

      setVerifiedClaimsStates((prev) => ({
        ...prev,
        [paperId]: { status: "loading" }
      }));

      const verifiedPromise = loadVerifiedClaimsFromStorage({
        client: supabase,
        storagePath: activePaper.storagePath
      })
        .then((storedData) => {
          if (cancelled) {
            return;
          }

          const text = typeof storedData?.text === "string" ? storedData.text.trim() : "";
          const structured = storedData?.structured
            ? normalizeVerifiedClaimsStructured((storedData as any).structured)
            : undefined;

          if (text || structured) {
            const resolvedText = text || (typeof storedData?.text === "string" ? storedData.text : undefined);
            writeCachedState(paperId, "verifiedClaims", {
              ...(resolvedText ? { text: resolvedText } : {}),
              ...(structured ? { structured } : {})
            });
            setVerifiedClaimsStates((prev) => ({
              ...prev,
              [paperId]: {
                status: "success",
                ...(resolvedText ? { text: resolvedText } : {}),
                ...(structured ? { structured } : {})
              }
            }));
            return;
          }

          setVerifiedClaimsStates((prev) => {
            const next = { ...prev };
            delete next[paperId];
            return next;
          });
        })
        .catch((error) => {
          if (cancelled) {
            return;
          }
          console.error("[verified-claims] failed to load from storage", error);
          setVerifiedClaimsStates((prev) => {
            const next = { ...prev };
            delete next[paperId];
            return next;
          });
        })
        .finally(() => {
          verifiedClaimsStorageFetchesRef.current.delete(paperId);
          verifiedClaimsStorageResolvedRef.current.add(paperId);
        });

      void verifiedPromise;
    } else if (!verifiedClaimsStorageResolvedRef.current.has(paperId)) {
      verifiedClaimsStorageResolvedRef.current.add(paperId);
    }

    const cachedGroups = readCachedState<{ text: string; structured?: ResearchGroupPaperEntry[] | any }>(
      paperId,
      "groups"
    );
    if (!activeResearchGroupState && cachedGroups?.text) {
      const normalized = normalizeResearchGroupsStructured(cachedGroups.structured);
      setResearchGroupsStates((prev) => ({
        ...prev,
        [paperId]: {
          status: "success",
          text: cachedGroups.text,
          structured: normalized
        }
      }));
    }

    const hasAttemptedGroupsLoad = researchGroupsStorageFetchesRef.current.has(paperId);
    if (
      !activeResearchGroupState &&
      !cachedGroups?.text &&
      activePaper.storagePath &&
      supabase &&
      !hasAttemptedGroupsLoad
    ) {
      researchGroupsStorageFetchesRef.current.add(paperId);
      setResearchGroupsStates((prev) => ({
        ...prev,
        [paperId]: { status: "loading" }
      }));

      const groupsPromise = loadResearchGroupsFromStorage({
        client: supabase,
        storagePath: activePaper.storagePath
      })
        .then((storedData) => {
          if (cancelled) {
            return;
          }

          const text = typeof storedData?.text === "string" ? storedData.text.trim() : "";
          if (text) {
            const structured = normalizeResearchGroupsStructured((storedData as any)?.structured);

            writeCachedState(paperId, "groups", { text, structured });
            setResearchGroupsStates((prev) => ({
              ...prev,
              [paperId]: {
                status: "success",
                text,
                structured
              }
            }));
            return;
          }

          setResearchGroupsStates((prev) => {
            const next = { ...prev };
            delete next[paperId];
            return next;
          });
        })
        .catch((error) => {
          if (cancelled) {
            return;
          }
          console.error("[research-groups] failed to load from storage", error);
          setResearchGroupsStates((prev) => {
            const next = { ...prev };
            delete next[paperId];
            return next;
          });
        })
        .finally(() => {
          researchGroupsStorageFetchesRef.current.delete(paperId);
        });

      void groupsPromise;
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

    const hasAttemptedContactsLoad = contactsStorageFetchesRef.current.has(paperId);
    if (
      !activeResearchContactsState &&
      activePaper.storagePath &&
      supabase &&
      !hasAttemptedContactsLoad
    ) {
      contactsStorageFetchesRef.current.add(paperId);
      setResearchContactsStates((prev) => ({
        ...prev,
        [paperId]: { status: "loading" }
      }));

      const contactsPromise = loadContactsFromStorage({
        client: supabase,
        storagePath: activePaper.storagePath
      })
        .then((storedData) => {
          if (cancelled) {
            return;
          }

          const contacts = Array.isArray(storedData?.contacts) ? storedData.contacts : [];
          if (contacts.length > 0) {
            writeCachedState(paperId, "contacts", { contacts });
            setResearchContactsStates((prev) => ({
              ...prev,
              [paperId]: {
                status: "success",
                contacts
              }
            }));
            return;
          }

          setResearchContactsStates((prev) => {
            const next = { ...prev };
            delete next[paperId];
            return next;
          });
        })
        .catch((error) => {
          if (cancelled) {
            return;
          }
          console.error("[research-contacts] failed to load from storage", error);
          setResearchContactsStates((prev) => {
            const next = { ...prev };
            delete next[paperId];
            return next;
          });
        })
        .finally(() => {
          contactsStorageFetchesRef.current.delete(paperId);
        });

      void contactsPromise;
    }

    if (!activeResearchThesesState) {
      const cachedTheses = readCachedState<{ researchers: ResearcherThesisRecord[]; text?: string }>(
        paperId,
        "theses"
      );
      if (cachedTheses?.researchers) {
        setResearchThesesStates((prev) => ({
          ...prev,
          [paperId]: {
            status: "success",
            researchers: cachedTheses.researchers,
            ...(cachedTheses.text && cachedTheses.text.trim().length > 0
              ? { text: cachedTheses.text }
              : {})
          }
        }));
      }
    }

    const hasAttemptedThesesLoad = thesesStorageFetchesRef.current.has(paperId);
    if (
      !activeResearchThesesState &&
      activePaper.storagePath &&
      supabase &&
      !hasAttemptedThesesLoad
    ) {
      thesesStorageFetchesRef.current.add(paperId);
      setResearchThesesStates((prev) => ({
        ...prev,
        [paperId]: { status: "loading" }
      }));

      const thesesPromise = loadThesesFromStorage({
        client: supabase,
        storagePath: activePaper.storagePath
      })
        .then((storedData) => {
          if (cancelled) {
            return;
          }

          const researchers = Array.isArray(storedData?.researchers) ? storedData.researchers : [];
          const text = typeof storedData?.text === "string" ? storedData.text.trim() : "";

          if (researchers.length > 0) {
            const cachePayload = text.length > 0 ? { researchers, text } : { researchers };
            writeCachedState(paperId, "theses", cachePayload);
            setResearchThesesStates((prev) => ({
              ...prev,
              [paperId]: {
                status: "success",
                researchers,
                ...(text.length > 0 ? { text } : {})
              }
            }));
            return;
          }

          setResearchThesesStates((prev) => {
            const next = { ...prev };
            delete next[paperId];
            return next;
          });
        })
        .catch((error) => {
          if (cancelled) {
            return;
          }
          console.error("[researcher-theses] failed to load from storage", error);
          setResearchThesesStates((prev) => {
            const next = { ...prev };
            delete next[paperId];
            return next;
          });
        })
        .finally(() => {
          thesesStorageFetchesRef.current.delete(paperId);
          thesesStorageResolvedRef.current.add(paperId);
        });

      void thesesPromise;
    } else if (!thesesStorageResolvedRef.current.has(paperId)) {
      thesesStorageResolvedRef.current.add(paperId);
    }

    return () => {
      cancelled = true;
      similarStorageFetchesRef.current.delete(paperId);
      similarStorageResolvedRef.current.delete(paperId);
      researchGroupsStorageFetchesRef.current.delete(paperId);
      contactsStorageFetchesRef.current.delete(paperId);
      thesesStorageFetchesRef.current.delete(paperId);
      thesesStorageResolvedRef.current.delete(paperId);
    };
  }, [
    activePaper,
    activeSimilarPapersState,
    activeResearchGroupState,
    activeResearchContactsState,
    activeResearchThesesState,
    supabase
  ]);

  const runExtraction = useCallback(
    async (paper: UploadedPaper, options?: { file?: File }): Promise<ExtractedText | null> => {
      if (!paper) {
        return null;
      }

      if (isMockPaper(paper)) {
        const mockData: ExtractedText = {
          pages: null,
          info: null,
          text: "Static Evidentia sample paper"
        };

        setExtractionStates((prev) => ({
          ...prev,
          [paper.id]: {
            status: "success",
            data: mockData
          }
        }));
        return mockData;
      }

      setExtractionStates((prev) => ({
        ...prev,
        [paper.id]: { status: "loading" }
      }));

      // Clear refs when re-extracting
      similarStorageFetchesRef.current.delete(paper.id);
      similarStorageResolvedRef.current.delete(paper.id);
      similarPapersGenerationRef.current.delete(paper.id);
      researchGroupsStorageFetchesRef.current.delete(paper.id);
      researchGroupsGenerationRef.current.delete(paper.id);

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
        const storagePath = typeof paper.storagePath === "string" ? paper.storagePath.trim() : "";
        const hasStoragePath = storagePath.length > 0;
        const fileUrl = typeof paper.url === "string" ? paper.url.trim() : "";
        const hasFileUrl = fileUrl.length > 0;

        let workingFile: File | null = hasStoragePath ? null : options?.file ?? null;

        if (!workingFile && !hasStoragePath && hasFileUrl) {
          try {
            const pdfResponse = await fetch(fileUrl, {
              cache: "no-store"
            });

            if (!pdfResponse.ok) {
              throw new Error(`Failed to download PDF for extraction (status ${pdfResponse.status}).`);
            }

            const blob = await pdfResponse.blob();
            workingFile = new File([blob], sanitizeFileName(paper.fileName, "paper.pdf"), {
              type: "application/pdf"
            });
          } catch (downloadError) {
            console.warn("[extraction] Client-side fetch failed", {
              url: fileUrl,
              error: downloadError
            });
          }
        }

        if (!hasStoragePath && !workingFile) {
          throw new Error("Missing PDF data for extraction.");
        }

        const fileName = sanitizeFileName(paper.fileName, workingFile?.name, "paper.pdf");

        const formData = new FormData();
        formData.append("filename", fileName);

        if (hasStoragePath) {
          formData.append("storagePath", storagePath);
        }

        if (hasFileUrl) {
          formData.append("fileUrl", fileUrl);
        }

        if (!hasStoragePath && workingFile) {
          formData.append("file", workingFile, fileName);
        }

        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => {
          console.warn("[extraction] Frontend timeout fired; aborting request", {
            paperId: paper.id,
            timeout: PIPELINE_TIMEOUT_LABEL
          });
          controller.abort();
        }, PIPELINE_TIMEOUT_MS);

        let response: Response;

        try {
          response = await fetch("/api/extract-text", {
            method: "POST",
            body: formData,
            signal: controller.signal
          });
        } catch (fetchError) {
          window.clearTimeout(timeoutId);
          const isAbort = fetchError instanceof DOMException && fetchError.name === "AbortError";
          if (isAbort) {
            throw new Error("PDF extraction timed out. Please try again.");
          }
          throw fetchError;
        } finally {
          window.clearTimeout(timeoutId);
        }

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
          return null;
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
        return payload;
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
        return null;
      }
    },
    []
  );

  const runSimilarPapers = useCallback(
    async (
      paper: UploadedPaper,
      extraction: ExtractedText,
      claims: ClaimsAnalysisState
    ): Promise<SimilarPapersResult | null> => {
      if (!paper || isMockPaper(paper) || !extraction || typeof extraction.text !== "string" || extraction.text.trim().length === 0) {
        return null;
      }

      // REQUIRE claims to be successful
      if (!claims || claims.status !== "success") {
        console.error("[similar-papers] Claims are required but not available", {
          paperId: paper.id,
          claimsStatus: claims?.status
        });
        setSimilarPapersStates((prev) => ({
          ...prev,
          [paper.id]: {
            status: "error",
            message: "Claims analysis is required. Please wait for claims to complete or try uploading again."
          }
        }));
        return null;
      }

      console.log("[similar-papers] starting fetch with claims", {
        paperId: paper.id,
        textLength: extraction.text.length,
        hasClaimsText: Boolean(claims.text),
        hasClaimsStructured: Boolean(claims.structured)
      });

      setSimilarPapersStates((prev) => ({
        ...prev,
        [paper.id]: { status: "loading" }
      }));

      try {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => {
          console.warn("[similar-papers] Frontend timeout fired; aborting request", {
            paperId: paper.id,
            timeout: PIPELINE_TIMEOUT_LABEL
          });
          controller.abort();
        }, PIPELINE_TIMEOUT_MS);

        const authors = extractAuthorsFromInfo(extraction.info);
        const abstract = extractAbstractFromInfo(extraction.info);
        const metadataTitle =
          extraction.info && typeof extraction.info.Title === "string" && extraction.info.Title.trim().length > 0
            ? extraction.info.Title.trim()
            : null;

        let response: Response;

        try {
          console.log("[similar-papers] Sending fetch request to /api/similar-papers", {
            paperId: paper.id,
            hasTitle: Boolean(metadataTitle ?? paper.name),
            hasDoi: Boolean(paper.doi),
            hasAuthors: Boolean(authors),
            timeout: PIPELINE_TIMEOUT_LABEL
          });
          response = await fetch("/api/similar-papers", {
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
              },
              claims: {
                text: claims.text,
                structured: claims.structured
              }
            }),
            signal: controller.signal
          });
          console.log("[similar-papers] Fetch request completed", {
            paperId: paper.id,
            status: response.status,
            statusText: response.statusText,
            ok: response.ok
          });
        } catch (fetchError) {
          window.clearTimeout(timeoutId);
          const isAbortError = fetchError instanceof DOMException && fetchError.name === "AbortError";
          console.error("[similar-papers] Fetch failed", {
            paperId: paper.id,
            isAbortError,
            error: fetchError instanceof Error ? fetchError.message : String(fetchError)
          });
          throw fetchError;
        } finally {
          window.clearTimeout(timeoutId);
        }

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

        const payload = (await response.json()) as { text?: string | null; structured?: SimilarPapersStructured | null };
        const outputText = typeof payload?.text === "string" ? payload.text.trim() : "";

        if (!outputText) {
          throw new Error("Similar paper response did not include text.");
        }

        const rawStructured =
          payload?.structured && typeof payload.structured === "object"
            ? (payload.structured as SimilarPapersStructured)
            : undefined;
        const structuredData = ensureSourcePaperInSimilarStructured(paper, rawStructured);

        console.log("[similar-papers] fetch success", {
          paperId: paper.id,
          textPreview: outputText.slice(0, 120),
          hasStructured: Boolean(structuredData)
        });

        writeCachedState(paper.id, "similarPapers", { text: outputText, structured: structuredData });

        if (paper.storagePath && supabase && user) {
          saveSimilarPapersToStorage({
            client: supabase,
            userId: user.id,
            paperId: paper.id,
            storagePath: paper.storagePath,
            similarData: { text: outputText, structured: structuredData }
          }).catch((error) => {
            console.error("[similar-papers] failed to save to storage", error);
          });
        }

        const result: SimilarPapersResult = {
          text: outputText,
          ...(structuredData ? { structured: structuredData } : {})
        };

        setSimilarPapersStates((prev) => ({
          ...prev,
          [paper.id]: {
            status: "success",
            ...result
          }
        }));
        return result;
      } catch (error) {
        const isAbort = error instanceof DOMException && error.name === "AbortError";
        const message =
          isAbort
            ? "Similar papers took too long to respond. Please try again in a moment."
            : error instanceof Error && error.message
              ? error.message
              : "Failed to fetch similar papers.";

        console.error("[similar-papers] fetch error", {
          paperId: paper.id,
          isAbort,
          errorMessage: message,
          errorType: error?.constructor?.name,
          error
        });

        setSimilarPapersStates((prev) => ({
          ...prev,
          [paper.id]: {
            status: "error",
            message
          }
        }));
        return null;
      }
    },
    [supabase, user]
  );

  const runPatents = useCallback(
    async (
      paper: UploadedPaper,
      extraction: ExtractedText,
      claims: ClaimsAnalysisState
    ): Promise<PatentsResult | null> => {
      if (!paper || isMockPaper(paper) || !extraction || typeof extraction.text !== "string" || extraction.text.trim().length === 0) {
        return null;
      }

      if (!claims || claims.status !== "success") {
        console.error("[patents] Claims are required but not available", {
          paperId: paper.id,
          claimsStatus: claims?.status
        });
        setPatentsStates((prev) => ({
          ...prev,
          [paper.id]: {
            status: "error",
            message: "Claims analysis is required before running patent search. Please wait for claims to finish."
          }
        }));
        return null;
      }

      console.log("[patents] starting fetch", {
        paperId: paper.id,
        hasClaimsText: Boolean(claims.text),
        hasClaimsStructured: Boolean(claims.structured)
      });

      setPatentsStates((prev) => ({
        ...prev,
        [paper.id]: { status: "loading" }
      }));

      try {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => {
          console.warn("[patents] Frontend timeout fired; aborting request", {
            paperId: paper.id,
            timeout: PIPELINE_TIMEOUT_LABEL
          });
          controller.abort();
        }, PIPELINE_TIMEOUT_MS);

        const authors = extractAuthorsFromInfo(extraction.info);
        const abstract = extractAbstractFromInfo(extraction.info);
        const metadataTitle =
          extraction.info && typeof extraction.info.Title === "string" && extraction.info.Title.trim().length > 0
            ? extraction.info.Title.trim()
            : null;

        let response: Response;

        try {
          response = await fetch("/api/patents", {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              paper: {
                title: metadataTitle ?? paper.name ?? null,
                doi: paper.doi ?? null,
                authors: authors ?? null,
                abstract: abstract ?? null
              },
              claims: {
                text: claims.text,
                structured: claims.structured
              }
            }),
            signal: controller.signal
          });
        } catch (fetchError) {
          window.clearTimeout(timeoutId);
          const isAbort = fetchError instanceof DOMException && fetchError.name === "AbortError";
          if (isAbort) {
            throw new Error("Patent search timed out. Please try again.");
          }
          throw fetchError;
        } finally {
          window.clearTimeout(timeoutId);
        }

        if (!response.ok) {
          let message = "Failed to fetch patent data.";
          try {
            const errorPayload = await response.json();
            if (typeof errorPayload?.error === "string") {
              message = errorPayload.error;
            }
          } catch (parseError) {
            console.warn("[patents] error payload parsing failed", parseError);
          }
          throw new Error(message);
        }

        const payload = (await response.json()) as { text?: string | null; structured?: PatentsStructured | null };
        const text = typeof payload?.text === "string" ? payload.text.trim() : "";
        const structuredData = payload?.structured ? normalizePatentsStructured(payload.structured) : undefined;

        if (!text && !structuredData) {
          throw new Error("Patent response did not include notes or structured data.");
        }

        console.log("[patents] fetch success", {
          paperId: paper.id,
          hasText: Boolean(text),
          patentsCount: structuredData?.patents?.length ?? 0
        });

        writeCachedState(paper.id, "patents", {
          ...(text ? { text } : {}),
          ...(structuredData ? { structured: structuredData } : {})
        });

        if (paper.storagePath && supabase && user) {
          savePatentsToStorage({
            client: supabase,
            userId: user.id,
            paperId: paper.id,
            storagePath: paper.storagePath,
            patentsData: {
              ...(text ? { text } : {}),
              ...(structuredData ? { structured: structuredData } : {})
            }
          }).catch((error) => {
            console.error("[patents] failed to save to storage", error);
          });
        }

        const result: PatentsResult = {
          ...(text ? { text } : {}),
          ...(structuredData ? { structured: structuredData } : {})
        };

        setPatentsStates((prev) => ({
          ...prev,
          [paper.id]: {
            status: "success",
            ...result
          }
        }));
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to fetch patent data.";
        console.error("[patents] fetch error", {
          paperId: paper.id,
          error
        });

        setPatentsStates((prev) => ({
          ...prev,
          [paper.id]: {
            status: "error",
            message
          }
        }));
        return null;
      }
    },
    [supabase, user]
  );

  const runVerifiedClaims = useCallback(
    async (
      paper: UploadedPaper,
      claims: ClaimsAnalysisState,
      similar: SimilarPapersState,
      groups: ResearchGroupsState,
      patents: PatentsState,
      theses: ResearcherThesesState | undefined
    ): Promise<VerifiedClaimsResult | null> => {
      if (!paper || isMockPaper(paper)) {
        return null;
      }

      if (!claims || claims.status !== "success") {
        console.error("[verified-claims] Claims are required but not available", {
          paperId: paper.id,
          claimsStatus: claims?.status
        });
        setVerifiedClaimsStates((prev) => ({
          ...prev,
          [paper.id]: {
            status: "error",
            message: "Claims analysis is required before running verification."
          }
        }));
        return null;
      }

      if (!similar || similar.status !== "success") {
        console.error("[verified-claims] Similar papers are required but not available", {
          paperId: paper.id,
          similarStatus: similar?.status
        });
        return null;
      }

      if (!groups || groups.status !== "success") {
        console.error("[verified-claims] Research groups are required but not available", {
          paperId: paper.id,
          groupsStatus: groups?.status
        });
        return null;
      }

      if (!patents || patents.status !== "success") {
        console.error("[verified-claims] Patents are required but not available", {
          paperId: paper.id,
          patentsStatus: patents?.status
        });
        return null;
      }

      console.log("[verified-claims] starting fetch", {
        paperId: paper.id,
        hasClaimsText: Boolean(claims.text),
        hasSimilarText: Boolean(similar.text),
        hasGroupsText: Boolean(groups.text),
        hasPatentsText: Boolean(patents.text)
      });

      setVerifiedClaimsStates((prev) => ({
        ...prev,
        [paper.id]: { status: "loading" }
      }));

      try {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => {
          console.warn("[verified-claims] Frontend timeout fired; aborting request", {
            paperId: paper.id,
            timeout: PIPELINE_TIMEOUT_LABEL
          });
          controller.abort();
        }, PIPELINE_TIMEOUT_MS);

        let response: Response;

        try {
          response = await fetch("/api/verified-claims", {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              paper: {
                title: paper.name ?? null,
                doi: paper.doi ?? null
              },
              claims: {
                text: claims.text ?? null,
                structured: claims.structured ?? null
              },
              similarPapers: {
                text: similar.text ?? null,
                structured: similar.structured ?? null
              },
              researchGroups: {
                text: groups.text ?? null,
                structured: groups.structured ?? null
              },
              theses:
                theses && theses.status === "success"
                  ? {
                      text: theses.text ?? null,
                      structured: theses.researchers ?? null
                    }
                  : null,
              patents: {
                text: patents.text ?? null,
                structured: patents.structured ?? null
              }
            }),
            signal: controller.signal
          });
        } catch (fetchError) {
          window.clearTimeout(timeoutId);
          const isAbort = fetchError instanceof DOMException && fetchError.name === "AbortError";
          if (isAbort) {
            throw new Error("Verified claims analysis timed out. Please try again.");
          }
          throw fetchError;
        } finally {
          window.clearTimeout(timeoutId);
        }

        if (!response.ok) {
          let message = "Failed to verify claims.";
          try {
            const errorPayload = await response.json();
            if (typeof errorPayload?.error === "string") {
              message = errorPayload.error;
            }
          } catch (parseError) {
            console.warn("[verified-claims] error payload parsing failed", parseError);
          }
          throw new Error(message);
        }

        const payload = (await response.json()) as { text?: string | null; structured?: VerifiedClaimsStructured | null };
        const text = typeof payload?.text === "string" ? payload.text.trim() : "";
        const structuredData = payload?.structured ? normalizeVerifiedClaimsStructured(payload.structured) : undefined;

        if (!text && !structuredData) {
          throw new Error("Verified claims response did not include notes or structured data.");
        }

        console.log("[verified-claims] fetch success", {
          paperId: paper.id,
          hasText: Boolean(text),
          claimsCount: structuredData?.claims?.length ?? 0
        });

        writeCachedState(paper.id, "verifiedClaims", {
          ...(text ? { text } : {}),
          ...(structuredData ? { structured: structuredData } : {})
        });

        if (paper.storagePath && supabase && user) {
          saveVerifiedClaimsToStorage({
            client: supabase,
            userId: user.id,
            paperId: paper.id,
            storagePath: paper.storagePath,
            verifiedClaimsData: {
              ...(text ? { text } : {}),
              ...(structuredData ? { structured: structuredData } : {})
            }
          }).catch((error) => {
            console.error("[verified-claims] failed to save to storage", error);
          });
        }

        const result: VerifiedClaimsResult = {
          ...(text ? { text } : {}),
          ...(structuredData ? { structured: structuredData } : {})
        };

        setVerifiedClaimsStates((prev) => ({
          ...prev,
          [paper.id]: {
            status: "success",
            ...result
          }
        }));
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to verify claims.";
        console.error("[verified-claims] fetch error", {
          paperId: paper.id,
          error
        });

        setVerifiedClaimsStates((prev) => ({
          ...prev,
          [paper.id]: {
            status: "error",
            message
          }
        }));
        return null;
      }
    },
    [supabase, user]
  );

  const runClaimsGeneration = useCallback(
    async (paper: UploadedPaper, extraction: ExtractedText): Promise<ClaimsGenerationResult | null> => {
      if (!paper || isMockPaper(paper) || !extraction || typeof extraction.text !== "string" || extraction.text.trim().length === 0) {
        return null;
      }

      if (!user) {
        console.warn("[claims-generation] User session missing; skip generation");
        return null;
      }

      const canPersistClaims = Boolean(supabase);

      console.log("[claims-generation] starting generation", {
        paperId: paper.id,
        textLength: extraction.text.length
      });

      setClaimsStates((prev) => ({
        ...prev,
        [paper.id]: { status: "loading" }
      }));

      try {
        const authors = extractAuthorsFromInfo(extraction.info);
        const metadataTitle =
          extraction.info && typeof extraction.info.Title === "string" && extraction.info.Title.trim().length > 0
            ? extraction.info.Title.trim()
            : null;

        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => {
          console.warn("[claims-generation] Frontend timeout fired; aborting request", {
            paperId: paper.id,
            timeout: PIPELINE_TIMEOUT_LABEL
          });
          controller.abort();
        }, PIPELINE_TIMEOUT_MS);

        let response: Response;

        try {
          response = await fetch("/api/generate-claims", {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              text: extraction.text,
              paper: {
                title: metadataTitle ?? paper.name ?? null,
                doi: paper.doi ?? null,
                authors: Array.isArray(authors) ? authors.join(", ") : null
              }
            }),
            signal: controller.signal
          });
        } catch (fetchError) {
          window.clearTimeout(timeoutId);
          const isAbort = fetchError instanceof DOMException && fetchError.name === "AbortError";
          if (isAbort) {
            throw new Error("Claims generation timed out. Please try again.");
          }
          throw fetchError;
        } finally {
          window.clearTimeout(timeoutId);
        }

        if (!response.ok) {
          let message = "Failed to generate claims.";
          try {
            const errorPayload = await response.json();
            if (typeof errorPayload?.error === "string") {
              message = errorPayload.error;
            }
          } catch (parseError) {
            console.warn("[claims-generation] error payload parsing failed", parseError);
          }
          throw new Error(message);
        }

        const payload = (await response.json()) as { text?: string | null; structured?: any };
        const outputText = typeof payload?.text === "string" ? payload.text.trim() : "";
        const structured = payload?.structured || null;

        if (!outputText && !structured) {
          throw new Error("Claims response did not include text or structured data.");
        }

        console.log("[claims-generation] generation success", {
          paperId: paper.id,
          hasText: Boolean(outputText),
          hasStructured: Boolean(structured)
        });

        const result: ClaimsGenerationResult = {
          ...(outputText ? { text: outputText } : {}),
          ...(structured ? { structured } : {})
        };

        // Save claims to Supabase storage
        if (paper.storagePath && canPersistClaims && supabase) {
          try {
            await saveClaimsToStorage({
              client: supabase,
              userId: user.id,
              paperId: paper.id,
              storagePath: paper.storagePath,
              claimsData: result
            });
            console.log("[claims-generation] saved to storage", { paperId: paper.id });
          } catch (storageError) {
            console.error("[claims-generation] failed to save to storage", storageError);
            // Continue even if storage fails
          }
        }

        setClaimsStates((prev) => ({
          ...prev,
          [paper.id]: {
            status: "success",
            ...result
          }
        }));
        return result;
      } catch (error) {
        const message =
          error instanceof Error && error.message ? error.message : "Failed to generate claims.";

        console.error("[claims-generation] generation error", {
          paperId: paper.id,
          error
        });

        setClaimsStates((prev) => ({
          ...prev,
          [paper.id]: {
            status: "error",
            message
          }
        }));
        return null;
      }
    },
    [supabase, user]
  );

  const runResearcherTheses = useCallback(
    async (
      paper: UploadedPaper,
      researchGroupsStructured: ResearchGroupPaperEntry[] | undefined
    ): Promise<ResearcherThesesResult | null> => {
      if (!paper || isMockPaper(paper)) {
        return null;
      }

      if (!researchGroupsStructured || researchGroupsStructured.length === 0) {
        setResearchThesesStates((prev) => ({
          ...prev,
          [paper.id]: {
            status: "error",
            message: "Research groups data is required for researcher theses lookup.",
            deepDives:
              prev[paper.id]?.status === "success" ? prev[paper.id].deepDives : undefined
          }
        }));
        return null;
      }

      console.log("[researcher-theses] starting fetch", {
        paperId: paper.id,
        papers: researchGroupsStructured.length
      });

      setResearchThesesStates((prev) => ({
        ...prev,
        [paper.id]: {
          status: "loading",
          deepDives:
            prev[paper.id]?.status === "success"
              ? prev[paper.id].deepDives
              : prev[paper.id]?.deepDives
        }
      }));

      try {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => {
          console.warn("[researcher-theses] Frontend timeout fired; aborting request", {
            paperId: paper.id,
            timeout: PIPELINE_TIMEOUT_LABEL
          });
          controller.abort();
        }, PIPELINE_TIMEOUT_MS);

        let response: Response;

        try {
          response = await fetch("/api/researcher-theses", {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              researchGroups: {
                structured: {
                  papers: researchGroupsStructured
                }
              }
            }),
            signal: controller.signal
          });
        } catch (fetchError) {
          window.clearTimeout(timeoutId);
          const isAbort = fetchError instanceof DOMException && fetchError.name === "AbortError";
          if (isAbort) {
            throw new Error("Researcher theses lookup timed out. Please try again.");
          }
          throw fetchError;
        } finally {
          window.clearTimeout(timeoutId);
        }

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
          structured?: { researchers?: ResearcherThesisRecord[]; promptNotes?: string | null };
          text?: string | null;
        };

        const structuredResearchers = Array.isArray(payload?.structured?.researchers)
          ? payload.structured.researchers
          : [];

        const researchers = Array.isArray(payload?.researchers)
          ? payload.researchers
          : structuredResearchers;

        const text = typeof payload?.text === "string" ? payload.text.trim() : "";

        console.log("[researcher-theses] fetch success", {
          paperId: paper.id,
          researchers: researchers.length,
          hasText: text.length > 0
        });

        const cachePayload = text.length > 0 ? { researchers, text } : { researchers };
        writeCachedState(paper.id, "theses", cachePayload);

        if (paper.storagePath && supabase && user) {
          saveThesesToStorage({
            client: supabase,
            userId: user.id,
            paperId: paper.id,
            storagePath: paper.storagePath,
            thesesData: cachePayload
          }).catch((error) => {
            console.error("[researcher-theses] failed to save to storage", error);
          });
        }

        const nextDeepDives =
          researchThesesStatesRef.current[paper.id]?.status === "success"
            ? researchThesesStatesRef.current[paper.id].deepDives
            : undefined;

        const result: ResearcherThesesResult = {
          researchers,
          ...(text.length > 0 ? { text } : {}),
          ...(nextDeepDives ? { deepDives: nextDeepDives } : {})
        };

        setResearchThesesStates((prev) => ({
          ...prev,
          [paper.id]: {
            status: "success",
            ...result
          }
        }));
        return result;
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
            message,
            deepDives:
              prev[paper.id]?.status === "success"
                ? prev[paper.id].deepDives
                : prev[paper.id]?.deepDives
          }
        }));
        return null;
      }
    },
    [supabase, user]
  );

  const runResearchGroupContacts = useCallback(
    async (
      paper: UploadedPaper,
      researchText: string,
      researchGroupsStructured: ResearchGroupPaperEntry[] | undefined
    ): Promise<ResearchContactsResult | null> => {
      if (!paper || isMockPaper(paper)) {
        return null;
      }

      const trimmed = researchText.trim();
      if (!trimmed) {
        return null;
      }

      console.log("[research-group-contacts] starting fetch", {
        paperId: paper.id,
        textLength: trimmed.length
      });

      setResearchContactsStates((prev) => ({
        ...prev,
        [paper.id]: { status: "loading" }
      }));

      try {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => {
          console.warn("[research-group-contacts] Frontend timeout fired; aborting request", {
            paperId: paper.id,
            timeout: PIPELINE_TIMEOUT_LABEL
          });
          controller.abort();
        }, PIPELINE_TIMEOUT_MS);

        let response: Response;

        try {
          response = await fetch("/api/research-group-contacts", {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              text: trimmed
            }),
            signal: controller.signal
          });
        } catch (fetchError) {
          window.clearTimeout(timeoutId);
          const isAbort = fetchError instanceof DOMException && fetchError.name === "AbortError";
          if (isAbort) {
            throw new Error("Contact lookup timed out. Please try again.");
          }
          throw fetchError;
        } finally {
          window.clearTimeout(timeoutId);
        }

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

        if (paper.storagePath && supabase && user) {
          saveContactsToStorage({
            client: supabase,
            userId: user.id,
            paperId: paper.id,
            storagePath: paper.storagePath,
            contactsData: { contacts }
          }).catch((error) => {
            console.error("[research-group-contacts] failed to save to storage", error);
          });
        }

        const result: ResearchContactsResult = { contacts };

        setResearchContactsStates((prev) => ({
          ...prev,
          [paper.id]: {
            status: "success",
            ...result
          }
        }));

        return result;
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
      return null;
    }
  }, [supabase, user]);

  const runResearchGroups = useCallback(
    async (
      paper: UploadedPaper,
      extraction: ExtractedText,
      claims: ClaimsAnalysisState,
      similarPapers: SimilarPapersState
    ): Promise<ResearchGroupsResult | null> => {
      if (!paper || isMockPaper(paper) || !extraction?.text) {
        return null;
      }

    // REQUIRE claims to be successful
    if (!claims || claims.status !== "success") {
      console.error("[research-groups] Claims are required but not available", {
        paperId: paper.id,
        claimsStatus: claims?.status
      });
      return null;
    }

    // REQUIRE similar papers to be successful
    if (!similarPapers || similarPapers.status !== "success") {
      console.error("[research-groups] Similar papers are required but not available", {
        paperId: paper.id,
        similarPapersStatus: similarPapers?.status
      });
      return null;
    }

    console.log("[research-groups] starting fetch", {
      paperId: paper.id,
      extractionTextLength: extraction.text.length,
      hasClaimsText: Boolean(claims.text),
      hasSimilarPapersText: Boolean(similarPapers.text)
    });

    setResearchGroupsStates((prev) => ({
      ...prev,
      [paper.id]: { status: "loading" }
    }));

    try {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => {
        console.warn("[research-groups] Frontend timeout fired; aborting request", {
          paperId: paper.id,
          timeout: PIPELINE_TIMEOUT_LABEL
        });
        controller.abort();
      }, PIPELINE_TIMEOUT_MS);

      const authors = extractAuthorsFromInfo(extraction.info);
      const title =
        extraction.info && typeof extraction.info.Title === "string" && extraction.info.Title.trim().length > 0
          ? extraction.info.Title.trim()
          : null;

      let response: Response;

      try {
        response = await fetch("/api/research-groups", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          signal: controller.signal,
          body: JSON.stringify({
            paperId: paper.id,
            paperName: paper.name,
            doi: paper.doi,
            text: extraction.text,
            metadata: {
              pages: extraction.pages,
              info: extraction.info
            },
            paper: {
              title: title ?? paper.name,
              doi: paper.doi,
              authors,
              abstract: extractAbstractFromInfo(extraction.info)
            },
            claims: {
              text: claims.text,
              structured: claims.structured
            },
            similarPapers: similarPapers.text
          })
        });
      } catch (fetchError) {
        window.clearTimeout(timeoutId);
        const isAbort = fetchError instanceof DOMException && fetchError.name === "AbortError";
        if (isAbort) {
          throw new Error("Research groups lookup timed out. Please try again.");
        }
        throw fetchError;
      } finally {
        window.clearTimeout(timeoutId);
      }

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

      const payload = (await response.json()) as {
        text?: string | null;
        structured?: ResearchGroupPaperEntry[] | null;
      };
      const outputText = typeof payload?.text === "string" ? payload.text.trim() : "";

      if (!outputText) {
        throw new Error("Research response did not include text.");
      }

      const structuredData = normalizeResearchGroupsStructured(payload?.structured);

      console.log("[research-groups] fetch success", {
        paperId: paper.id,
        textPreview: outputText.slice(0, 120),
        hasStructured: Boolean(structuredData),
        structuredPapersCount: structuredData?.length ?? 0
      });

      writeCachedState(paper.id, "groups", { text: outputText, structured: structuredData });

      if (paper.storagePath && supabase && user) {
        saveResearchGroupsToStorage({
          client: supabase,
          userId: user.id,
          paperId: paper.id,
          storagePath: paper.storagePath,
          groupsData: { text: outputText, structured: structuredData }
        }).catch((error) => {
          console.error("[research-groups] failed to save to storage", error);
        });
      }

      const result: ResearchGroupsResult = {
        text: outputText,
        ...(structuredData ? { structured: structuredData } : {})
      };

      setResearchGroupsStates((prev) => ({
        ...prev,
        [paper.id]: {
          status: "success",
          ...result
        }
      }));

      return result;
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
      return null;
    }
  }, [supabase, user]);

  const startPipeline = useCallback(
    (paper: UploadedPaper | null, options?: { file?: File; resetFrom?: PipelineStageId }) => {
      if (!paper || isMockPaper(paper)) {
        return Promise.resolve();
      }

      const existingRun = pipelineRunsRef.current.get(paper.id);
      if (existingRun) {
        return existingRun;
      }

      const runPromise = (async () => {
        const forcedStageIndex =
          options?.resetFrom !== undefined ? PIPELINE_STAGE_INDEX[options.resetFrom] : null;

        try {
          let extractionData =
            extractionStatesRef.current[paper.id]?.status === "success"
              ? extractionStatesRef.current[paper.id]!.data
              : null;

          if (!extractionData || (forcedStageIndex !== null && forcedStageIndex <= PIPELINE_STAGE_INDEX.extraction)) {
            extractionData = await runExtraction(paper, options);
            if (!extractionData) {
              return;
            }
          }

          let claimsState = claimsStatesRef.current[paper.id];
          const forceClaims = forcedStageIndex !== null && forcedStageIndex <= PIPELINE_STAGE_INDEX.claims;
          if (!claimsState || claimsState.status !== "success" || forceClaims) {
            if (paper.storagePath && supabase) {
              try {
                const storedClaims = await loadClaimsFromStorage({
                  client: supabase,
                  storagePath: paper.storagePath
                });

                if (storedClaims) {
                  setClaimsStates((prev) => ({
                    ...prev,
                    [paper.id]: {
                      status: "success",
                      text: storedClaims.text,
                      structured: storedClaims.structured
                    }
                  }));
                  claimsState = {
                    status: "success",
                    ...(storedClaims.text ? { text: storedClaims.text } : {}),
                    ...(storedClaims.structured ? { structured: storedClaims.structured } : {})
                  } as ClaimsAnalysisState;
                }
              } catch (error) {
                console.error("[pipeline] failed to load claims from storage", {
                  paperId: paper.id,
                  error
                });
              }
            }

            if (!claimsState || claimsState.status !== "success") {
              const generated = await runClaimsGeneration(paper, extractionData);
              if (!generated) {
                return;
              }
              claimsState = { status: "success", ...generated } as ClaimsAnalysisState;
            }
          }

          if (!claimsState || claimsState.status !== "success") {
            return;
          }

          let similarState = similarPapersStatesRef.current[paper.id];
          const forceSimilar = forcedStageIndex !== null && forcedStageIndex <= PIPELINE_STAGE_INDEX.similarPapers;
          if (!similarState || similarState.status !== "success" || forceSimilar) {
            const similarResult = await runSimilarPapers(paper, extractionData, claimsState);
            if (!similarResult) {
              return;
            }
            similarState = { status: "success", ...similarResult } as SimilarPapersState;
          }

          if (!similarState || similarState.status !== "success") {
            return;
          }

          let groupsState = researchGroupsStatesRef.current[paper.id];
          const forceGroups = forcedStageIndex !== null && forcedStageIndex <= PIPELINE_STAGE_INDEX.researchGroups;
          if (!groupsState || groupsState.status !== "success" || forceGroups) {
            const groupsResult = await runResearchGroups(paper, extractionData, claimsState, similarState);
            if (!groupsResult) {
              return;
            }
            groupsState = { status: "success", ...groupsResult } as ResearchGroupsState;
          }

          if (!groupsState || groupsState.status !== "success") {
            return;
          }

          const contactsState = researchContactsStatesRef.current[paper.id];
          const forceContacts = forcedStageIndex !== null && forcedStageIndex <= PIPELINE_STAGE_INDEX.researchGroups;
          if (!contactsState || contactsState.status !== "success" || forceContacts) {
            await runResearchGroupContacts(paper, groupsState.text, groupsState.structured);
          }

          let thesesState = researchThesesStatesRef.current[paper.id];
          const hasStructuredGroups = Array.isArray(groupsState.structured) && groupsState.structured.length > 0;
          const forceTheses = forcedStageIndex !== null && forcedStageIndex <= PIPELINE_STAGE_INDEX.theses;
          if (hasStructuredGroups && (!thesesState || thesesState.status !== "success" || forceTheses)) {
            const thesesResult = await runResearcherTheses(paper, groupsState.structured);
            if (thesesResult) {
              thesesState = { status: "success", ...thesesResult } as ResearcherThesesState;
            } else {
              thesesState = researchThesesStatesRef.current[paper.id];
            }
          }

          let patentsState = patentsStatesRef.current[paper.id];
          const forcePatents = forcedStageIndex !== null && forcedStageIndex <= PIPELINE_STAGE_INDEX.patents;
          if (!patentsState || patentsState.status !== "success" || forcePatents) {
            const patentsResult = await runPatents(paper, extractionData, claimsState);
            if (!patentsResult) {
              return;
            }
            patentsState = { status: "success", ...patentsResult } as PatentsState;
          }

          if (!patentsState || patentsState.status !== "success") {
            return;
          }

          let verifiedState = verifiedClaimsStatesRef.current[paper.id];
          const forceVerified = forcedStageIndex !== null && forcedStageIndex <= PIPELINE_STAGE_INDEX.verifiedClaims;
          if (!verifiedState || verifiedState.status !== "success" || forceVerified) {
            const thesesForVerified =
              thesesState && thesesState.status === "success" ? thesesState : undefined;
            const verifiedResult = await runVerifiedClaims(
              paper,
              claimsState,
              similarState,
              groupsState,
              patentsState,
              thesesForVerified
            );
            if (!verifiedResult) {
              return;
            }
          }
        } finally {
          pipelineRunsRef.current.delete(paper.id);
        }
      })();

      pipelineRunsRef.current.set(paper.id, runPromise);
      return runPromise;
    },
    [
      runExtraction,
      runClaimsGeneration,
      runSimilarPapers,
      runResearchGroups,
      runResearchGroupContacts,
      runResearcherTheses,
      runPatents,
      runVerifiedClaims,
      supabase
    ]
  );

  // Open sidebar when user logs in
  useEffect(() => {
    if (!prevUserRef.current && user) {
      setSidebarCollapsed(false);
    }
    prevUserRef.current = user;
  }, [user]);

  useEffect(() => {
    if (!activePaper || isMockPaper(activePaper)) {
      return;
    }

    void startPipeline(activePaper);
  }, [activePaper, startPipeline]);

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
      setUploadedPapers(initialMockPapers);
      setActivePaperId(defaultActivePaperId);
      similarStorageFetchesRef.current.clear();
      similarStorageResolvedRef.current.clear();
      researchGroupsStorageFetchesRef.current.clear();
      setUploadStatusMessage(null);
      setUploadErrorMessage(null);
      setExtractionStates(defaultActivePaperId ? { [defaultActivePaperId]: initialExtractionState } : {});
      setClaimsStates(defaultActivePaperId ? { [defaultActivePaperId]: initialClaimsState } : {});
      setSimilarPapersStates(defaultActivePaperId ? { [defaultActivePaperId]: initialSimilarState } : {});
      setPatentsStates(defaultActivePaperId ? { [defaultActivePaperId]: initialPatentsState } : {});
      setVerifiedClaimsStates(
        defaultActivePaperId ? { [defaultActivePaperId]: initialVerifiedClaimsState } : {}
      );
      setResearchGroupsStates(
        defaultActivePaperId ? { [defaultActivePaperId]: initialResearchGroupsState } : {}
      );
      setResearchContactsStates(
        defaultActivePaperId ? { [defaultActivePaperId]: initialResearchContactsState } : {}
      );
      setResearchThesesStates(
        defaultActivePaperId ? { [defaultActivePaperId]: initialResearchThesesState } : {}
      );
      return;
    }

    setUploadedPapers((prev) => {
      if (!prev.some((paper) => isMockPaper(paper))) {
        return prev;
      }
      return prev.filter((paper) => !isMockPaper(paper));
    });
    for (const id of MOCK_LIBRARY_ENTRY_IDS) {
      similarStorageFetchesRef.current.delete(id);
      similarStorageResolvedRef.current.delete(id);
      similarPapersGenerationRef.current.delete(id);
      researchGroupsStorageFetchesRef.current.delete(id);
      researchGroupsGenerationRef.current.delete(id);
    }
    setActivePaperId((prev) => (prev && MOCK_LIBRARY_ENTRY_IDS_SET.has(prev) ? null : prev));
    setExtractionStates((prev) => removeMockState(prev));
    setClaimsStates((prev) => removeMockState(prev));
    setSimilarPapersStates((prev) => removeMockState(prev));
    setResearchGroupsStates((prev) => removeMockState(prev));
    setResearchContactsStates((prev) => removeMockState(prev));
    setResearchThesesStates((prev) => removeMockState(prev));

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

        setExtractionStates((prev) => removeMockState(prev));
        setClaimsStates((prev) => removeMockState(prev));
        setSimilarPapersStates((prev) => removeMockState(prev));
        setPatentsStates((prev) => removeMockState(prev));
        setVerifiedClaimsStates((prev) => removeMockState(prev));
        setResearchGroupsStates((prev) => removeMockState(prev));
        setResearchContactsStates((prev) => removeMockState(prev));
        setResearchThesesStates((prev) => removeMockState(prev));

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
          void startPipeline(nextPaper, { file });
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
          void startPipeline(nextPaper, { file });
        }
      } catch (error) {
        console.error("Failed to process upload", error);
        const parsedError = parseUploadError(error);
        setUploadErrorMessage(parsedError.message);
      } finally {
        setIsSavingPaper(false);
      }
    },
    [isSavingPaper, open, setActiveTab, startPipeline, supabase, user]
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

    // Clear the generation tracking so retry can proceed
    similarPapersGenerationRef.current.delete(activePaper.id);
    void startPipeline(activePaper, { resetFrom: "similarPapers" });
  }, [activePaper, startPipeline]);

  const handleRetryResearchGroups = useCallback(() => {
    if (!activePaper) {
      return;
    }

    // Clear the generation tracking so retry can proceed
    researchGroupsGenerationRef.current.delete(activePaper.id);
    void startPipeline(activePaper, { resetFrom: "researchGroups" });
  }, [activePaper, startPipeline]);

  const handleRetryPatents = useCallback(() => {
    if (!activePaper) {
      return;
    }

    patentsGenerationRef.current.delete(activePaper.id);
    void startPipeline(activePaper, { resetFrom: "patents" });
  }, [activePaper, startPipeline]);

  const handleRetryVerifiedClaims = useCallback(() => {
    if (!activePaper) {
      return;
    }

    verifiedClaimsGenerationRef.current.delete(activePaper.id);
    void startPipeline(activePaper, { resetFrom: "verifiedClaims" });
  }, [activePaper, startPipeline]);

  const handleRetryClaims = useCallback(() => {
    if (!activePaper) {
      return;
    }

    // Clear claims state to trigger re-generation
    setClaimsStates((prev) => {
      const next = { ...prev };
      delete next[activePaper.id];
      return next;
    });

    void startPipeline(activePaper, { resetFrom: "claims" });
  }, [activePaper, setClaimsStates, startPipeline]);

  const handleRetryTheses = useCallback(() => {
    if (!activePaper) {
      return;
    }

    // Clear theses state to trigger re-generation
    setResearchThesesStates((prev) => {
      const next = { ...prev };
      delete next[activePaper.id];
      return next;
    });

    void startPipeline(activePaper, { resetFrom: "theses" });
  }, [activePaper, setResearchThesesStates, startPipeline]);

  const handleDeletePaper = useCallback(
    async (paperId: string) => {
      if (MOCK_LIBRARY_ENTRY_IDS_SET.has(paperId)) {
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

        // Clear refs for this paper
        similarStorageFetchesRef.current.delete(paperId);
        similarStorageResolvedRef.current.delete(paperId);
        similarPapersGenerationRef.current.delete(paperId);
        patentsStorageFetchesRef.current.delete(paperId);
        patentsStorageResolvedRef.current.delete(paperId);
        patentsGenerationRef.current.delete(paperId);
        verifiedClaimsStorageFetchesRef.current.delete(paperId);
        verifiedClaimsStorageResolvedRef.current.delete(paperId);
        verifiedClaimsGenerationRef.current.delete(paperId);
        researchGroupsStorageFetchesRef.current.delete(paperId);
        researchGroupsGenerationRef.current.delete(paperId);
        contactsStorageFetchesRef.current.delete(paperId);
        thesesStorageFetchesRef.current.delete(paperId);
        thesesStorageResolvedRef.current.delete(paperId);

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

  // Determine which pipeline step is currently loading for sequential countdown
  const getCurrentLoadingStep = (): string | null => {
    if (!activePaper || isMockPaper(activePaper)) return null;
    if (!activeExtraction || activeExtraction.status === "loading") return "extraction";
    if (!activeClaimsState || activeClaimsState.status === "loading") return "claims";
    if (!activeSimilarPapersState || activeSimilarPapersState.status === "loading") return "similarPapers";
    if (!activeResearchGroupState || activeResearchGroupState.status === "loading") return "researchGroups";
    if (!activeResearchThesesState || activeResearchThesesState.status === "loading") return "theses";
    if (!activePatentsState || activePatentsState.status === "loading") return "patents";
    if (!activeVerifiedClaimsState || activeVerifiedClaimsState.status === "loading") return "verifiedClaims";
    return null;
  };

  const currentLoadingStep = getCurrentLoadingStep();
  const countdownKey = activePaper && currentLoadingStep ? `${activePaper.id}-${currentLoadingStep}` : "";
  const pipelineCountdown = useCountdown(PIPELINE_TIMEOUT_MS, Boolean(currentLoadingStep), countdownKey);

  const activePipelineStageId: PipelineStageId | null = pipelineStages?.find((stage) => stage.status === "loading")?.id
    ?? pipelineStages?.find((stage) => stage.status === "error")?.id
    ?? null;

  const pipelineCountdownDisplay =
    activePipelineStageId && pipelineStages?.some((stage) => stage.id === activePipelineStageId && stage.status === "loading")
      ? pipelineCountdown
      : undefined;

  const handleStageSelect = useCallback(
    (stageId: PipelineStageId) => {
      const targetTab = PIPELINE_STAGE_TO_TAB[stageId];
      if (!targetTab) {
        return;
      }
      setActiveTab(targetTab);
    },
    [setActiveTab]
  );

  const isStageInteractive = useCallback(
    (stageId: PipelineStageId) => Boolean(PIPELINE_STAGE_TO_TAB[stageId]),
    []
  );

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

    if (activeTab === "claims") {
      return (
        <ClaimsPanel
          paper={activePaper}
          extraction={activeExtraction}
          state={activeClaimsState}
          onRetry={handleRetryClaims}
          countdown={pipelineCountdown}
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
          claimsState={activeClaimsState}
          countdown={pipelineCountdown}
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
          claimsState={activeClaimsState}
          similarState={activeSimilarPapersState}
          countdown={pipelineCountdown}
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
            isActivePaperMock
              ? MOCK_RESEARCH_GROUPS_STRUCTURED
              : activeResearchGroupState?.status === "success"
                ? activeResearchGroupState.structured
                : undefined
          }
          deepDives={
            isActivePaperMock
              ? MOCK_RESEARCH_THESES_DEEP_DIVES
              : activeResearchThesesState?.status === "success"
                ? activeResearchThesesState.deepDives
                : undefined
          }
          countdown={pipelineCountdown}
          onRetry={handleRetryTheses}
        />
      );
    }

    if (activeTab === "experts") {
      return <ExpertNetworkPanel paper={activePaper} isMock={Boolean(isActivePaperMock)} />;
    }

    if (activeTab === "patents") {
      return (
        <PatentsPanel
          extraction={activeExtraction}
          state={activePatentsState}
          paper={activePaper}
          isMock={Boolean(isActivePaperMock)}
          claimsState={activeClaimsState}
          countdown={pipelineCountdown}
          onRetry={handleRetryPatents}
        />
      );
    }

    if (activeTab === "verifiedClaims") {
      return (
        <VerifiedClaimsPanel
          state={activeVerifiedClaimsState}
          isMock={Boolean(isActivePaperMock)}
          claimsState={activeClaimsState}
          similarState={activeSimilarPapersState}
          groupsState={activeResearchGroupState}
          patentsState={activePatentsState}
          countdown={pipelineCountdown}
          onRetry={handleRetryVerifiedClaims}
        />
      );
    }

    return <ExtractionDebugPanel state={activeExtraction} paper={activePaper} countdown={pipelineCountdown} />;
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
          {pipelineStages && activePaper && !isMockPaper(activePaper) && (
            <PipelineStageTracker
              stages={pipelineStages}
              activeStageId={activePipelineStageId}
              countdown={pipelineCountdownDisplay}
              onStageSelect={handleStageSelect}
              isStageInteractive={isStageInteractive}
            />
          )}
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
