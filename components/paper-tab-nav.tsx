"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabItems = [
  { segment: undefined, href: (doi: string) => `/paper/${doi}`, label: "Paper" },
  {
    segment: "similar-papers",
    href: (doi: string) => `/paper/${doi}/similar-papers`,
    label: "Similar Papers"
  },
  {
    segment: "patents",
    href: (doi: string) => `/paper/${doi}/patents`,
    label: "Similar Patents"
  },
  {
    segment: "theses",
    href: (doi: string) => `/paper/${doi}/theses`,
    label: "PhD Theses"
  },
  {
    segment: "experts",
    href: (doi: string) => `/paper/${doi}/experts`,
    label: "Expert Network"
  }
];

interface PaperTabNavProps {
  doi: string;
}

export function PaperTabNav({ doi }: PaperTabNavProps) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white/90 p-1.5 shadow-sm">
      {tabItems.map((item) => {
        const href = item.href(doi);
        const isActive = pathname === href;
        return (
          <Link
            key={item.label}
            href={href}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
              isActive
                ? "bg-slate-900 text-white shadow"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
