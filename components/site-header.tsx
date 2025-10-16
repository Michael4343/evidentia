"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navLinks = [
  { href: "/", label: "Paper", match: (pathname: string) => pathname === "/" || pathname.startsWith("/paper") },
  { href: "/paper/demo/similar-papers", label: "Similar Papers", match: (pathname: string) => pathname.includes("similar-papers") },
  { href: "/paper/demo/patents", label: "Patents", match: (pathname: string) => pathname.includes("patents") },
  { href: "/paper/demo/theses", label: "PhD Theses", match: (pathname: string) => pathname.includes("theses") },
  { href: "/paper/demo/experts", label: "Expert Network", match: (pathname: string) => pathname.includes("experts") }
];

export function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/70">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 text-lg font-semibold text-slate-900">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-primary/90 text-sm font-bold text-primary-foreground shadow-sm">
            Ev
          </span>
          Evidentia
        </Link>
        <nav className="hidden gap-2 text-sm font-medium text-slate-600 sm:flex">
          {navLinks.map((item) => {
            const isActive = item.match(pathname);
            return (
              <Link
                key={item.label}
                href={item.href}
                className={`rounded-full px-3 py-1.5 transition-colors ${
                  isActive
                    ? "bg-slate-900 text-white shadow-sm"
                    : "hover:bg-slate-100 hover:text-slate-900"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-2">
          <button className="rounded-full border border-slate-200 px-3 py-1 text-sm font-medium text-slate-600 transition-colors hover:border-primary/30 hover:text-slate-900">
            Sign in
          </button>
        </div>
      </div>
    </header>
  );
}
