"use client";

import { ReaderTabKey } from "@/lib/mock-data";

type TabVariant = "horizontal" | "vertical";

const tabItems: Array<{ key: ReaderTabKey; label: string }> = [
  { key: "paper", label: "Paper" },
  { key: "similarPapers", label: "Similar Papers" },
  { key: "patents", label: "Patents" },
  { key: "theses", label: "PhD Theses" },
  { key: "experts", label: "Expert Network" }
];

interface PaperTabNavProps {
  activeTab: ReaderTabKey;
  onTabChange?: (tab: ReaderTabKey) => void;
  variant?: TabVariant;
}

export function PaperTabNav({ activeTab, onTabChange, variant = "horizontal" }: PaperTabNavProps) {
  const isVertical = variant === "vertical";

  return (
    <nav
      className={`${
        isVertical
          ? "flex flex-col gap-2"
          : "flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white/90 p-1.5 shadow-sm"
      }`}
    >
      {tabItems.map((item) => {
        const isActive = item.key === activeTab;
        const sharedClasses = "flex items-center gap-2 rounded-xl text-sm font-medium transition-colors";
        const buttonClasses = isVertical
          ? `${sharedClasses} justify-between px-4 py-3 text-left ${
              isActive
                ? "bg-slate-900 text-white shadow"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            }`
          : `${sharedClasses} px-4 py-2 ${
              isActive
                ? "bg-slate-900 text-white shadow"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            }`;

        return (
          <button
            key={item.key}
            type="button"
            className={buttonClasses}
            onClick={() => onTabChange?.(item.key)}
            aria-pressed={isActive}
          >
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}
