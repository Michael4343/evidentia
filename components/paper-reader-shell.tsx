"use client";

import { ReactNode } from "react";

import { ReaderSidebar } from "@/components/reader-sidebar";
import { PaperReaderHeader } from "@/components/paper-reader-header";
import { PaperDetail, ReaderTabKey } from "@/lib/mock-data";

interface PaperReaderShellProps {
  activeSlug: string;
  activeTab: ReaderTabKey;
  onSelectPaper?: (slug: string) => void;
  onSelectTab?: (tab: ReaderTabKey) => void;
  paper: PaperDetail;
  children: ReactNode;
}

export function PaperReaderShell({
  activeSlug,
  activeTab,
  onSelectPaper,
  onSelectTab,
  paper,
  children
}: PaperReaderShellProps) {
  return (
    <div className="pb-16">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <ReaderSidebar activeSlug={activeSlug} onSelectPaper={onSelectPaper} />
        <div className="flex-1 space-y-8">
          <PaperReaderHeader
            paper={paper}
            activeTab={activeTab}
            onSelectTab={onSelectTab}
          />
          <div className="grid gap-6">{children}</div>
        </div>
      </div>
    </div>
  );
}
