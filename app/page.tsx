"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AppSidebar } from "@/components/app-sidebar";
import { PaperTabNav } from "@/components/paper-tab-nav";
import { PdfViewer } from "@/components/pdf-viewer";
import { UploadDropzone } from "@/components/upload-dropzone";
import { useAuthModal } from "@/components/auth-modal-provider";
import { ReaderTabKey } from "@/lib/reader-tabs";
import { extractDoiFromPdf } from "@/lib/pdf-doi";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { parseUploadError, validateFileSize } from "@/lib/upload-errors";
import { deleteUserPaper, fetchUserPapers, persistUserPaper, type UserPaperRecord } from "@/lib/user-papers";

const RESEARCH_CACHE_VERSION = "v1";

type CacheStage = "groups" | "contacts" | "theses";

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
    }
  | { status: "error"; message: string };

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

  return (
    <div className="flex-1 overflow-auto p-6 space-y-6">
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-slate-800">Research Groups</h3>
        <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
          {state.text}
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-slate-800">Group Contacts</h3>
        {!contacts || contacts.status === "loading" ? (
          <div className="flex flex-col items-center justify-center gap-2 py-6 text-center text-sm text-slate-600">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-primary" />
            <p>Looking up contact details…</p>
          </div>
        ) : contacts.status === "error" ? (
          <div className="space-y-2 text-sm text-red-600">
            <p className="font-semibold">Contact lookup failed</p>
            <p>{contacts.message}</p>
          </div>
        ) : contacts.contacts.length === 0 ? (
          <p className="text-sm text-slate-600">No contact emails were listed in the research summaries.</p>
        ) : (
          <div className="space-y-6">
            {contacts.contacts.map((group) => (
              <div key={group.group} className="space-y-2">
                <p className="text-sm font-semibold text-slate-800">{group.group}</p>
                {group.people.length === 0 ? (
                  <p className="text-sm text-slate-600">No emails mentioned for this group.</p>
                ) : (
                  <div className="overflow-auto rounded border border-slate-200">
                    <table className="min-w-full divide-y divide-slate-200 text-sm">
                      <thead className="bg-slate-50">
                        <tr>
                          <th className="px-3 py-2 text-left font-semibold text-slate-700">Name</th>
                          <th className="px-3 py-2 text-left font-semibold text-slate-700">Email</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {group.people.map((person, index) => (
                          <tr key={`${group.group}-${person.email}-${index}`}>
                            <td className="px-3 py-2 text-slate-700">{person.name ?? "—"}</td>
                            <td className="px-3 py-2 text-slate-700">
                              {person.email ? (
                                <a href={`mailto:${person.email}`} className="text-primary hover:underline">
                                  {person.email}
                                </a>
                              ) : (
                                "—"
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ResearcherThesesPanel({
  state,
  hasResearchGroups
}: {
  state: ResearcherThesesState | undefined;
  hasResearchGroups: boolean;
}) {
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

  return (
    <div className="flex-1 overflow-auto p-6 space-y-4">
      {researchers.map((researcher, index) => (
        <div
          key={`${researcher.name ?? researcher.email ?? index}`}
          className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
        >
          <div className="mb-2 flex flex-col gap-1">
            <p className="text-base font-semibold text-slate-800">
              {researcher.name ?? researcher.email ?? "Unnamed researcher"}
            </p>
            <div className="text-sm text-slate-600">
              {researcher.group && <p>Group: {researcher.group}</p>}
              {researcher.email && (
                <p>
                  Email: {" "}
                  <a href={`mailto:${researcher.email}`} className="text-primary hover:underline">
                    {researcher.email}
                  </a>
                </p>
              )}
              <p>Data publicly available: {researcher.data_publicly_available}</p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded border border-slate-100 p-3">
              <p className="text-sm font-semibold text-slate-700">Latest publication</p>
              {researcher.latest_publication?.title ? (
                <dl className="mt-2 space-y-1 text-sm text-slate-600">
                  <div>
                    <dt className="font-medium text-slate-700">Title</dt>
                    <dd>{researcher.latest_publication.title}</dd>
                  </div>
                  {researcher.latest_publication.year !== null && (
                    <div>
                      <dt className="font-medium text-slate-700">Year</dt>
                      <dd>{researcher.latest_publication.year}</dd>
                    </div>
                  )}
                  {researcher.latest_publication.venue && (
                    <div>
                      <dt className="font-medium text-slate-700">Venue</dt>
                      <dd>{researcher.latest_publication.venue}</dd>
                    </div>
                  )}
                  {researcher.latest_publication.url && (
                    <div>
                      <dt className="font-medium text-slate-700">Link</dt>
                      <dd>
                        <a
                          href={researcher.latest_publication.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline"
                        >
                          {researcher.latest_publication.url}
                        </a>
                      </dd>
                    </div>
                  )}
                </dl>
              ) : (
                <p className="mt-2 text-sm text-slate-600">No recent publication details found.</p>
              )}
            </div>

            <div className="rounded border border-slate-100 p-3">
              <p className="text-sm font-semibold text-slate-700">PhD thesis</p>
              {researcher.phd_thesis ? (
                <dl className="mt-2 space-y-1 text-sm text-slate-600">
                  {researcher.phd_thesis.title && (
                    <div>
                      <dt className="font-medium text-slate-700">Title</dt>
                      <dd>{researcher.phd_thesis.title}</dd>
                    </div>
                  )}
                  {researcher.phd_thesis.year !== null && (
                    <div>
                      <dt className="font-medium text-slate-700">Year</dt>
                      <dd>{researcher.phd_thesis.year}</dd>
                    </div>
                  )}
                  {researcher.phd_thesis.institution && (
                    <div>
                      <dt className="font-medium text-slate-700">Institution</dt>
                      <dd>{researcher.phd_thesis.institution}</dd>
                    </div>
                  )}
                  {researcher.phd_thesis.url && (
                    <div>
                      <dt className="font-medium text-slate-700">Link</dt>
                      <dd>
                        <a
                          href={researcher.phd_thesis.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline"
                        >
                          {researcher.phd_thesis.url}
                        </a>
                      </dd>
                    </div>
                  )}
                </dl>
              ) : (
                <p className="mt-2 text-sm text-slate-600">No thesis information found.</p>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ExpertNetworkPanel({ paper }: { paper: UploadedPaper | null }) {
  const mockExperts = [
    {
      role: "Leading Researcher",
      institution: "Top-tier Research University",
      focus: "Primary research area from paper"
    },
    {
      role: "Senior Professor",
      institution: "Technical Institute",
      focus: "Related methodology and applications"
    },
    {
      role: "Research Scientist",
      institution: "International Research Lab",
      focus: "Adjacent field and cross-disciplinary work"
    },
    {
      role: "Department Head",
      institution: "Engineering School",
      focus: "Applied research in domain area"
    },
    {
      role: "Principal Investigator",
      institution: "Research Center",
      focus: "Theoretical foundations"
    }
  ];

  if (!paper) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
        <p className="text-base font-medium text-slate-700">Upload a PDF to find relevant experts.</p>
        <p className="text-sm text-slate-500">We'll show experts working in related fields once you select a paper.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-slate-800">Expert Network</h2>
          <p className="mt-1 text-sm text-slate-600">
            Researchers and experts working in related areas
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {mockExperts.map((expert, index) => (
            <div
              key={index}
              className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md"
            >
              <h3 className="text-base font-semibold text-slate-900">{expert.role}</h3>
              <p className="mt-2 text-sm font-medium text-slate-700">{expert.institution}</p>
              <p className="mt-1 text-sm text-slate-600">{expert.focus}</p>
            </div>
          ))}
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
  const [uploadedPapers, setUploadedPapers] = useState<UploadedPaper[]>([]);
  const [activePaperId, setActivePaperId] = useState<string | null>(null);
  const [isSavingPaper, setIsSavingPaper] = useState(false);
  const [uploadStatusMessage, setUploadStatusMessage] = useState<string | null>(null);
  const [uploadErrorMessage, setUploadErrorMessage] = useState<string | null>(null);
  const [isFetchingLibrary, setIsFetchingLibrary] = useState(false);
  const [isStatusDismissed, setIsStatusDismissed] = useState(false);
  const [extractionStates, setExtractionStates] = useState<Record<string, ExtractionState>>({});
  const [researchGroupsStates, setResearchGroupsStates] = useState<Record<string, ResearchGroupsState>>({});
  const [researchContactsStates, setResearchContactsStates] = useState<Record<string, ResearchGroupContactsState>>({});
  const [researchThesesStates, setResearchThesesStates] = useState<Record<string, ResearcherThesesState>>({});
  const activePaper = activePaperId
    ? uploadedPapers.find((item) => item.id === activePaperId) ?? null
    : null;
  const activeExtraction = activePaper ? extractionStates[activePaper.id] : undefined;
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

  const clearObjectUrls = useCallback(() => {
    objectUrlsRef.current.forEach((url) => {
      URL.revokeObjectURL(url);
    });
    objectUrlsRef.current = [];
  }, []);

  useEffect(() => {
    if (!activePaper) {
      return;
    }

    const paperId = activePaper.id;

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
    activeResearchGroupState,
    activeResearchContactsState,
    activeResearchThesesState
  ]);

  const runExtraction = useCallback(
    async (paper: UploadedPaper, options?: { file?: File }) => {
      if (!paper) {
        return;
      }

      setExtractionStates((prev) => ({
        ...prev,
        [paper.id]: { status: "loading" }
      }));

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

  const runResearcherTheses = useCallback(
    async (
      paper: UploadedPaper,
      contacts: Array<{ group: string; people: Array<{ name: string | null; email: string | null }> }>
    ) => {
      if (!paper) {
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
    if (!paper || researchText.trim().length === 0) {
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
    if (!paper || !extraction?.text) {
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
      setUploadedPapers([]);
      setActivePaperId(null);
      setUploadStatusMessage(null);
      setUploadErrorMessage(null);
      setExtractionStates({});
      setResearchGroupsStates({});
      setResearchContactsStates({});
      setResearchThesesStates({});
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
    if (!activePaper) {
      return;
    }

    const state = extractionStates[activePaper.id];

    if (!state) {
      void runExtraction(activePaper);
    }
  }, [activePaper, extractionStates, runExtraction]);

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
      if (isSavingPaper) {
        return;
      }

      // Reset dismiss state on new upload
      setIsStatusDismissed(false);

      if (!user) {
        open("login");
        setUploadStatusMessage(null);
        setUploadErrorMessage("Sign in to save papers to your library.");
        return;
      }

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

          setUploadedPapers((prev) => [nextPaper, ...prev.filter((item) => item.id !== nextPaper.id)]);
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

          setUploadedPapers((prev) => [...prev, nextPaper]);
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
        />
      );
    }

    if (activeTab === "experts") {
      return <ExpertNetworkPanel paper={activePaper} />;
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
                : "flex-1 overflow-y-auto px-4 pb-8 pt-4 sm:px-6 lg:px-10"
            }
          >
            {renderActiveTab()}
          </div>
        </main>
      </div>
    </div>
  );
}
