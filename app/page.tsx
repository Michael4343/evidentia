"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { AppSidebar } from "@/components/app-sidebar";
import { PaperTabNav } from "@/components/paper-tab-nav";
import { TabHighlights } from "@/components/tab-highlights";
import { UploadDropzone } from "@/components/upload-dropzone";
import { useAuthModal } from "@/components/auth-modal-provider";
import { ReaderTabKey, TabHighlightItem, samplePaper } from "@/lib/mock-data";

interface UploadedPaper {
  id: string;
  name: string;
  fileName: string;
  url: string;
  uploadedAt: Date;
  size: number;
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
  activePaper
}: {
  onUpload: (file: File) => void;
  activePaper: UploadedPaper | null;
}) {
  if (!activePaper) {
    return <UploadDropzone onUpload={onUpload} />;
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold text-slate-900">{activePaper.name}</h2>
        <p className="text-sm text-slate-500">{activePaper.fileName}</p>
      </div>
      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <object
          data={activePaper.url}
          type="application/pdf"
          className="h-[70vh] w-full"
          aria-label={`Preview of ${activePaper.fileName}`}
        >
          <p className="p-4 text-sm text-slate-600">
            Your browser was unable to display this PDF.
            <a
              href={activePaper.url}
              download={activePaper.fileName}
              className="ml-2 text-primary underline"
            >
              Download the file instead.
            </a>
          </p>
        </object>
      </div>
      <div className="mx-auto w-full max-w-3xl">
        <UploadDropzone
          onUpload={onUpload}
          variant="compact"
          title="Upload another paper"
          description="or drop a new PDF to replace the active one."
          helperText="We will swap the reader to your newest upload."
        />
      </div>
    </div>
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
  const { user } = useAuthModal();
  const prevUserRef = useRef(user);
  const objectUrlsRef = useRef<string[]>([]);
  const [uploadedPapers, setUploadedPapers] = useState<UploadedPaper[]>([]);
  const [activePaperId, setActivePaperId] = useState<string | null>(null);
  const paper = samplePaper;
  const tabHighlightsByKey = paper.tabHighlights ?? {};
  const activePaper = activePaperId
    ? uploadedPapers.find((item) => item.id === activePaperId) ?? null
    : null;

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

  const handlePaperUpload = useCallback(
    (file: File) => {
      const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const url = URL.createObjectURL(file);
      objectUrlsRef.current.push(url);
      const rawName = file.name.replace(/\s+/g, " ").trim();
      const nameWithoutExtension = rawName.replace(/\.pdf$/i, "");

      const nextPaper: UploadedPaper = {
        id,
        name: nameWithoutExtension.length > 0 ? nameWithoutExtension : rawName || "Untitled paper",
        fileName: rawName || "upload.pdf",
        url,
        uploadedAt: new Date(),
        size: file.size
      };

      setUploadedPapers((prev) => [...prev, nextPaper]);
      setActivePaperId(id);
      setActiveTab("paper");
    },
    [setActiveTab]
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
      return <PaperTabContent onUpload={handlePaperUpload} activePaper={activePaper} />;
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
      />
      <div className="flex flex-1 flex-col">
        <main
          className="flex-1 overflow-y-auto"
          data-has-uploads={uploadedPapers.length > 0 ? "true" : "false"}
          data-active-paper={activePaperId ?? ""}
        >
          <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
            <div className="mx-auto flex w-full max-w-6xl items-center justify-center gap-4 px-4 py-4 sm:px-6 lg:px-10">
              <PaperTabNav
                activeTab={activeTab}
                onTabChange={setActiveTab}
                variant="horizontal"
              />
            </div>
          </header>
          <div className="px-4 pb-16 pt-8 sm:px-6 lg:px-10">
            {renderActiveTab()}
          </div>
        </main>
        <footer className="border-t border-slate-200 bg-white/80 px-4 py-6 text-sm text-slate-500 sm:px-6 lg:px-10">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p>&copy; {new Date().getFullYear()} Evidentia Labs.</p>
            <div className="flex gap-4">
              <a href="#" className="hover:text-slate-700">
                Terms
              </a>
              <a href="#" className="hover:text-slate-700">
                Privacy
              </a>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
