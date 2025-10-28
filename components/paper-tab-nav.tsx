"use client";

import { readerTabs, type ReaderTabKey } from "@/lib/reader-tabs";

type TabVariant = "horizontal" | "vertical";

type HorizontalAlignment = "center" | "start";

interface PaperTabNavProps {
  activeTab: ReaderTabKey;
  onTabChange?: (tab: ReaderTabKey) => void;
  variant?: TabVariant;
  align?: HorizontalAlignment;
}

export function PaperTabNav({
  activeTab,
  onTabChange,
  variant = "horizontal",
  align = "center"
}: PaperTabNavProps) {
  const isVertical = variant === "vertical";

  const alignmentClasses = align === "start" ? "justify-start" : "justify-start md:justify-center";

  const navClasses = isVertical
    ? "flex flex-col gap-2"
    : `flex w-full items-center ${alignmentClasses} gap-2 overflow-x-auto px-1 py-2`;

  return (
    <nav className={navClasses}>
      {readerTabs.map((item) => {
        const isActive = item.key === activeTab;
        const sharedClasses = "flex items-center gap-2 rounded-full text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900";
        const buttonClasses = isVertical
          ? `${sharedClasses} justify-between px-4 py-3 text-left ${
              isActive
                ? "bg-slate-900 text-white shadow"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            }`
          : `${sharedClasses} whitespace-nowrap px-4 py-2 ${
              isActive
                ? "bg-slate-900 text-white"
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
