"use client";

import { useState } from "react";

import { AnnotationSidebar } from "@/components/annotation-sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { PaperHero } from "@/components/paper-hero";
import { PaperTabNav } from "@/components/paper-tab-nav";
import { PdfViewerMock } from "@/components/pdf-viewer-mock";
import { StatusBanner } from "@/components/status-banner";
import { TabHighlights } from "@/components/tab-highlights";
import { UploadDropzone } from "@/components/upload-dropzone";
import { PaperDetail, ReaderTabKey, TabHighlightItem, samplePaper } from "@/lib/mock-data";

const readerTips = [
  "Use the page navigator to jump between sections once processing completes.",
  "Highlights and comments sync in realtime across collaborators.",
  "Verification requests notify experts when the queue is enabled."
];

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

const tabOptions: Array<{ key: ReaderTabKey; label: string }> = [
  { key: "paper", label: "Paper" },
  { key: "similarPapers", label: "Similar Papers" },
  { key: "patents", label: "Patents" },
  { key: "theses", label: "PhD Theses" },
  { key: "experts", label: "Expert Network" }
];

function PaperTabContent({ paper }: { paper: PaperDetail }) {
  return (
    <div className="space-y-8">
      <UploadDropzone />
      <StatusBanner />
      <PaperHero paper={paper} />
      <section className="rounded-3xl border border-slate-200 bg-white/95 p-5 shadow-sm">
        <header className="mb-4 flex flex-wrap items-center justify-between gap-4 text-sm text-slate-500">
          <span className="inline-flex items-center gap-2 text-slate-600">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            Ready to explore
          </span>
          <span className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-500">
            PDF viewer prototype
          </span>
        </header>
        <PdfViewerMock />
        <p className="mt-4 text-xs text-slate-500">
          Figures render within the viewer. Hotspots and thumbnails arrive once the worker pipeline ships.
        </p>
      </section>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section className="rounded-3xl border border-slate-200 bg-white/90 p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-900">Reader basics</h3>
          <ul className="mt-3 space-y-2 text-sm text-slate-600">
            {readerTips.map((tip) => (
              <li key={tip} className="flex gap-2">
                <span className="mt-1 h-1.5 w-1.5 rounded-full bg-primary/70" />
                <span>{tip}</span>
              </li>
            ))}
          </ul>
        </section>
        <AnnotationSidebar comments={paper.comments} />
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
      <StatusBanner />
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
  const paper = samplePaper;
  const tabHighlightsByKey = paper.tabHighlights ?? {};
  const tabSummaries = paper.tabSummaries ?? {};

  const renderActiveTab = () => {
    if (activeTab === "paper") {
      return <PaperTabContent paper={paper} />;
    }

    const tabKey = activeTab as Exclude<ReaderTabKey, "paper">;
    const items = tabHighlightsByKey[tabKey] ?? [];
    return <HighlightsTabContent tab={tabKey} items={items} />;
  };

  return (
    <div className="flex min-h-screen bg-gradient-to-br from-slate-100 via-white to-slate-100 text-slate-900">
      <AppSidebar activeTab={activeTab} onTabChange={setActiveTab} tabSummaries={tabSummaries} />
      <div className="flex flex-1 flex-col">
        <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/80 px-4 py-4 backdrop-blur lg:hidden">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-primary/90 text-sm font-semibold text-primary-foreground shadow-sm">
                Ev
              </span>
              <span className="text-base font-semibold">Evidentia</span>
            </div>
            <button className="rounded-full border border-slate-200 px-3 py-1 text-sm font-medium text-slate-600 transition hover:border-primary/40 hover:text-slate-900">
              Sign in
            </button>
          </div>
          <PaperTabNav activeTab={activeTab} onTabChange={setActiveTab} variant="horizontal" />
        </header>
        <main className="flex-1 overflow-y-auto px-4 pb-16 pt-8 sm:px-6 lg:px-10">
          {renderActiveTab()}
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
