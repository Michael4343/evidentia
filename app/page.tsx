"use client";

import { useEffect, useState } from "react";

import { AppSidebar } from "@/components/app-sidebar";
import { PaperHero } from "@/components/paper-hero";
import { PaperTabNav } from "@/components/paper-tab-nav";
import { TabHighlights } from "@/components/tab-highlights";
import { UploadDropzone } from "@/components/upload-dropzone";
import { PaperDetail, ReaderTabKey, TabHighlightItem, samplePaper } from "@/lib/mock-data";

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

function PaperTabContent({ paper }: { paper: PaperDetail }) {
  return (
    <div className="space-y-8">
      <UploadDropzone />
      <PaperHero paper={paper} />
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
  const paper = samplePaper;
  const tabHighlightsByKey = paper.tabHighlights ?? {};

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 1023px)");
    if (mediaQuery.matches) {
      setSidebarCollapsed(true);
    }
  }, []);

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
      <AppSidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((prev) => !prev)}
      />
      <div className="flex flex-1 flex-col">
        <main className="flex-1 overflow-y-auto">
          <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/85 px-4 py-5 backdrop-blur sm:px-6 lg:px-10">
            <PaperTabNav activeTab={activeTab} onTabChange={setActiveTab} variant="horizontal" />
          </div>
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
