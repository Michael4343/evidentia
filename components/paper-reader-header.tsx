"use client";

import { PaperTabNav } from "@/components/paper-tab-nav";
import { PaperDetail, ReaderTabKey } from "@/lib/mock-data";

interface PaperReaderHeaderProps {
  paper: PaperDetail;
  activeTab: ReaderTabKey;
  onSelectTab?: (tab: ReaderTabKey) => void;
  processingNote?: string;
}

export function PaperReaderHeader({
  paper,
  activeTab,
  onSelectTab,
  processingNote = "Figures will surface once the worker pipeline promotes them."
}: PaperReaderHeaderProps) {
  const { title, authors, venue, year, status, abstract } = paper;

  return (
    <header className="space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
            {venue} · {year}
          </p>
          <h1 className="text-2xl font-semibold text-slate-900 sm:text-3xl">{title}</h1>
          <p className="text-sm text-slate-500">{authors.join(", ")}</p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-600">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          {status}
        </span>
      </div>
      <p className="text-sm leading-relaxed text-slate-700">{abstract}</p>
      <div>
        <PaperTabNav activeTab={activeTab} onTabChange={onSelectTab} align="start" />
      </div>
      <p className="text-xs text-slate-500">
        Processing complete · {processingNote}
      </p>
    </header>
  );
}
