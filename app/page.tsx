"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AppSidebar } from "@/components/app-sidebar";
import { PaperTabNav } from "@/components/paper-tab-nav";
import { PdfViewer } from "@/components/pdf-viewer";
import { TabHighlights } from "@/components/tab-highlights";
import { UploadDropzone } from "@/components/upload-dropzone";
import { useAuthModal } from "@/components/auth-modal-provider";
import { ReaderTabKey, TabHighlightItem, samplePaper } from "@/lib/mock-data";
import { extractDoiFromPdf } from "@/lib/pdf-doi";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { fetchUserPapers, persistUserPaper, type UserPaperRecord } from "@/lib/user-papers";

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

const tabCopy: Record<Exclude<ReaderTabKey, "paper">, { heading: string; description: string; empty: string }> = {
  similarPapers: {
    heading: "Similar papers",
    description: "Compare neighbouring research that validates or challenges this paper's claims.",
    empty: "Similar papers will populate once the processing pipeline promotes related work."
  },
  patents: {
    heading: "Patent landscape",
    description: "Track intellectual property that references or builds on this approach.",
    empty: "No related patents yet. We'll surface applications as they appear."
  },
  theses: {
    heading: "PhD theses",
    description: "Survey doctoral research that explores the same methods or datasets.",
    empty: "No theses are linked to this paper yet."
  },
  experts: {
    heading: "Experts to loop in",
    description: "Connect with reviewers who specialise in this domain for verification.",
    empty: "Expert recommendations will unlock once the network is live."
  }
};

function PaperTabContent({
  onUpload,
  activePaper,
  isUploading,
  statusMessage,
  errorMessage,
  helperText,
  viewerClassName
}: {
  onUpload: (file: File) => void;
  activePaper: UploadedPaper | null;
  isUploading: boolean;
  statusMessage: string | null;
  errorMessage: string | null;
  helperText?: string;
  viewerClassName?: string;
}) {
  if (!activePaper) {
    return (
      <div className="space-y-4">
        <UploadDropzone
          onUpload={onUpload}
          helperText={isUploading ? "Saving your paper to the library…" : helperText}
        />
        {(statusMessage || errorMessage) && (
          <p className={`text-sm ${errorMessage ? "text-red-600" : "text-slate-500"}`}>
            {errorMessage ?? statusMessage}
          </p>
        )}
      </div>
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

function HighlightsTabContent({
  tab,
  items
}: {
  tab: Exclude<ReaderTabKey, "paper">;
  items: TabHighlightItem[];
}) {
  const copy = tabCopy[tab];

  return (
    <div className="space-y-6">
      <TabHighlights
        heading={copy.heading}
        description={copy.description}
        items={items}
        emptyMessage={copy.empty}
      />
    </div>
  );
}

export default function LandingPage() {
  const [activeTab, setActiveTab] = useState<ReaderTabKey>("paper");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { user, open } = useAuthModal();
  const prevUserRef = useRef(user);
  const objectUrlsRef = useRef<string[]>([]);
  const [uploadedPapers, setUploadedPapers] = useState<UploadedPaper[]>([]);
  const [activePaperId, setActivePaperId] = useState<string | null>(null);
  const [isSavingPaper, setIsSavingPaper] = useState(false);
  const [uploadStatusMessage, setUploadStatusMessage] = useState<string | null>(null);
  const [uploadErrorMessage, setUploadErrorMessage] = useState<string | null>(null);
  const [isFetchingLibrary, setIsFetchingLibrary] = useState(false);
  const paper = samplePaper;
  const tabHighlightsByKey = paper.tabHighlights ?? {};
  const activePaper = activePaperId
    ? uploadedPapers.find((item) => item.id === activePaperId) ?? null
    : null;
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
        setUploadErrorMessage("We could not load your saved papers just now.");
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
      if (isSavingPaper) {
        return;
      }

      if (!user) {
        open("login");
        setUploadStatusMessage(null);
        setUploadErrorMessage("Sign in to save papers to your library.");
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
        }
      } catch (error) {
        console.error("Failed to process upload", error);
        setUploadErrorMessage("We could not save your paper. Please try again.");
      } finally {
        setIsSavingPaper(false);
      }
    },
    [isSavingPaper, open, setActiveTab, supabase, user]
  );

  const handleSelectPaper = useCallback(
    (paperId: string) => {
      setActivePaperId(paperId);
      setActiveTab("paper");
    },
    [setActiveTab]
  );

  const renderActiveTab = () => {
    if (activeTab === "paper") {
      return (
        <PaperTabContent
          onUpload={handlePaperUpload}
          activePaper={activePaper}
          isUploading={isSavingPaper}
          statusMessage={uploadErrorMessage ? null : uploadStatusMessage}
          errorMessage={uploadErrorMessage}
          helperText={dropzoneHelperText}
          viewerClassName={isPaperViewerActive ? "!h-full w-full flex-1" : undefined}
        />
      );
    }

    const tabKey = activeTab as Exclude<ReaderTabKey, "paper">;
    const items = tabHighlightsByKey[tabKey] ?? [];
    return <HighlightsTabContent tab={tabKey} items={items} />;
  };

  return (
    <div className="flex min-h-screen bg-gradient-to-br from-slate-100 via-white to-slate-100 text-slate-900">
      <AppSidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((prev) => !prev)}
        papers={uploadedPapers}
        activePaperId={activePaperId}
        onSelectPaper={handleSelectPaper}
        onUpload={handlePaperUpload}
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
