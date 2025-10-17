"use client";

import { ReaderTabKey } from "@/lib/mock-data";

interface AppSidebarProps {
  activeTab: ReaderTabKey;
  onTabChange: (tab: ReaderTabKey) => void;
  tabSummaries?: Partial<Record<Exclude<ReaderTabKey, "paper">, string>>;
}

const tabItems: Array<{ key: ReaderTabKey; label: string; hint?: string }> = [
  { key: "paper", label: "Paper", hint: "Reader" },
  { key: "similarPapers", label: "Similar Papers" },
  { key: "patents", label: "Patents" },
  { key: "theses", label: "PhD Theses" },
  { key: "experts", label: "Expert Network" }
];

export function AppSidebar({ activeTab, onTabChange, tabSummaries }: AppSidebarProps) {
  return (
    <aside className="hidden min-h-screen w-72 flex-col border-r border-slate-200 bg-white/80 px-6 pb-8 pt-10 shadow-sm lg:flex">
      <div className="flex items-center gap-3 text-slate-900">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-primary/90 text-sm font-semibold text-primary-foreground shadow-sm">
          Ev
        </span>
        <div>
          <p className="text-base font-semibold">Evidentia</p>
          <p className="text-xs text-slate-500">Interactive papers</p>
        </div>
      </div>
      <nav className="mt-8 flex-1 space-y-2">
        {tabItems.map((item) => {
          const isActive = item.key === activeTab;
          const summaryKey = item.key as Exclude<ReaderTabKey, "paper">;
          const summary = item.key === "paper" ? item.hint : tabSummaries?.[summaryKey];

          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onTabChange(item.key)}
              className={`w-full rounded-2xl border px-4 py-3 text-left transition-colors ${
                isActive
                  ? "border-slate-900 bg-slate-900 text-white shadow-lg"
                  : "border-transparent bg-white/60 text-slate-600 hover:border-slate-200 hover:bg-white"
              }`}
              aria-pressed={isActive}
            >
              <div className="flex items-center justify-between text-sm font-semibold">
                <span>{item.label}</span>
                {summary && (
                  <span className={`text-xs ${isActive ? "text-white/80" : "text-slate-400"}`}>
                    {summary}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </nav>
      <div className="mt-8 space-y-3 rounded-2xl border border-slate-200 bg-white/70 p-4 text-sm text-slate-600">
        <p className="font-semibold text-slate-900">Stay signed in</p>
        <p className="text-xs text-slate-500">Save highlights and request expert verification once authenticated.</p>
        <button className="w-full rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-primary/40 hover:text-slate-900">
          Sign in
        </button>
      </div>
    </aside>
  );
}
