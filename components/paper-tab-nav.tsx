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
          : "relative flex flex-wrap items-center gap-1.5 rounded-full bg-white/70 p-1.5 shadow-[0_12px_30px_rgba(15,23,42,0.12)] ring-1 ring-inset ring-slate-200/60 backdrop-blur transition-shadow duration-200 hover:shadow-[0_18px_46px_rgba(15,23,42,0.18)] hover:ring-slate-200/90"
      }`}
    >
      {tabItems.map((item) => {
        const isActive = item.key === activeTab;
        const sharedClasses = "flex items-center gap-2 rounded-full text-sm font-medium transition-colors transition-shadow focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900";
        const buttonClasses = isVertical
          ? `${sharedClasses} justify-between px-4 py-3 text-left ${
              isActive
                ? "bg-slate-900 text-white shadow"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            }`
          : `${sharedClasses} px-4 py-2 ${
              isActive
                ? "bg-slate-900 text-white shadow-[0_8px_22px_rgba(15,23,42,0.35)]"
                : "text-slate-600 hover:bg-white/90 hover:text-slate-900"
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
