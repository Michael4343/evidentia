"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { AppSidebar } from "@/components/app-sidebar";
import { PaperTabNav } from "@/components/paper-tab-nav";
import { PdfViewer } from "@/components/pdf-viewer";
import { UploadDropzone } from "@/components/upload-dropzone";
import { MockSimilarPapersShowcase } from "@/components/mock-similar-papers-showcase";
import { MockAuthorContactsShowcase } from "@/components/mock-author-contacts-showcase";
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

interface AuthorEntry {
  name: string;
  email: string | null;
  role: string | null;
  orcid: string | null;
  profiles: Array<{ platform: string; url: string }>;
}

interface AuthorContactsPaperEntry {
  title: string;
  identifier: string | null;
  authors: AuthorEntry[];
}

// Legacy interface for backwards compatibility
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

const MOCK_AUTHOR_CONTACTS_STRUCTURED: AuthorContactsPaperEntry[] | undefined = Array.isArray(
  (DEFAULT_ENTRY_RAW?.authorContacts as any)?.structured?.papers
)
  ? ((DEFAULT_ENTRY_RAW.authorContacts as any).structured.papers as AuthorContactsPaperEntry[])
  : undefined;

const PIPELINE_TIMEOUT_MS = 600_000; // 10 minutes
const PIPELINE_TIMEOUT_LABEL = `${PIPELINE_TIMEOUT_MS / 1000}s`;

const CLAIM_EVIDENCE_SOURCE_ALIASES = new Map<string, string>([
  ["similar paper", "Similar Paper"],
  ["similar papers", "Similar Paper"],
  ["paper", "Similar Paper"],
  ["research group", "Research Group"],
  ["research groups", "Research Group"],
  ["group", "Research Group"],
  ["patent", "Patent"],
  ["patents", "Patent"],
  ["thesis", "Thesis"],
  ["phd thesis", "Thesis"],
  ["theses", "Thesis"]
]);

const CLAIM_EVIDENCE_PLACEHOLDER_PATTERN = /^(?:none(?:\s+found)?|no\s+(?:relevant\s+)?(?:evidence|contradictions?)|not\s+(?:provided|reported)|n\/?a)$/i;

function canonicaliseClaimEvidenceSource(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.replace(/[\[\]]/g, "").trim();
  if (!normalized) {
    return null;
  }
  const alias = CLAIM_EVIDENCE_SOURCE_ALIASES.get(normalized.toLowerCase());
  if (alias) {
    return alias;
  }
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function stripLeadingClaimEvidenceMarker(value: string): string {
  return value.replace(/^(?:[-*\u2022]+|\d+\.)\s*/, "").trim();
}

function collapseClaimEvidenceWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normaliseClaimEvidenceFields(input: { source: string; title: string; relevance: string }): VerifiedClaimEvidence | null {
  let sourceCandidate = (input.source ?? "").trim();
  let title = (input.title ?? "").trim();
  let relevance = (input.relevance ?? "").trim();

  const bracketMatch = title.match(/^\[(Similar Paper|Research Group|Patent|Thesis)\]\s*/i);
  if (bracketMatch) {
    if (!sourceCandidate) {
      sourceCandidate = bracketMatch[1];
    }
    title = title.slice(bracketMatch[0].length).trim();
  }

  const labelledMatch = title.match(/^(Similar Paper|Research Group|Patent|Thesis)\s*(?:\u2014|\u2013|-|:)\s*/i);
  if (labelledMatch) {
    if (!sourceCandidate) {
      sourceCandidate = labelledMatch[1];
    }
    title = title.slice(labelledMatch[0].length).trim();
  }

  title = stripLeadingClaimEvidenceMarker(title);
  title = collapseClaimEvidenceWhitespace(title);

  if (!title || CLAIM_EVIDENCE_PLACEHOLDER_PATTERN.test(title)) {
    return null;
  }

  let source = canonicaliseClaimEvidenceSource(sourceCandidate);
  if (!source) {
    source = canonicaliseClaimEvidenceSource(bracketMatch?.[1]);
  }
  if (!source && labelledMatch?.[1]) {
    source = canonicaliseClaimEvidenceSource(labelledMatch[1]);
  }
  if (!source) {
    source = "Similar Paper";
  }

  if (relevance) {
    relevance = collapseClaimEvidenceWhitespace(relevance);
  }

  const cleanedRelevance = relevance && !CLAIM_EVIDENCE_PLACEHOLDER_PATTERN.test(relevance) ? relevance : "";

  return {
    source,
    title,
    ...(cleanedRelevance ? { relevance: cleanedRelevance } : {})
  } satisfies VerifiedClaimEvidence;
}

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

type CacheStage =
  | "claims"
  | "similarPapers"
  | "groups"
  | "contacts"
  | "theses"
  | "patents"
  | "verifiedClaims";

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

  const normalizeIdentifier = (value: unknown): string | null => {
    if (typeof value !== "string") {
      return null;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    let lowered = trimmed.toLowerCase();
    if (lowered.startsWith("https://doi.org/")) {
      lowered = lowered.slice("https://doi.org/".length);
    } else if (lowered.startsWith("http://doi.org/")) {
      lowered = lowered.slice("http://doi.org/".length);
    } else if (lowered.startsWith("https://dx.doi.org/")) {
      lowered = lowered.slice("https://dx.doi.org/".length);
    } else if (lowered.startsWith("http://dx.doi.org/")) {
      lowered = lowered.slice("http://dx.doi.org/".length);
    } else if (lowered.startsWith("doi:")) {
      lowered = lowered.slice("doi:".length);
    }

    return lowered;
  };

  const sourceIdentifiers = new Set<string>();
  const pushSourceIdentifier = (value: unknown) => {
    const normalized = normalizeIdentifier(value);
    if (normalized) {
      sourceIdentifiers.add(normalized);
    }
  };

  pushSourceIdentifier(paper.doi);
  pushSourceIdentifier(paper.url);
  pushSourceIdentifier(paper.id);

  const seenIdentifiers = new Set<string>();
  const similarArray = Array.isArray(structured.similarPapers)
    ? structured.similarPapers.filter((entry) => {
        if (!entry) {
          return false;
        }

        const identifiers = [entry.identifier, entry.doi, entry.url]
          .map((value) => normalizeIdentifier(value))
          .filter((value): value is string => Boolean(value));

        if (identifiers.some((id) => sourceIdentifiers.has(id))) {
          return false;
        }

        for (const id of identifiers) {
          if (seenIdentifiers.has(id)) {
            return false;
          }
        }

        identifiers.forEach((id) => seenIdentifiers.add(id));
        return true;
      })
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

    if (structured.sourcePaper?.methodComparison) {
      sourceEntry.methodComparison = structured.sourcePaper.methodComparison;
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

function extractPlainEmail(value: string | null | undefined): string | null {
  if (!value || typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  // Check for markdown link format: [email](mailto:email) or [text](mailto:email)
  const markdownMatch = trimmed.match(/\[([^\]]+)\]\(mailto:([^)]+)\)/);
  if (markdownMatch) {
    // Return the email from the mailto: part (more reliable)
    return markdownMatch[2].trim();
  }

  // Check for plain mailto: links
  const mailtoMatch = trimmed.match(/mailto:([^\s)]+)/);
  if (mailtoMatch) {
    return mailtoMatch[1].trim();
  }

  // Return as-is if it's already a plain email
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeAuthorContactsStructured(raw: unknown): AuthorContactsPaperEntry[] | undefined {
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
      const authors = Array.isArray(entry?.authors)
        ? entry.authors
            .map((author: any) => {
              if (!author || typeof author !== "object") {
                return null;
              }

              const name = typeof author.name === "string" && author.name.trim().length > 0
                ? author.name.trim()
                : "";

              if (!name) {
                return null;
              }

              const email = extractPlainEmail(author.email);
              const role = typeof author.role === "string" && author.role.trim().length > 0
                ? author.role.trim()
                : null;
              const orcid = typeof author.orcid === "string" && author.orcid.trim().length > 0
                ? author.orcid.trim()
                : null;

              const profiles = Array.isArray(author.profiles)
                ? author.profiles
                    .map((profile: any) => {
                      if (!profile || typeof profile !== "object") {
                        return null;
                      }
                      const platform = typeof profile.platform === "string" && profile.platform.trim().length > 0
                        ? profile.platform.trim()
                        : null;
                      const url = typeof profile.url === "string" && profile.url.trim().length > 0
                        ? profile.url.trim()
                        : null;
                      if (!platform || !url) {
                        return null;
                      }
                      return { platform, url };
                    })
                    .filter((p: { platform: string; url: string } | null): p is { platform: string; url: string } => p !== null)
                : [];

              return {
                name,
                email,
                role,
                orcid,
                profiles
              } satisfies AuthorEntry;
            })
            .filter((a: AuthorEntry | null): a is AuthorEntry => a !== null)
        : [];

      const title = typeof entry?.title === "string" ? entry.title : "Untitled paper";
      const identifier = typeof entry?.identifier === "string" ? entry.identifier : null;

      return {
        title,
        identifier,
        authors
      } satisfies AuthorContactsPaperEntry;
    })
    .filter((entry) => entry);
}

function normalizeResearchGroupsStructured(raw: unknown): ResearchGroupPaperEntry[] | AuthorContactsPaperEntry[] | undefined {
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

  // Detect format: check first entry for .authors (new format) vs .groups (old format)
  const firstEntry = candidate[0];
  const hasAuthors = firstEntry && typeof firstEntry === "object" && "authors" in firstEntry;
  const hasGroups = firstEntry && typeof firstEntry === "object" && "groups" in firstEntry;

  // If it has .authors, use the author contacts normalizer
  if (hasAuthors) {
    return normalizeAuthorContactsStructured(raw);
  }

  // Otherwise, use the old research groups normalizer
  if (!hasGroups) {
    // No recognizable format
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

  const extractString = (value: unknown): string | null => {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
    return null;
  };

  const fallbackStringArray = (candidates: unknown[]): string | null => {
    for (const candidate of candidates) {
      const extracted = extractString(candidate);
      if (extracted) {
        return extracted;
      }
    }
    return null;
  };

  let patentNumber = fallbackStringArray([
    (raw as any).patentNumber,
    (raw as any).patentId,
    (raw as any).number,
    (raw as any).publicationNumber,
    (raw as any).applicationNumber
  ]);

  let title = fallbackStringArray([(raw as any).title, (raw as any).name, (raw as any).headline]);
  const assignee = fallbackStringArray([(raw as any).assignee, (raw as any).assigneeName, (raw as any).applicant]);
  const filingDate = extractString((raw as any).filingDate);
  const grantDate = extractString((raw as any).grantDate);
  const summary = fallbackStringArray([(raw as any).abstract, (raw as any).summary, (raw as any).description]);
  let url = extractString((raw as any).url) ?? extractString((raw as any).link);

  if (!patentNumber && url) {
    const match = url.match(/patent\/(.+?)(?:[/?#]|$)/i);
    if (match) {
      patentNumber = match[1];
    }
  }

  if (patentNumber && !url) {
    url = `https://patents.google.com/patent/${patentNumber}`;
  }

  if (!title && summary) {
    title = summary.slice(0, 80);
  }

  if (!patentNumber && !title) {
    return null;
  }

  const overlapRaw = (raw as any).overlapWithPaper ?? raw.overlap ?? raw.claimAlignment;
  let claimIds: string[] = [];
  if (Array.isArray(overlapRaw?.claimIds)) {
    claimIds = overlapRaw.claimIds
      .map((claim: any) => (typeof claim === "string" ? claim.trim() : ""))
      .filter((claim: string) => claim.length > 0);
  } else if (typeof overlapRaw?.claimIds === "string") {
    claimIds = overlapRaw.claimIds
      .split(/[,;\s]+/)
      .map((segment: string) => segment.trim())
      .filter(Boolean);
  } else if (typeof (raw as any).claimsCovered === "string") {
    claimIds = (raw as any).claimsCovered
      .split(/[,;\s]+/)
      .map((segment: string) => segment.trim())
      .filter(Boolean);
  }

  const overlapSummary = (() => {
    const candidates = [
      overlapRaw?.summary,
      overlapRaw?.overlap,
      overlapRaw?.description,
      (raw as any).overlapSummary,
      (raw as any).validationNotes,
      (raw as any).technicalOverlap
    ];
    return fallbackStringArray(candidates);
  })();

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

  const rawObject = raw as { patents?: unknown; promptNotes?: unknown; items?: unknown; results?: unknown };
  const promptNotes = typeof rawObject.promptNotes === "string" && rawObject.promptNotes.trim().length > 0 ? rawObject.promptNotes.trim() : null;
  const patentsArray = Array.isArray(rawObject.patents)
    ? rawObject.patents
    : Array.isArray((rawObject as any).items)
      ? (rawObject as any).items
      : Array.isArray((rawObject as any).results)
        ? (rawObject as any).results
        : [];

  const patents = patentsArray
    .map((entry: any) => normalizePatentEntry(entry))
    .filter((entry: any): entry is PatentEntry => Boolean(entry));

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

  const sourceCandidate = typeof raw.source === "string" ? raw.source : "";
  const titleCandidate = typeof raw.title === "string" ? raw.title : "";
  const relevanceCandidate = typeof raw.relevance === "string" ? raw.relevance : "";

  const normalised = normaliseClaimEvidenceFields({
    source: sourceCandidate,
    title: titleCandidate,
    relevance: relevanceCandidate
  });

  if (!normalised) {
    return null;
  }

  return normalised;
}

function normalizeVerifiedClaimsStructured(raw: unknown): VerifiedClaimsStructured | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }

  const rawObject = raw as { claims?: unknown; overallAssessment?: unknown; promptNotes?: unknown };

  const claimsArray = Array.isArray(rawObject.claims) ? rawObject.claims : [];

  const claims = claimsArray
    .map((entry, index) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const claimIdRaw = typeof (entry as any).claimId === "string" && (entry as any).claimId.trim().length > 0
        ? (entry as any).claimId.trim()
        : null;
      const fallbackClaimId = `C${index + 1}`;
      const originalClaim = typeof (entry as any).originalClaim === "string" && (entry as any).originalClaim.trim().length > 0
        ? (entry as any).originalClaim.trim()
        : null;

      if (!originalClaim) {
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
        claimId: claimIdRaw ?? fallbackClaimId,
        originalClaim,
        verificationStatus,
        supportingEvidence: supportingEvidence as VerifiedClaimEvidence[],
        contradictingEvidence: contradictingEvidence as VerifiedClaimEvidence[],
        ...(verificationSummary ? { verificationSummary } : {}),
        confidenceLevel
      } satisfies VerifiedClaimEntry;
    })
    .filter((entry): entry is VerifiedClaimEntry => Boolean(entry));

  const overallAssessment = typeof rawObject.overallAssessment === "string" && rawObject.overallAssessment.trim().length > 0
    ? rawObject.overallAssessment.trim()
    : undefined;
  const promptNotes = typeof rawObject.promptNotes === "string" && rawObject.promptNotes.trim().length > 0
    ? rawObject.promptNotes.trim()
    : undefined;

  if (claims.length === 0 && !overallAssessment && !promptNotes) {
    return undefined;
  }

  return {
    ...(claims.length > 0 ? { claims } : {}),
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
  role?: string | null;
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
      structured?: ResearchGroupPaperEntry[] | AuthorContactsPaperEntry[];
    }
  | { status: "error"; message: string };

interface SimilarPapersStructured {
  sourcePaper?: {
    summary?: string;
    keyMethodSignals?: string[];
    searchQueries?: string[];
    methodComparison?: {
      sample?: string;
      materials?: string;
      equipment?: string;
      procedure?: string;
      outcomes?: string;
    };
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
    methodOverlap?: string[];
    methodComparison?: {
      sample?: string;
      materials?: string;
      equipment?: string;
      procedure?: string;
      outcomes?: string;
    };
    gaps?: string | null;
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
  structured?: ResearchGroupPaperEntry[] | AuthorContactsPaperEntry[];
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
  | "theses"
  | "patents"
  | "verifiedClaims";

const PIPELINE_STAGE_ORDER: readonly PipelineStageId[] = [
  "extraction",
  "claims",
  "similarPapers",
  "researchGroups",
  "theses",
  "patents",
  "verifiedClaims"
];

const PIPELINE_STAGE_INDEX: Record<PipelineStageId, number> = {
  extraction: 0,
  claims: 1,
  similarPapers: 2,
  researchGroups: 3,
  theses: 4,
  patents: 5,
  verifiedClaims: 6
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

function sanitiseResearcherEmail(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const mailtoMatch = trimmed.match(/mailto:([^\s)>]+)/i);
  if (mailtoMatch && mailtoMatch[1]) {
    return mailtoMatch[1].replace(/[)>]+$/, "").trim().toLowerCase() || null;
  }

  const emailMatch = trimmed.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (emailMatch && emailMatch[0]) {
    return emailMatch[0].trim().toLowerCase();
  }

  return trimmed.includes("@") ? trimmed.toLowerCase() : null;
}

function normaliseResearcherRecords(records: ResearcherThesisRecord[]): ResearcherThesisRecord[] {
  return records.map((record) => ({
    ...record,
    name: record.name?.trim() ?? record.name,
    email: sanitiseResearcherEmail(record.email),
    data_publicly_available:
      record.data_publicly_available &&
      ["yes", "no", "unknown"].includes(record.data_publicly_available.toLowerCase())
        ? (record.data_publicly_available.toLowerCase() as ResearcherThesisRecord["data_publicly_available"])
        : "unknown"
  }));
}

function createResearchThesesStateFromRaw(raw: RawMockLibraryEntry): ResearcherThesesState {
  const text = typeof raw.researcherTheses?.text === "string" ? raw.researcherTheses.text : undefined;
  const researchers = Array.isArray(raw.researcherTheses?.structured?.researchers)
    ? (raw.researcherTheses.structured.researchers as ResearcherThesisRecord[])
    : [];
  const normalisedResearchers = normaliseResearcherRecords(researchers);
  const deepDives = Array.isArray(raw.researcherTheses?.deepDives?.entries)
    ? (raw.researcherTheses.deepDives.entries as ResearcherThesisDeepDive[])
    : undefined;

  return {
    status: "success",
    researchers: normalisedResearchers,
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

const MOCK_RESEARCH_THESES_STRUCTURED_NORMALISED = normaliseResearcherRecords(MOCK_RESEARCH_THESES_STRUCTURED);

const MOCK_RESEARCH_THESES_INITIAL_STATE: ResearcherThesesState =
  MOCK_RESEARCH_THESES_STRUCTURED_NORMALISED.length > 0
    ? {
        status: "success",
        researchers: MOCK_RESEARCH_THESES_STRUCTURED_NORMALISED,
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

  if (!state) {
    if (paper?.source === "remote") {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <div className="rounded-full bg-slate-100 p-3 text-slate-500">📄</div>
          <div className="space-y-1">
            <p className="text-base font-medium text-slate-700">Loaded saved analysis</p>
            <p className="text-sm text-slate-500">Re-run extraction if you need a fresh text snapshot.</p>
          </div>
        </div>
      );
    }
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-slate-300 border-t-primary" />
        <div className="space-y-1">
          <p className="text-base font-medium text-slate-700">Preparing extraction…</p>
          {countdown && <p className="text-xs text-slate-500">{countdown} remaining</p>}
        </div>
      </div>
    );
  }

  if (state.status === "loading") {
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

  // Helper to get evidence strength suffix
  const getStrengthSuffix = (strength?: string) => {
    if (!strength || strength.trim().toLowerCase() === "unclear") return "";
    const normalized = strength.trim();
    return ` (${normalized} confidence)`;
  };

  // Helper to format key numbers inline
  const formatKeyNumbers = (numbers: readonly string[] | string[] | undefined) => {
    if (!numbers || numbers.length === 0) return null;
    return numbers.join(" · ");
  };

  // Group gaps by related claim IDs for integration
  const getGapsForClaim = (claimId: string) => {
    if (!structured?.gaps) return [];
    return structured.gaps.filter(gap =>
      gap.relatedClaimIds && gap.relatedClaimIds.includes(claimId)
    );
  };

  return (
    <div className="space-y-8">
      {hasStructured && (
        <>
          {/* Executive Summary with elegant accent */}
          {Array.isArray(structured?.executiveSummary) && structured.executiveSummary.length > 0 && (
            <section className="bg-gradient-to-r from-blue-50/50 to-slate-50/50 rounded-xl p-6 border border-blue-100/50">
              <p className="text-base leading-relaxed text-slate-700">
                <span className="text-blue-700 font-semibold">At a glance:</span>
                {" "}
                {structured.executiveSummary.join(" ")}
              </p>
            </section>
          )}

          {/* Claims with integrated limitations */}
          {Array.isArray(structured?.claims) && structured.claims.length > 0 && (
            <section className="space-y-6">
              {structured.claims.map((claim) => {
                const claimGaps = getGapsForClaim(claim.id ?? "");
                const keyNumbersText = formatKeyNumbers(claim.keyNumbers ?? []);

                return (
                  <article
                    key={claim.id ?? claim.claim}
                    className="bg-white rounded-xl shadow-lg hover:shadow-xl transition-shadow duration-200 p-8 space-y-5 border border-slate-100"
                  >
                    {/* Claim header */}
                    <div>
                      <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">
                        {claim.id?.replace(/^C(\d+)$/, 'Claim $1') ?? "Claim"}
                      </p>
                      <h4 className="mt-2 text-xl font-bold leading-tight tracking-tight text-slate-900">
                        {claim.claim}
                      </h4>
                    </div>

                    {/* Evidence with blue accent */}
                    {typeof claim.evidenceSummary === "string" && claim.evidenceSummary.trim().length > 0 && (
                      <div className="bg-blue-50/30 rounded-lg p-4 border-l-4 border-blue-400">
                        <p className="text-sm leading-relaxed text-slate-700">
                          <span className="font-semibold text-slate-900">Evidence:</span>
                          {" "}
                          {claim.evidenceSummary}
                          {claim.strength && claim.strength.trim().toLowerCase() !== "unclear" && (
                            <span className="text-blue-700 font-medium">
                              {" "}({claim.strength.trim()} confidence)
                            </span>
                          )}
                        </p>
                      </div>
                    )}

                    {/* Key numbers with subtle background */}
                    {keyNumbersText && (
                      <div className="bg-slate-50 rounded-lg px-4 py-3 border border-slate-200/50">
                        <p className="text-sm font-mono text-slate-600">{keyNumbersText}</p>
                      </div>
                    )}

                    {/* Source */}
                    {typeof claim.source === "string" && claim.source.trim().length > 0 && (
                      <p className="text-sm text-slate-600">
                        <span className="font-medium text-slate-700">Source:</span>
                        {" "}
                        {claim.source}
                      </p>
                    )}

                    {/* Assumptions */}
                    {typeof claim.assumptions === "string" && claim.assumptions.trim().length > 0 && (
                      <p className="text-sm text-slate-600">
                        <span className="font-medium text-slate-700">Assumptions:</span>
                        {" "}
                        {claim.assumptions}
                      </p>
                    )}

                    {/* Integrated limitations with amber accent */}
                    {claimGaps.length > 0 && (
                      <div className="bg-amber-50/40 rounded-lg p-4 border-l-4 border-amber-400">
                        <p className="text-sm font-semibold text-amber-900 mb-2">Limitations:</p>
                        <ul className="space-y-1.5 pl-4 text-sm text-amber-800 list-disc marker:text-amber-500">
                          {claimGaps.map((gap, index) => (
                            <li key={`gap-${claim.id}-${index}`}>
                              {gap.category && gap.category.trim() ? `${gap.category}: ${gap.detail}` : gap.detail}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </article>
                );
              })}
            </section>
          )}

          {/* Study Design - Grouped sections */}
          {Array.isArray(structured?.methodsSnapshot) && structured.methodsSnapshot.length > 0 && (
            <section className="pt-8 border-t border-slate-200 space-y-4">
              <h3 className="text-base font-semibold text-slate-800">Study Design</h3>
              <div className="grid gap-3">
                {structured.methodsSnapshot.map((item, index) => (
                  <div
                    key={`methods-${index}`}
                    className="bg-slate-50/50 rounded-lg p-4 border border-slate-200/50"
                  >
                    <p className="text-sm leading-relaxed text-slate-700">{item}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Risk Assessment - Two-column grid */}
          {Array.isArray(structured?.riskChecklist) && structured.riskChecklist.length > 0 && (
            <section className="pt-8 border-t border-slate-200 space-y-4">
              <h3 className="text-base font-semibold text-slate-800">Risk Assessment</h3>
              <div className="overflow-hidden rounded-lg border border-slate-200">
                <div className="divide-y divide-slate-200">
                  {structured.riskChecklist.map((entry, index) => (
                    <div
                      key={`risk-${index}`}
                      className={`grid grid-cols-1 sm:grid-cols-[2fr,3fr] gap-4 p-4 ${
                        index % 2 === 0 ? 'bg-white' : 'bg-slate-50/30'
                      }`}
                    >
                      <div className="font-medium text-sm text-slate-800">
                        {entry.item}
                      </div>
                      <div className="text-sm text-slate-700 leading-relaxed">
                        {entry.note || entry.status}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          {/* Next Steps - Checklist style */}
          {Array.isArray(structured?.openQuestions) && structured.openQuestions.length > 0 && (
            <section className="pt-8 border-t border-slate-200 space-y-4">
              <h3 className="text-base font-semibold text-slate-800">Next Steps</h3>
              <div className="space-y-2">
                {structured.openQuestions.map((item, index) => (
                  <div
                    key={`next-${index}`}
                    className="flex items-start gap-3 p-3 rounded-lg bg-blue-50/20 border border-blue-100/50 hover:bg-blue-50/30 transition-colors"
                  >
                    <div className="flex-shrink-0 mt-0.5">
                      <svg
                        className="w-5 h-5 text-blue-500"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                      </svg>
                    </div>
                    <p className="text-sm leading-relaxed text-slate-700 flex-1">{item}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Cross-paper comparison (if present) */}
          {Array.isArray(structured?.crossPaperComparison) && structured.crossPaperComparison.length > 0 && (
            <section className="pt-8 border-t border-slate-200 space-y-4">
              <h3 className="text-base font-semibold text-slate-800">Cross-Paper Comparison</h3>
              <ul className="space-y-2 pl-5 text-sm leading-relaxed text-slate-700 list-disc marker:text-slate-400">
                {structured.crossPaperComparison.map((item, index) => (
                  <li key={`cross-${index}`}>{item}</li>
                ))}
              </ul>
            </section>
          )}
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
  const isRemotePaper = paper?.source === "remote";

  if (!paper) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
        <p className="text-base font-medium text-slate-700">Upload a PDF to inspect its claims and evidence.</p>
        <p className="text-sm text-slate-500">We&apos;ll surface the structured claims summary once the analysis runs.</p>
      </div>
    );
  }

  const hasClaimsData = state && state.status === "success";

  if ((!extraction || extraction.status === "loading") && !(isRemotePaper && hasClaimsData)) {
    return <PipelineStagePlaceholder stageId="claims" waitingForStageId="extraction" />;
  }

  if (extraction && extraction.status === "error") {
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

function SimilarPapersStructuredView({ structured, sourceTitle, sourceYear, sourceFileName }: { structured: SimilarPapersStructured; sourceTitle?: string; sourceYear?: string | number; sourceFileName?: string }) {
  const methodRows = [
    { label: "Sample", key: "sample" },
    { label: "Materials", key: "materials" },
    { label: "Equipment", key: "equipment" },
    { label: "Procedure", key: "procedure" },
    { label: "Outcomes", key: "outcomes" }
  ] as const;

  const similarPapers = Array.isArray(structured.similarPapers) ? structured.similarPapers : [];

  // Smart fallback for source paper title
  const cleanFileName = sourceFileName?.replace(/\.pdf$/i, "").trim();
  const displayTitle = sourceTitle || cleanFileName || "Source";
  const sourceTitleNormalized = displayTitle.trim().toLowerCase();

  const normalizeIdentifier = (value: unknown): string | null => {
    if (typeof value !== "string") {
      return null;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    let lowered = trimmed.toLowerCase();
    if (lowered.startsWith("https://doi.org/")) {
      lowered = lowered.slice("https://doi.org/".length);
    } else if (lowered.startsWith("http://doi.org/")) {
      lowered = lowered.slice("http://doi.org/".length);
    } else if (lowered.startsWith("https://dx.doi.org/")) {
      lowered = lowered.slice("https://dx.doi.org/".length);
    } else if (lowered.startsWith("http://dx.doi.org/")) {
      lowered = lowered.slice("http://dx.doi.org/".length);
    } else if (lowered.startsWith("doi:")) {
      lowered = lowered.slice("doi:".length);
    }

    return lowered;
  };

  const seenIdentifiers = new Set<string>();
  const seenTitles = new Set<string>();
  if (sourceTitleNormalized) {
    seenTitles.add(sourceTitleNormalized);
  }

  const dedupedSimilarPapers = similarPapers.filter((paper) => {
    if (!paper) {
      return false;
    }

    const identifiers = [paper.identifier, paper.doi, paper.url]
      .map((value) => normalizeIdentifier(value))
      .filter((value): value is string => Boolean(value));

    if (identifiers.some((id) => seenIdentifiers.has(id))) {
      return false;
    }

    const normalizedTitle = typeof paper.title === "string" ? paper.title.trim().toLowerCase() : "";
    if (normalizedTitle && seenTitles.has(normalizedTitle)) {
      return false;
    }

    identifiers.forEach((id) => seenIdentifiers.add(id));
    if (normalizedTitle) {
      seenTitles.add(normalizedTitle);
    }

    return true;
  });

  if (dedupedSimilarPapers.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-slate-600">No similar papers found in the structured response.</p>
      </div>
    );
  }

  // Build array with source paper first, then similar papers for the table
  type ComparisonPaper = {
    title: string;
    year?: number | null;
    venue?: string | null;
    url?: string | null;
    doi?: string | null;
    methodComparison?: {
      sample?: string;
      materials?: string;
      equipment?: string;
      procedure?: string;
      outcomes?: string;
    };
    isSource?: boolean;
  };

  const comparisonPapers: ComparisonPaper[] = [
    {
      title: displayTitle,
      year: sourceYear as number | null | undefined,
      venue: undefined,
      url: undefined,
      doi: undefined,
      methodComparison: structured.sourcePaper?.methodComparison,
      isSource: true
    },
    ...dedupedSimilarPapers
  ];

  const getMatrixValue = (paper: ComparisonPaper, key: keyof NonNullable<ComparisonPaper["methodComparison"]>) => {
    const value = paper?.methodComparison?.[key];
    if (!value || !value.trim()) {
      return "Not reported";
    }
    return value;
  };

  return (
    <div className="space-y-8">
      {/* At a glance section */}
      {structured.sourcePaper?.summary && (
        <section className="bg-gradient-to-r from-blue-50/50 to-slate-50/50 rounded-xl p-6 border border-blue-100/50">
          <p className="text-base leading-relaxed text-slate-700">
            <span className="text-blue-700 font-semibold">At a glance:</span>{" "}
            {structured.sourcePaper.summary}
          </p>
        </section>
      )}

      {/* Method comparison table */}
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full border-collapse text-sm">
          <thead>
            <tr className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <th className="sticky left-0 z-10 bg-slate-50 px-4 py-3 text-slate-500">Method dimension</th>
              {comparisonPapers.map((paper, index) => {
                const paperUrl = paper.url || (paper.doi ? `https://doi.org/${paper.doi}` : null);
                return (
                  <th key={index} className="px-4 py-3 text-slate-600">
                    <div className="space-y-0.5">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                        Paper #{index + 1}
                      </p>
                      {paperUrl ? (
                        <a
                          href={paperUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sm font-semibold text-blue-600 leading-snug hover:underline transition block"
                        >
                          {paper.title ?? "Untitled"}
                        </a>
                      ) : (
                        <p className="text-sm font-semibold text-slate-900 leading-snug">
                          {paper.title ?? "Untitled"}
                        </p>
                      )}
                      <p className="text-xs text-slate-500">
                        {[paper.year, paper.venue].filter(Boolean).join(" · ") || "Metadata pending"}
                      </p>
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {methodRows.map((row) => (
              <tr key={row.key} className="border-t border-slate-100 align-top">
                <th className="sticky left-0 z-10 bg-white px-4 py-4 text-left text-sm font-medium text-slate-700">
                  {row.label}
                </th>
                {comparisonPapers.map((paper, index) => (
                  <td key={`${index}-${row.key}`} className="px-4 py-4 text-sm leading-relaxed text-slate-700">
                    {getMatrixValue(paper, row.key)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="px-4 pb-4 text-xs text-slate-500">&quot;Not reported&quot; highlights gaps to close before replication or scale-up.</p>
      </div>

      {/* Similar papers cards */}
      <div className="space-y-6">
        {dedupedSimilarPapers.map((paper, index) => {
          const paperUrl = paper.url || (paper.doi ? `https://doi.org/${paper.doi}` : null);
          return (
            <article
              key={paper.identifier ?? index}
              className="bg-white rounded-xl shadow-lg hover:shadow-xl transition-shadow duration-200 p-8 space-y-5 border border-slate-100"
            >
              {/* Paper header */}
              <div>
                <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">
                  Similar Paper {index + 1}
                </p>
                {paperUrl ? (
                  <h4 className="mt-2 text-xl font-bold leading-tight tracking-tight">
                    <a
                      href={paperUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-slate-900 hover:text-blue-600 transition"
                    >
                      {paper.title ?? "Untitled"}
                    </a>
                  </h4>
                ) : (
                  <h4 className="mt-2 text-xl font-bold leading-tight tracking-tight text-slate-900">
                    {paper.title ?? "Untitled"}
                  </h4>
                )}
                {(paper.authors || paper.year || paper.venue) && (
                  <p className="mt-1 text-sm text-slate-600">
                    {[
                      paper.authors?.join(", "),
                      paper.year,
                      paper.venue
                    ].filter(Boolean).join(" · ")}
                  </p>
                )}
              </div>

            {/* Why relevant - blue accent */}
            {paper.whyRelevant && (
              <div className="bg-blue-50/30 rounded-lg p-4 border-l-4 border-blue-400">
                <p className="text-sm leading-relaxed text-slate-700">
                  <span className="font-semibold text-slate-900">Why relevant:</span>{" "}
                  {paper.whyRelevant}
                </p>
              </div>
            )}

            {/* Key overlaps - simple list */}
            {paper.methodOverlap && paper.methodOverlap.length > 0 && (
              <div>
                <p className="text-sm font-medium text-slate-700 mb-2">Key overlaps:</p>
                <ul className="space-y-1.5 pl-4 text-sm text-slate-700 list-disc marker:text-slate-400">
                  {paper.methodOverlap.map((overlap, i) => (
                    <li key={i}>{overlap}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Method comparison - inline */}
            {paper.methodComparison && (
              <div>
                <p className="text-sm font-medium text-slate-700 mb-2">Method comparison:</p>
                <div className="space-y-2 text-sm text-slate-700">
                  {paper.methodComparison.sample && (
                    <p>
                      <span className="font-medium">Sample:</span> {paper.methodComparison.sample}
                    </p>
                  )}
                  {paper.methodComparison.materials && (
                    <p>
                      <span className="font-medium">Materials:</span> {paper.methodComparison.materials}
                    </p>
                  )}
                  {paper.methodComparison.equipment && (
                    <p>
                      <span className="font-medium">Equipment:</span> {paper.methodComparison.equipment}
                    </p>
                  )}
                  {paper.methodComparison.procedure && (
                    <p>
                      <span className="font-medium">Procedure:</span> {paper.methodComparison.procedure}
                    </p>
                  )}
                  {paper.methodComparison.outcomes && (
                    <p>
                      <span className="font-medium">Outcomes:</span> {paper.methodComparison.outcomes}
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Gaps - amber accent */}
            {paper.gaps && (
              <div className="bg-amber-50/40 rounded-lg p-4 border-l-4 border-amber-400">
                <p className="text-sm font-semibold text-amber-900 mb-1">Gaps:</p>
                <p className="text-sm text-amber-800">{paper.gaps}</p>
              </div>
            )}

            {/* Links */}
            {(paper.url || paper.doi) && (
              <div className="flex flex-wrap items-center gap-3 text-sm pt-2">
                {paper.url && (
                  <a
                    href={paper.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center rounded-full border border-blue-600 px-4 py-1.5 font-semibold text-blue-600 transition hover:bg-blue-50"
                  >
                    View paper
                  </a>
                )}
                {paper.doi && !paper.url && (
                  <a
                    href={`https://doi.org/${paper.doi}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm text-slate-500 underline-offset-4 hover:underline"
                  >
                    DOI: {paper.doi}
                  </a>
                )}
              </div>
            )}
          </article>
          );
        })}
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

  const isRemotePaper = paper.source === "remote";
  const isMock = isMockPaper(paper);
  const hasSimilarData = state?.status === "success";

  if ((!extraction || extraction.status === "loading") && !(isRemotePaper && hasSimilarData)) {
    if (isMock) {
      return (
        <div className="flex-1 overflow-auto">
          <MockSimilarPapersShowcase paperId={paper.id} />
        </div>
      );
    }
    return <PipelineStagePlaceholder stageId="similarPapers" waitingForStageId="extraction" />;
  }

  if (extraction && extraction.status === "error") {
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
    if (isMock && (!state || state.status === "loading")) {
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
    if (isMock) {
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
          <SimilarPapersStructuredView
            structured={state.structured}
            sourceTitle={paper?.name}
            sourceYear={undefined}
            sourceFileName={paper?.fileName}
          />
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
        <p className="text-base font-medium text-slate-700">Upload a PDF to find author contacts.</p>
        <p className="text-sm text-slate-500">We need a paper selected before finding contacts.</p>
      </div>
    );
  }

  const isRemotePaper = paper.source === "remote";

  // Check for mock author contacts data
  const hasMockAuthorContacts = Boolean(
    isMockPaper(paper) &&
    paper.id &&
    (() => {
      const summary = MOCK_SUMMARIES_BY_ID.get(paper.id);
      const authorContactsData = summary?.raw?.authorContacts as any;
      return authorContactsData?.structured && Array.isArray(authorContactsData.structured.papers) && authorContactsData.structured.papers.length > 0;
    })()
  );

  const hasMockContent = Boolean(
    state &&
      state.status === "success" &&
      ((state.text && state.text.trim().length > 0) || (state.structured && state.structured.length > 0))
  );
  const hasGroupsData = state?.status === "success";

  // For mock papers with author contacts data, use the showcase component
  if (isMockPaper(paper) && hasMockAuthorContacts && paper.id) {
    return (
      <div className="flex-1 overflow-auto">
        <MockAuthorContactsShowcase paperId={paper.id} />
      </div>
    );
  }

  if (isMockPaper(paper) && !hasMockContent && !hasMockAuthorContacts) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <p className="text-base font-medium text-slate-700">Coming soon</p>
        <p className="text-sm text-slate-500">
          Author contacts will appear here once you run the author contacts generator script.
        </p>
      </div>
    );
  }

  if ((!extraction || extraction.status === "loading") && !(isRemotePaper && hasGroupsData)) {
    return <PipelineStagePlaceholder stageId="researchGroups" waitingForStageId="extraction" />;
  }

  if (extraction && extraction.status === "error") {
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

  if (!similarState) {
    return <PipelineStagePlaceholder stageId="researchGroups" waitingForStageId="similarPapers" />;
  }

  if (similarState.status === "loading") {
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

  const structuredEntries = Array.isArray(state.structured) ? state.structured : [];

  // Calculate statistics for author contacts
  const totalPapers = structuredEntries.length;
  const totalAuthors = structuredEntries.reduce((sum, paper) => {
    const authors = (paper as any).authors || [];
    return sum + authors.length;
  }, 0);
  const authorsWithEmails = structuredEntries.reduce((sum, paper) => {
    const authors = (paper as any).authors || [];
    return sum + authors.filter((author: any) => author.email).length;
  }, 0);

  return (
    <div className="flex-1 overflow-auto">
      <div className="w-full space-y-8 px-6 py-8">
        <section className="space-y-6">
          <header className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-2">
                <h2 className="text-xl font-semibold text-slate-900">Author Contacts</h2>
                <p className="text-sm text-slate-600">Contact information for the first 3 authors of each paper.</p>
              </div>
              <button
                onClick={onRetry}
                className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                title="Re-run author contacts search"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            </div>
            {structuredEntries.length > 0 && (
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Papers</p>
                  <p className="mt-1 text-2xl font-semibold text-slate-900">{totalPapers}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Total authors</p>
                  <p className="mt-1 text-2xl font-semibold text-slate-900">{totalAuthors}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">With emails</p>
                  <p className="mt-1 text-2xl font-semibold text-slate-900">{authorsWithEmails}</p>
                </div>
              </div>
            )}
          </header>

          {structuredEntries.length > 0 ? (
            <div className="space-y-6">
              {structuredEntries.map((paperEntry, paperIndex) => {
                const authors = (paperEntry as any).authors || [];
                const paperUrl = paperEntry.identifier
                  ? paperEntry.identifier.startsWith("http")
                    ? paperEntry.identifier
                    : `https://doi.org/${paperEntry.identifier}`
                  : null;

                return (
                  <article
                    key={`${paperEntry.title}-${paperIndex}`}
                    className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
                  >
                    {/* Paper header */}
                    <div className="space-y-1">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                        Paper {paperIndex + 1}
                      </p>
                      {paperUrl ? (
                        <h3 className="text-lg font-semibold">
                          <a
                            href={paperUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-slate-900 hover:text-blue-600 transition"
                          >
                            {paperEntry.title}
                          </a>
                        </h3>
                      ) : (
                        <h3 className="text-lg font-semibold text-slate-900">{paperEntry.title}</h3>
                      )}
                      <p className="text-xs text-slate-500">{paperEntry.identifier || "No identifier"}</p>
                    </div>

                    {/* Author cards */}
                    {authors.length > 0 ? (
                      <div className="mt-5 space-y-4">
                        {authors.map((author: any, authorIndex: number) => (
                          <div
                            key={`${paperEntry.title}-${author.name}-${authorIndex}`}
                            className="rounded-xl border border-slate-200 bg-slate-50/80 p-5 space-y-3"
                          >
                            {/* Author name */}
                            <div className="flex items-start justify-between">
                              <p className="text-base font-semibold text-slate-900">{author.name}</p>
                            </div>

                            {/* Contact info row */}
                            <div className="flex flex-wrap items-center gap-2 text-sm">
                              {/* Role badge */}
                              {author.role && (
                                <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                                  {author.role}
                                </span>
                              )}

                              {/* Email */}
                              {author.email ? (
                                <a
                                  href={`mailto:${author.email}`}
                                  className="font-medium text-blue-600 hover:underline"
                                >
                                  {author.email}
                                </a>
                              ) : (
                                <span className="text-slate-500">No email</span>
                              )}
                            </div>

                            {/* ORCID + Profiles */}
                            {(author.orcid || (author.profiles && author.profiles.length > 0)) && (
                              <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-200">
                                {author.orcid && (
                                  <a
                                    href={`https://orcid.org/${author.orcid}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
                                  >
                                    <span className="font-medium">ORCID:</span> {author.orcid}
                                  </a>
                                )}

                                {author.profiles && author.profiles.length > 0 && (
                                  <div className="flex flex-wrap items-center gap-2">
                                    {author.profiles.map((profile: any, profileIndex: number) => (
                                      <a
                                        key={`${author.name}-${profile.platform}-${profileIndex}`}
                                        href={profile.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700 hover:bg-blue-100 transition"
                                      >
                                        {profile.platform}
                                      </a>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-3 text-sm text-slate-600">No author contacts found for this paper.</p>
                    )}
                  </article>
                );
              })}
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
  structuredGroups?: ResearchGroupPaperEntry[] | AuthorContactsPaperEntry[];
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

  function parseAuthorRole(role: string | null | undefined): string | null {
    if (!role) return null;
    const lowerRole = role.toLowerCase();
    if (lowerRole.includes("corresponding")) return "Corresponding Author";
    if (lowerRole.includes("first author")) return "First Author";
    if (lowerRole.includes("last author")) return "Last Author";
    // Return the original role if no special designation
    return role;
  }

  function renderResearcherCard(record: ResearcherThesisRecord) {
    const authorRole = parseAuthorRole(record.role);

    return (
      <article className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <header className="flex flex-col gap-3 border-b border-slate-100 pb-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <p className="text-base font-semibold text-slate-900">
              {record.name ?? record.email ?? "Unnamed researcher"}
            </p>
            {authorRole && (
              <p className="text-xs font-medium text-slate-500">{authorRole}</p>
            )}
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
        return <li key={key}>{renderResearcherCard(researcher)}</li>;
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

  // Filter to only papers with new .authors format (AuthorContactsPaperEntry)
  const authorsPapers = structuredGroups.filter((paper): paper is AuthorContactsPaperEntry => {
    return "authors" in paper && Array.isArray((paper as any).authors);
  });

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

  // Render sections for papers with author contacts
  const paperSections = authorsPapers.map((paper, paperIndex) => {
    // Match researchers to this paper's authors by name/email
    const paperAuthors = researchers.filter((researcher) => {
      return paper.authors.some((author) => {
        const nameMatch = researcher.name && author.name && researcher.name.toLowerCase() === author.name.toLowerCase();
        const emailMatch = researcher.email && author.email && researcher.email.toLowerCase() === author.email.toLowerCase();
        return nameMatch || emailMatch;
      });
    });

    // Merge author info (role) from paper.authors into researcher records
    const enrichedAuthors = paperAuthors.map((researcher) => {
      const matchingAuthor = paper.authors.find((author) => {
        const nameMatch = researcher.name && author.name && researcher.name.toLowerCase() === author.name.toLowerCase();
        const emailMatch = researcher.email && author.email && researcher.email.toLowerCase() === author.email.toLowerCase();
        return nameMatch || emailMatch;
      });

      return {
        ...researcher,
        role: matchingAuthor?.role || researcher.role
      };
    });

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
            {[paper.identifier, `${paper.authors.length} author${paper.authors.length === 1 ? "" : "s"}`]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </header>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {enrichedAuthors.map((author, index) => {
            const key = author.name ?? author.email ?? `author-${index}`;
            return <div key={key}>{renderResearcherCard(author)}</div>;
          })}
        </div>
      </article>
    );
  });

  return (
    <div className="flex-1 overflow-auto">
      <section className="space-y-6 px-6 py-6">
        <header className="flex items-center justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold text-slate-900">Researcher Theses</h2>
            <p className="text-sm text-slate-600">PhD theses from paper authors</p>
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
      </section>
    </div>
  );
}

  function calculatePatentStats(patents: PatentEntry[]) {
    const totalPatents = patents.length;
    const allClaimIds = new Set<string>();
    const dates: number[] = [];

    patents.forEach((patent) => {
      patent.overlapWithPaper?.claimIds?.forEach((id) => {
        if (id && id.trim()) {
          allClaimIds.add(id.trim());
        }
      });

      if (patent.filingDate) {
        const match = patent.filingDate.match(/^\d{4}/);
        if (match) {
          dates.push(parseInt(match[0], 10));
        }
      }
      if (patent.grantDate) {
        const match = patent.grantDate.match(/^\d{4}/);
        if (match) {
          dates.push(parseInt(match[0], 10));
        }
      }
    });

    const validatedClaims = Array.from(allClaimIds).sort();
    let dateRange = "Various dates";
    if (dates.length > 0) {
      const minYear = Math.min(...dates);
      const maxYear = Math.max(...dates);
      dateRange = minYear === maxYear ? String(minYear) : `${minYear}–${maxYear}`;
    }

    return { totalPatents, validatedClaims, dateRange };
  }

  function renderPatentCards(patents: PatentEntry[]) {
    return (
      <div className="space-y-6">
        {patents.map((patent, index) => {
          const key = patent.patentNumber || patent.title || `patent-${index}`;
          const claimIds = patent.overlapWithPaper?.claimIds ?? [];
          const overlapSummary = patent.overlapWithPaper?.summary;

          return (
            <article
              key={key}
              className="rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden"
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-0">
                {/* Left column: Patent metadata and abstract (50% width) */}
                <div className="p-5 space-y-3">
                  <div className="space-y-1.5">
                    <p className="text-sm font-mono text-slate-600">
                      {patent.patentNumber ?? "Patent"}
                    </p>
                    <h3 className="text-base font-semibold text-slate-900 leading-snug">
                      {patent.title ?? "Untitled patent"}
                    </h3>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
                    {patent.assignee && <span className="font-semibold">{patent.assignee}</span>}
                    {(patent.assignee && patent.filingDate) && <span className="text-slate-300">•</span>}
                    {patent.filingDate && <span>Filed {patent.filingDate}</span>}
                    {(patent.filingDate && patent.grantDate) && <span className="text-slate-300">•</span>}
                    {patent.grantDate && <span>Granted {patent.grantDate}</span>}
                  </div>

                  {patent.abstract && (
                    <p className="text-sm leading-relaxed text-slate-700">{patent.abstract}</p>
                  )}

                  {patent.url && (
                    <div className="pt-2">
                      <a
                        href={patent.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary transition hover:text-primary/80"
                      >
                        View patent
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                        </svg>
                      </a>
                    </div>
                  )}
                </div>

                {/* Right column: Validation information (50% width) */}
                <div className="bg-blue-50/30 p-5 space-y-4">
                  {claimIds.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-700">
                        Validates Claims
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {claimIds.map((claimId, idx) => (
                          <span
                            key={`${claimId}-${idx}`}
                            className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-700"
                          >
                            {claimId}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {overlapSummary && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-600">
                        Technical Overlap
                      </p>
                      <p className="text-sm leading-relaxed text-slate-700">{overlapSummary}</p>
                    </div>
                  )}

                  {!claimIds.length && !overlapSummary && (
                    <p className="text-sm text-slate-500">No overlap information provided</p>
                  )}
                </div>
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

  function renderPatentsView(patents: PatentEntry[]) {
    const stats = calculatePatentStats(patents);

    return (
      <div className="flex flex-1 flex-col overflow-auto">
        <div className="flex-1 overflow-auto bg-slate-50">
          <section className="w-full space-y-6 px-6 py-8">
            <header className="flex items-start justify-between gap-3">
              <div className="space-y-2">
                <h2 className="text-xl font-semibold text-slate-900">Related Patents</h2>
                <p className="text-sm leading-relaxed text-slate-600">
                  Patents that validate the paper&apos;s claims through independent technical filings.
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

            {patents.length > 0 ? (
              <>
                {/* Statistics summary */}
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                      Patents Found
                    </p>
                    <p className="mt-1 text-2xl font-semibold text-slate-900">{stats.totalPatents}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                      Claims Validated
                    </p>
                    <p className="mt-1 text-2xl font-semibold text-slate-900">
                      {stats.validatedClaims.length > 0 ? stats.validatedClaims.join(", ") : "None"}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                      Date Range
                    </p>
                    <p className="mt-1 text-2xl font-semibold text-slate-900">{stats.dateRange}</p>
                  </div>
                </div>

                {/* Patent cards */}
                {renderPatentCards(patents)}
              </>
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
      if (mockPatents.length > 0) {
        return renderPatentsView(mockPatents as PatentEntry[]);
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

    if (MOCK_PATENTS_LIST.length > 0) {
      return renderPatentsView(MOCK_PATENTS_LIST);
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

  if (patents.length === 0) {
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

  return renderPatentsView(patents);
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
  const missingSignals: string[] = [];
  if (!similarState || similarState.status !== "success") {
    missingSignals.push("similar papers");
  }
  if (!groupsState || groupsState.status !== "success") {
    missingSignals.push("research groups");
  }
  if (!patentsState || patentsState.status !== "success") {
    missingSignals.push("patents");
  }

  const renderWarnings = () => {
    if (missingSignals.length === 0) {
      return null;
    }
    return (
      <div className="w-full max-w-3xl rounded-lg border border-amber-200 bg-amber-50/80 px-4 py-3 text-left text-slate-700">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">Partial context</p>
        <p className="mt-1 text-sm text-amber-900">
          Verification ran without {missingSignals.join(", ")} data, so findings may be incomplete.
        </p>
      </div>
    );
  };

  const warningsNode = renderWarnings();

  interface AnalystNoteSection {
    title?: string;
    bullets?: string[];
    paragraphs?: string[];
  }

  const parseAnalystNotes = (notes: string): AnalystNoteSection[] => {
    const bulletPattern = /^[-•*]\s+/;
    const stripBullet = (line: string) => line.replace(bulletPattern, "").trim();

    return notes
      .split(/\n\s*\n/)
      .map((block) => block.trim())
      .filter(Boolean)
      .map<AnalystNoteSection | null>((block) => {
        const lines = block.split(/\n+/).map((line) => line.trim()).filter(Boolean);
        if (lines.length === 0) {
          return null;
        }

        if (lines.every((line) => bulletPattern.test(line))) {
          const bullets = lines.map(stripBullet).filter(Boolean);
          return bullets.length > 0 ? { bullets } : null;
        }

        const headingCandidate = !bulletPattern.test(lines[0]) ? lines[0] : undefined;
        const rest = headingCandidate ? lines.slice(1) : lines;
        const normalizedTitle = headingCandidate
          ? headingCandidate.replace(/\s*[:：]\s*$/, "").trim()
          : undefined;

        if (rest.length > 0 && rest.every((line) => bulletPattern.test(line))) {
          const bullets = rest.map(stripBullet).filter(Boolean);
          return {
            ...(normalizedTitle ? { title: normalizedTitle } : {}),
            ...(bullets.length > 0 ? { bullets } : {})
          };
        }

        const bodyLines = (headingCandidate ? rest : lines).map((line) =>
          bulletPattern.test(line) ? stripBullet(line) : line
        );
        const paragraphs = bodyLines.filter(Boolean);

        if (!normalizedTitle && paragraphs.length === 0) {
          return null;
        }

        return {
          ...(normalizedTitle ? { title: normalizedTitle } : {}),
          ...(paragraphs.length > 0 ? { paragraphs } : {})
        };
      })
      .filter((section): section is AnalystNoteSection => Boolean(section));
  };

  const analystSections =
    state?.status === "success" && state.text ? parseAnalystNotes(state.text) : [];
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

  const renderAnalystSectionCard = (
    section: AnalystNoteSection,
    index: number,
    keyPrefix: string
  ) => (
    <article
      key={`${keyPrefix}-${index}`}
      className="space-y-3 rounded-lg border border-slate-200 bg-white px-5 py-4 shadow-sm"
    >
      {section.title && (
        <h3 className="text-sm font-semibold text-slate-900">{section.title}</h3>
      )}
      {section.paragraphs?.map((paragraph, paragraphIndex) => (
        <p key={`${keyPrefix}-${index}-p-${paragraphIndex}`} className="text-sm leading-relaxed text-slate-700">
          {paragraph}
        </p>
      ))}
      {section.bullets && section.bullets.length > 0 && (
        <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-slate-700">
          {section.bullets.map((item, bulletIndex) => (
            <li key={`${keyPrefix}-${index}-b-${bulletIndex}`}>{item}</li>
          ))}
        </ul>
      )}
    </article>
  );

  const renderClaimsView = (
    claims: VerifiedClaimEntry[],
    overallAssessment?: string | null,
    promptNotes?: string | null
  ) => {
    const trimmedPrompt = promptNotes?.trim() ?? "";
    const parsedPromptSections = trimmedPrompt ? parseAnalystNotes(trimmedPrompt) : [];
    const normalizedPromptSections: AnalystNoteSection[] = (() => {
      if (!trimmedPrompt) {
        return [];
      }
      if (parsedPromptSections.length === 0) {
        return [{ title: "Analyst Notes", paragraphs: [trimmedPrompt] }];
      }
      return parsedPromptSections.map((section, index) => {
        if (section.title) {
          return section;
        }
        return index === 0
          ? { ...section, title: "Analyst Notes" }
          : section;
      });
    })();

    const totalClaims = claims.length;
    const statusTallies = claims.reduce<Record<VerifiedClaimStatus, number>>(
      (acc, claim) => {
        acc[claim.verificationStatus] += 1;
        return acc;
      },
      {
        Verified: 0,
        "Partially Verified": 0,
        Contradicted: 0,
        "Insufficient Evidence": 0
      }
    );
    const confidenceTallies = claims.reduce<Record<VerifiedClaimConfidence, number>>(
      (acc, claim) => {
        acc[claim.confidenceLevel] += 1;
        return acc;
      },
      { High: 0, Moderate: 0, Low: 0 }
    );

    const verifiedCount = statusTallies.Verified;
    const partialCount = statusTallies["Partially Verified"];
    const needsReviewCount = statusTallies.Contradicted + statusTallies["Insufficient Evidence"];
    const highConfidenceCount = confidenceTallies.High;
    const moderateConfidenceCount = confidenceTallies.Moderate;
    const lowConfidenceCount = confidenceTallies.Low;

    return (
      <div className="flex flex-1 flex-col overflow-auto">
        <div className="flex-1 overflow-auto bg-slate-50">
          <section className="w-full space-y-8 px-6 py-8">
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
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                </button>
              )}
            </header>

            {warningsNode && <div className="flex justify-center">{warningsNode}</div>}

            {totalClaims > 0 && (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Claims Assessed</p>
                  <p className="mt-1 text-2xl font-semibold text-slate-900">{totalClaims}</p>
                  <p className="mt-1 text-xs text-slate-500">High confidence: {highConfidenceCount}</p>
                </div>
                <div className="rounded-2xl border border-green-200 bg-green-50/60 px-5 py-4 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-green-600">Verified</p>
                  <p className="mt-1 text-2xl font-semibold text-slate-900">{verifiedCount}</p>
                  <p className="mt-1 text-xs text-green-700/80">Ready to cite with full confidence.</p>
                </div>
                <div className="rounded-2xl border border-amber-200 bg-amber-50/70 px-5 py-4 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-600">Partially Verified</p>
                  <p className="mt-1 text-2xl font-semibold text-slate-900">{partialCount}</p>
                  <p className="mt-1 text-xs text-amber-700/80">Expected for most claims - reasonable support.</p>
                </div>
                <div className="rounded-2xl border border-rose-200 bg-rose-50/70 px-5 py-4 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-rose-600">Needs Review</p>
                  <p className="mt-1 text-2xl font-semibold text-slate-900">{needsReviewCount}</p>
                  <p className="mt-1 text-xs text-rose-700/80">Low confidence: {lowConfidenceCount}</p>
                </div>
              </div>
            )}

            {overallAssessment && (
              <article className="rounded-2xl border border-slate-200 bg-white px-6 py-5 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Overall Assessment</p>
                <p className="mt-3 text-base leading-relaxed text-slate-700">{overallAssessment}</p>
              </article>
            )}

            {normalizedPromptSections.length > 0 && (
              <article className="rounded-2xl border border-indigo-100 bg-indigo-50/80 px-6 py-5 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-600">Analyst Notes</p>
                <div className="mt-3 space-y-3">
                  {normalizedPromptSections.map((section, index) => (
                    <div key={`prompt-${index}`} className="space-y-2">
                      {section.title && <h3 className="text-sm font-semibold text-indigo-900">{section.title}</h3>}
                      {section.paragraphs?.map((paragraph, paragraphIndex) => (
                        <p key={`prompt-${index}-p-${paragraphIndex}`} className="text-sm leading-relaxed text-indigo-900/90">
                          {paragraph}
                        </p>
                      ))}
                      {section.bullets && section.bullets.length > 0 && (
                        <ul className="list-disc space-y-1.5 pl-5 text-sm text-indigo-900/90">
                          {section.bullets.map((bullet, bulletIndex) => (
                            <li key={`prompt-${index}-b-${bulletIndex}`} className="leading-relaxed">
                              {bullet}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              </article>
            )}

            {claims.length > 0 && (
              <div className="space-y-5">
                {claims.map((claim, index) => {
                  const supportingEvidence = Array.isArray(claim.supportingEvidence)
                    ? claim.supportingEvidence
                    : [];
                  const contradictingEvidence = Array.isArray(claim.contradictingEvidence)
                    ? claim.contradictingEvidence
                    : [];
                  const supportingCount = supportingEvidence.length;
                  const contradictingCount = contradictingEvidence.length;

                  return (
                    <article
                      key={claim.claimId ?? index}
                      className="space-y-5 rounded-2xl border border-slate-200 bg-white px-6 py-6 shadow-sm"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                            {claim.claimId ?? `Claim ${index + 1}`}
                          </span>
                          <span
                            className={`rounded-full border px-3 py-1 text-xs font-semibold ${getStatusBadgeClasses(claim.verificationStatus)}`}
                          >
                            {claim.verificationStatus}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-3">
                          <span
                            className={`rounded-full px-3 py-1 text-xs font-semibold ${getConfidenceBadgeClasses(claim.confidenceLevel)}`}
                          >
                            Confidence: {claim.confidenceLevel}
                          </span>
                          <span className="text-xs font-medium text-slate-500">
                            {supportingCount} supporting • {contradictingCount} contradicting
                          </span>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Original Claim</p>
                        <p className="text-base leading-relaxed text-slate-800">{claim.originalClaim}</p>
                      </div>

                      {claim.verificationSummary && (
                        <div className="rounded-xl border border-blue-200 bg-blue-50/70 px-5 py-4">
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-700">Verification Summary</p>
                          <p className="mt-2 text-sm leading-relaxed text-blue-900">{claim.verificationSummary}</p>
                        </div>
                      )}

                      <div className="grid gap-4 lg:grid-cols-2">
                        <div className="rounded-xl border border-green-200 bg-green-50/80 px-5 py-4">
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-green-700">Supporting Evidence</p>
                          {supportingCount > 0 ? (
                            <ul className="mt-3 space-y-3">
                              {supportingEvidence.map((evidence, evIndex) => (
                                <li key={evIndex} className="space-y-1">
                                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-green-600">
                                    {evidence.source}
                                  </p>
                                  <p className="text-sm font-semibold leading-snug text-slate-800">{evidence.title}</p>
                                  {evidence.relevance && (
                                    <p className="text-sm leading-relaxed text-slate-700">{evidence.relevance}</p>
                                  )}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="mt-3 text-sm text-green-700/80">No supporting evidence cited.</p>
                          )}
                        </div>

                        <div className="rounded-xl border border-red-200 bg-red-50/80 px-5 py-4">
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-red-700">Contradicting Evidence</p>
                          {contradictingCount > 0 ? (
                            <ul className="mt-3 space-y-3">
                              {contradictingEvidence.map((evidence, evIndex) => (
                                <li key={evIndex} className="space-y-1">
                                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-red-600">
                                    {evidence.source}
                                  </p>
                                  <p className="text-sm font-semibold leading-snug text-slate-800">{evidence.title}</p>
                                  {evidence.relevance && (
                                    <p className="text-sm leading-relaxed text-slate-700">{evidence.relevance}</p>
                                  )}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="mt-3 text-sm text-red-700/80">No contradictions surfaced.</p>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    );
  };

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

  if (isMock) {
    if (state?.status === "success") {
      const mockClaims = (state.structured?.claims ?? []) as VerifiedClaimEntry[];
      const mockOverall = state.structured?.overallAssessment ?? null;
      const mockNotes = state.structured?.promptNotes ?? null;
      if (mockClaims.length > 0 || mockOverall || (mockNotes && mockNotes.trim().length > 0)) {
        return renderClaimsView(mockClaims, mockOverall, mockNotes);
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
      (MOCK_VERIFIED_CLAIMS_OVERALL && MOCK_VERIFIED_CLAIMS_OVERALL.trim().length > 0) ||
      (MOCK_VERIFIED_CLAIMS_STRUCTURED_DATA?.promptNotes &&
        MOCK_VERIFIED_CLAIMS_STRUCTURED_DATA.promptNotes.trim().length > 0)
    ) {
      return renderClaimsView(
        (MOCK_VERIFIED_CLAIMS_STRUCTURED_DATA?.claims ?? []) as VerifiedClaimEntry[],
        MOCK_VERIFIED_CLAIMS_OVERALL,
        MOCK_VERIFIED_CLAIMS_STRUCTURED_DATA?.promptNotes ?? null
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

  if (!state || state.status === "loading") {
    return <PipelineStagePlaceholder stageId="verifiedClaims" countdown={countdown} />;
  }

  if (state.status === "error") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center p-6">
        {warningsNode && <div className="w-full flex justify-center">{warningsNode}</div>}
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

  const promptNotes = state.structured?.promptNotes;

  if (claims.length === 0 && !overallAssessment && !promptNotes && state.text) {
    const sections = analystSections.length > 0 ? analystSections : [{ paragraphs: [state.text.trim()] }];

    return (
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

            {warningsNode && <div className="flex justify-center">{warningsNode}</div>}

            <div className="space-y-4">
              {sections.map((section, index) => renderAnalystSectionCard(section, index, "summary"))}
            </div>

            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary/90"
              >
                Re-run verification
              </button>
            )}
          </section>
        </div>
      </div>
    );
  }

  if (claims.length === 0 && !overallAssessment && !(promptNotes && promptNotes.trim().length > 0)) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center p-6">
        {warningsNode && <div className="w-full flex justify-center">{warningsNode}</div>}
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

  return renderClaimsView(claims, overallAssessment, promptNotes ?? null);
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
  const claimsStorageFetchesRef = useRef<Set<string>>(new Set<string>());
  const claimsStorageResolvedRef = useRef<Set<string>>(new Set<string>());
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
  const researchGroupsStorageResolvedRef = useRef<Set<string>>(new Set<string>());
  const researchGroupsGenerationRef = useRef<Set<string>>(new Set<string>());
  const contactsStorageFetchesRef = useRef<Set<string>>(new Set<string>());
  const thesesStorageFetchesRef = useRef<Set<string>>(new Set<string>());
  const thesesStorageResolvedRef = useRef<Set<string>>(new Set<string>());
  const remoteAutoRunAttemptedRef = useRef<Set<string>>(new Set<string>());
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
    let cancelled = false;

    const cachedClaims = readCachedState<{ text?: string; structured?: any }>(paperId, "claims");
    if (!activeClaimsState && (cachedClaims?.text || cachedClaims?.structured)) {
      const cachedPayload = {
        ...(cachedClaims?.text ? { text: cachedClaims.text } : {}),
        ...(cachedClaims?.structured ? { structured: cachedClaims.structured } : {})
      };
      writeCachedState(paperId, "claims", cachedPayload);
      setClaimsStates((prev) => ({
        ...prev,
        [paperId]: {
          status: "success",
          ...cachedPayload
        }
      }));
      claimsStorageResolvedRef.current.add(paperId);
    }

    const hasAttemptedClaimsLoad = claimsStorageFetchesRef.current.has(paperId);
    const lacksCachedClaims = !cachedClaims?.text && !cachedClaims?.structured;

    if (
      !activeClaimsState &&
      lacksCachedClaims &&
      activePaper.storagePath &&
      supabase &&
      !hasAttemptedClaimsLoad
    ) {
      claimsStorageFetchesRef.current.add(paperId);
      claimsStorageResolvedRef.current.delete(paperId);

      setClaimsStates((prev) => ({
        ...prev,
        [paperId]: { status: "loading" }
      }));

      const claimsPromise = loadClaimsFromStorage({
        client: supabase,
        storagePath: activePaper.storagePath
      })
        .then((storedData) => {
          if (cancelled) {
            return;
          }

          const payload = storedData && typeof storedData === "object" ? storedData : null;
          const text = typeof payload?.text === "string" ? payload.text.trim() : "";
          const structured = payload?.structured;

          if (text || structured) {
            const resolvedPayload = {
              ...(text ? { text } : {}),
              ...(structured ? { structured } : {})
            };
            writeCachedState(paperId, "claims", resolvedPayload);
            setClaimsStates((prev) => ({
              ...prev,
              [paperId]: {
                status: "success",
                ...resolvedPayload
              }
            }));
            return;
          }

          setClaimsStates((prev) => {
            const next = { ...prev };
            delete next[paperId];
            return next;
          });
        })
        .catch((error) => {
          if (cancelled) {
            return;
          }
          console.error("[claims] failed to load from storage", error);
          setClaimsStates((prev) => {
            const next = { ...prev };
            delete next[paperId];
            return next;
          });
        })
        .finally(() => {
          claimsStorageFetchesRef.current.delete(paperId);
          claimsStorageResolvedRef.current.add(paperId);
        });

      void claimsPromise;
    } else if (!claimsStorageResolvedRef.current.has(paperId)) {
      claimsStorageResolvedRef.current.add(paperId);
    }

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

    const cachedGroups = readCachedState<{ text: string; structured?: ResearchGroupPaperEntry[] | AuthorContactsPaperEntry[] | any }>(
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
      researchGroupsStorageResolvedRef.current.delete(paperId);
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
          researchGroupsStorageResolvedRef.current.add(paperId);
        });

      void groupsPromise;
    } else if (!researchGroupsStorageResolvedRef.current.has(paperId)) {
      researchGroupsStorageResolvedRef.current.add(paperId);
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
        const normalisedResearchers = normaliseResearcherRecords(cachedTheses.researchers);
        setResearchThesesStates((prev) => ({
          ...prev,
          [paperId]: {
            status: "success",
            researchers: normalisedResearchers,
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
          const normalisedResearchers = normaliseResearcherRecords(researchers);
          const text = typeof storedData?.text === "string" ? storedData.text.trim() : "";

          if (normalisedResearchers.length > 0) {
            const cachePayload = text.length > 0
              ? { researchers: normalisedResearchers, text }
              : { researchers: normalisedResearchers };
            writeCachedState(paperId, "theses", cachePayload);
            setResearchThesesStates((prev) => ({
              ...prev,
              [paperId]: {
                status: "success",
                researchers: normalisedResearchers,
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
      claimsStorageFetchesRef.current.delete(paperId);
      claimsStorageResolvedRef.current.delete(paperId);
      similarStorageFetchesRef.current.delete(paperId);
      similarStorageResolvedRef.current.delete(paperId);
      researchGroupsStorageFetchesRef.current.delete(paperId);
      researchGroupsStorageResolvedRef.current.delete(paperId);
      contactsStorageFetchesRef.current.delete(paperId);
      thesesStorageFetchesRef.current.delete(paperId);
      thesesStorageResolvedRef.current.delete(paperId);
    };
  }, [
    activePaper,
    activeClaimsState,
    activeSimilarPapersState,
    activePatentsState,
    activeVerifiedClaimsState,
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
          throw new Error("Patent API returned empty results. The response may have been truncated or malformed. Please try again.");
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
      similar: SimilarPapersState | null,
      groups: ResearchGroupsState | null,
      patents: PatentsState | null,
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

      console.log("[verified-claims] starting fetch", {
        paperId: paper.id,
        hasClaimsText: Boolean(claims.text),
        hasSimilarText: Boolean(similar && similar.status === "success" && similar.text),
        hasGroupsText: Boolean(groups && groups.status === "success" && groups.text),
        hasPatentsText: Boolean(patents && patents.status === "success" && patents.text)
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
              text: similar?.status === "success" ? similar.text ?? null : null,
              structured: similar?.status === "success" ? similar.structured ?? null : null
            },
            researchGroups: {
              text: groups?.status === "success" ? groups.text ?? null : null,
              structured: groups?.status === "success" ? groups.structured ?? null : null
            },
            theses:
              theses && theses.status === "success"
                ? {
                    text: theses.text ?? null,
                    structured: theses.researchers ?? null
                  }
                : null,
            patents: {
              text: patents?.status === "success" ? patents.text ?? null : null,
              structured: patents?.status === "success" ? patents.structured ?? null : null
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

        writeCachedState(paper.id, "claims", result);

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
      authorDataStructured: ResearchGroupPaperEntry[] | AuthorContactsPaperEntry[] | undefined
    ): Promise<ResearcherThesesResult | null> => {
      if (!paper || isMockPaper(paper)) {
        return null;
      }

      if (!authorDataStructured || authorDataStructured.length === 0) {
        setResearchThesesStates((prev) => ({
          ...prev,
          [paper.id]: {
            status: "error",
            message: "Author data is required for researcher theses lookup.",
            deepDives:
              prev[paper.id]?.status === "success" ? prev[paper.id].deepDives : undefined
          }
        }));
        return null;
      }

      console.log("[researcher-theses] starting fetch", {
        paperId: paper.id,
        papers: authorDataStructured.length
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
              authorContacts: {
                structured: {
                  papers: authorDataStructured
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
        const normalisedResearchers = normaliseResearcherRecords(researchers);

        const text = typeof payload?.text === "string" ? payload.text.trim() : "";

        console.log("[researcher-theses] fetch success", {
          paperId: paper.id,
          researchers: normalisedResearchers.length,
          hasText: text.length > 0
        });

        const cachePayload = text.length > 0
          ? { researchers: normalisedResearchers, text }
          : { researchers: normalisedResearchers };
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
          researchers: normalisedResearchers,
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
      researchGroupsStructured: ResearchGroupPaperEntry[] | AuthorContactsPaperEntry[] | undefined
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

      // Guard against duplicate calls
      if (researchGroupsGenerationRef.current.has(paper.id)) {
        console.log("[research-groups] already generating for this paper, skipping duplicate call", {
          paperId: paper.id
        });
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

      // Mark as generating to prevent duplicate calls
      researchGroupsGenerationRef.current.add(paper.id);

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
            similarPapers: {
              text: similarPapers.text,
              structured: similarPapers.structured
            }
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
        structured?: unknown;
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
    } finally {
      // Clean up generation tracking
      researchGroupsGenerationRef.current.delete(paper.id);
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
          const existingExtractionState = extractionStatesRef.current[paper.id];
          let extractionData =
            existingExtractionState?.status === "success" ? existingExtractionState.data : null;

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

          let similarStateForVerified =
            similarState && similarState.status === "success" ? similarState : null;

          let groupsState = researchGroupsStatesRef.current[paper.id];
          const forceGroups = forcedStageIndex !== null && forcedStageIndex <= PIPELINE_STAGE_INDEX.researchGroups;
          const canGenerateGroups = similarState?.status === "success";
          if (
            canGenerateGroups &&
            (!groupsState || groupsState.status !== "success" || forceGroups)
          ) {
            // Check storage first before running API
            if (paper.storagePath && supabase && !forceGroups) {
              try {
                const storedGroups = await loadResearchGroupsFromStorage({
                  client: supabase,
                  storagePath: paper.storagePath
                });

                if (storedGroups?.text) {
                  const normalized = normalizeResearchGroupsStructured(storedGroups.structured);
                  setResearchGroupsStates((prev) => ({
                    ...prev,
                    [paper.id]: {
                      status: "success",
                      text: storedGroups.text,
                      structured: normalized
                    }
                  }));
                  groupsState = {
                    status: "success",
                    text: storedGroups.text,
                    structured: normalized
                  } as ResearchGroupsState;
                }
              } catch (error) {
                console.error("[research-groups] Failed to load from storage in pipeline", error);
              }
            }

            // Only run API if we don't have data
            if (!groupsState || groupsState.status !== "success") {
              const groupsResult = await runResearchGroups(paper, extractionData, claimsState, similarState);
              if (!groupsResult) {
                groupsState = researchGroupsStatesRef.current[paper.id];
              } else {
                groupsState = { status: "success", ...groupsResult } as ResearchGroupsState;
              }
            }
          }

          const hasGroupsSuccess = groupsState?.status === "success";
          let contactsState = researchContactsStatesRef.current[paper.id];
          if (groupsState?.status === "success") {
            if (!contactsState || contactsState.status !== "success") {
              await runResearchGroupContacts(paper, groupsState.text, groupsState.structured);
              contactsState = researchContactsStatesRef.current[paper.id];
            }
          }

          let thesesState = researchThesesStatesRef.current[paper.id];
          // Use research groups structured data which contains full author info with roles
          // This is passed as "authorContacts" to the API for semantic clarity
          const hasStructuredAuthors =
            groupsState?.status === "success" &&
            Array.isArray(groupsState.structured) &&
            groupsState.structured.length > 0;
          const forceTheses = forcedStageIndex !== null && forcedStageIndex <= PIPELINE_STAGE_INDEX.theses;
          if (
            groupsState?.status === "success" &&
            hasStructuredAuthors &&
            (!thesesState || thesesState.status !== "success" || forceTheses)
          ) {
            // Check storage first before running API
            if (paper.storagePath && supabase && !forceTheses) {
              try {
                const storedTheses = await loadThesesFromStorage({
                  client: supabase,
                  storagePath: paper.storagePath
                });

                if (storedTheses?.researchers && storedTheses.researchers.length > 0) {
                  const text = typeof storedTheses.text === "string" ? storedTheses.text.trim() : "";
                  setResearchThesesStates((prev) => ({
                    ...prev,
                    [paper.id]: {
                      status: "success",
                      researchers: storedTheses.researchers,
                      ...(text.length > 0 ? { text } : {})
                    }
                  }));
                  thesesState = {
                    status: "success",
                    researchers: storedTheses.researchers,
                    ...(text.length > 0 ? { text } : {})
                  } as ResearcherThesesState;
                }
              } catch (error) {
                console.error("[researcher-theses] Failed to load from storage in pipeline", error);
              }
            }

            // Only run API if we don't have data
            if (!thesesState || thesesState.status !== "success") {
              const thesesResult = await runResearcherTheses(paper, groupsState.structured);
              if (thesesResult) {
                thesesState = { status: "success", ...thesesResult } as ResearcherThesesState;
              } else {
                thesesState = researchThesesStatesRef.current[paper.id];
              }
            }
          }

          let patentsState = patentsStatesRef.current[paper.id];
          const forcePatents = forcedStageIndex !== null && forcedStageIndex <= PIPELINE_STAGE_INDEX.patents;
          if (!patentsState || patentsState.status !== "success" || forcePatents) {
            // Check storage first before running API
            if (paper.storagePath && supabase && !forcePatents) {
              try {
                const storedPatents = await loadPatentsFromStorage({
                  client: supabase,
                  storagePath: paper.storagePath
                });

                if (storedPatents) {
                  const text = typeof storedPatents.text === "string" ? storedPatents.text : "";
                  const structured = storedPatents.structured
                    ? normalizePatentsStructured(storedPatents.structured)
                    : undefined;

                  if (text || structured) {
                    setPatentsStates((prev) => ({
                      ...prev,
                      [paper.id]: {
                        status: "success",
                        ...(text ? { text } : {}),
                        ...(structured ? { structured } : {})
                      }
                    }));
                    patentsState = {
                      status: "success",
                      ...(text ? { text } : {}),
                      ...(structured ? { structured } : {})
                    } as PatentsState;
                  }
                }
              } catch (error) {
                console.error("[patents] Failed to load from storage in pipeline", error);
              }
            }

            // Only run API if we don't have data or if forced
            if (!patentsState || patentsState.status !== "success" || forcePatents) {
              const patentsResult = await runPatents(paper, extractionData, claimsState);
              if (!patentsResult) {
                return;
              }
              patentsState = { status: "success", ...patentsResult } as PatentsState;
            }
          }

          const patentsStateForVerified =
            patentsState && patentsState.status === "success" ? patentsState : null;
          similarStateForVerified =
            similarState && similarState.status === "success" ? similarState : similarStateForVerified;
          const groupsStateForVerified = groupsState && groupsState.status === "success" ? groupsState : null;
          const thesesForVerified = thesesState && thesesState.status === "success" ? thesesState : undefined;

          let verifiedState = verifiedClaimsStatesRef.current[paper.id];
          const forceVerified = forcedStageIndex !== null && forcedStageIndex === PIPELINE_STAGE_INDEX.verifiedClaims;
          if (!verifiedState || verifiedState.status !== "success" || forceVerified) {
            const verifiedResult = await runVerifiedClaims(
              paper,
              claimsState,
              similarStateForVerified,
              groupsStateForVerified,
              patentsStateForVerified,
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

      // Register the promise immediately to prevent race conditions
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

  // Reset the main panel to the upload view whenever auth changes; keep the sidebar open after login.
  useEffect(() => {
    const previousUserId = prevUserRef.current?.id ?? null;
    const currentUserId = user?.id ?? null;

    if (previousUserId !== currentUserId) {
      setActivePaperId(null);
      setActiveTab("paper");
    }

    if (!previousUserId && currentUserId) {
      setSidebarCollapsed(false);
    }

    prevUserRef.current = user;
  }, [user]);

  useEffect(() => {
    if (!activePaper || isMockPaper(activePaper)) {
      return;
    }

    if (activePaper.source === "remote") {
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
      claimsStorageFetchesRef.current.clear();
      claimsStorageResolvedRef.current.clear();
      similarStorageFetchesRef.current.clear();
      similarStorageResolvedRef.current.clear();
      researchGroupsStorageFetchesRef.current.clear();
      researchGroupsStorageResolvedRef.current.clear();
      remoteAutoRunAttemptedRef.current.clear();
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
      claimsStorageFetchesRef.current.delete(id);
      claimsStorageResolvedRef.current.delete(id);
      similarStorageFetchesRef.current.delete(id);
      similarStorageResolvedRef.current.delete(id);
      similarPapersGenerationRef.current.delete(id);
      researchGroupsStorageFetchesRef.current.delete(id);
      researchGroupsStorageResolvedRef.current.delete(id);
      researchGroupsGenerationRef.current.delete(id);
      remoteAutoRunAttemptedRef.current.delete(id);
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

  useEffect(() => {
    if (!activePaper || isMockPaper(activePaper)) {
      return;
    }

    if (activePaper.source !== "remote") {
      return;
    }

    const paperId = activePaper.id;

    if (pipelineRunsRef.current.has(paperId)) {
      return;
    }

    if (remoteAutoRunAttemptedRef.current.has(paperId)) {
      return;
    }

    const hasStorageAccess = Boolean(activePaper.storagePath && supabase);
    if (hasStorageAccess && !claimsStorageResolvedRef.current.has(paperId)) {
      return;
    }

    if (!activeClaimsState || activeClaimsState.status !== "success") {
      remoteAutoRunAttemptedRef.current.add(paperId);
      void startPipeline(activePaper);
    }
  }, [activeClaimsState, activePaper, startPipeline, supabase]);


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

    // Clear state to trigger re-generation
    setPatentsStates((prev) => {
      const next = { ...prev };
      delete next[activePaper.id];
      return next;
    });

    patentsGenerationRef.current.delete(activePaper.id);
    void startPipeline(activePaper, { resetFrom: "patents" });
  }, [activePaper, setPatentsStates, startPipeline]);

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
    if (!activeExtraction) return null;
    if (activeExtraction.status === "loading") return "extraction";
    if (activeClaimsState?.status === "loading") return "claims";
    if (activeSimilarPapersState?.status === "loading") return "similarPapers";
    if (activeResearchGroupState?.status === "loading") return "researchGroups";
    if (activeResearchThesesState?.status === "loading") return "theses";
    if (activePatentsState?.status === "loading") return "patents";
    if (activeVerifiedClaimsState?.status === "loading") return "verifiedClaims";
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
              ? MOCK_AUTHOR_CONTACTS_STRUCTURED
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
