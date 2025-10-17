"use client";

import { useAuthModal } from "@/components/auth-modal-provider";

import { useState } from "react";
import { mockPaperLibrary, ReaderTabKey } from "@/lib/mock-data";

interface ReaderSidebarProps {
  activeSlug: string;
  onSelectPaper?: (slug: string) => void;
}

function getInitials(title: string) {
  const parts = title.split(" ").filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const second = parts[1]?.[0] ?? parts[0]?.[1] ?? "";
  return (first + second).toUpperCase();
}

export function ReaderSidebar({ activeSlug, onSelectPaper }: ReaderSidebarProps) {
  const { open, user, signOut, isAuthReady } = useAuthModal();
  const [collapsed, setCollapsed] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const library = mockPaperLibrary;
  const tabOrder: Exclude<ReaderTabKey, "paper">[] = [
    "similarPapers",
    "patents",
    "theses",
    "experts"
  ];
  const tabLabels: Record<Exclude<ReaderTabKey, "paper">, string> = {
    similarPapers: "Similar papers",
    patents: "Patents",
    theses: "PhD theses",
    experts: "Experts"
  };

  const userInitial = user?.email?.[0]?.toUpperCase() ?? "U";

  const handleSignOut = async () => {
    if (isSigningOut) {
      return;
    }
    setIsSigningOut(true);
    try {
      await signOut();
    } catch (error) {
      console.error("Sign out failed", error);
    } finally {
      setIsSigningOut(false);
    }
  };

  return (
    <aside
      className={`relative flex h-full flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white/95 shadow-sm transition-all duration-300 ease-out ${
        collapsed ? "lg:w-[5.5rem]" : "lg:w-[21.5rem]"
      } w-full lg:shrink-0 lg:sticky lg:top-24`
    }
      style={collapsed ? { width: "5.5rem" } : undefined}
    >
      <button
        type="button"
        onClick={() => setCollapsed((prev) => !prev)}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:text-slate-900"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className={`h-4 w-4 transition-transform ${collapsed ? "rotate-180" : ""}`}
        >
          <path d="M14 7l-5 5 5 5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <div className={`flex items-center gap-3 px-5 pb-4 pt-6 ${collapsed ? "justify-center" : "justify-between"}`}>
        <div className="flex items-center gap-2">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-primary/90 text-sm font-semibold text-primary-foreground shadow-sm">
            Ev
          </span>
          {!collapsed && <span className="text-base font-semibold text-slate-900">Evidentia</span>}
        </div>
        {!collapsed && (
          user ? (
            <button
              type="button"
              onClick={handleSignOut}
              disabled={isSigningOut}
              className="rounded-full border border-slate-200 px-3 py-1 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSigningOut ? "Signing out…" : "Sign out"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => open("signup")}
              disabled={!isAuthReady}
              className="rounded-full border border-slate-200 px-3 py-1 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Sign up
            </button>
          )
        )}
      </div>

      {user && (
        <div className={`flex items-center ${collapsed ? "justify-center gap-2 px-4" : "gap-3 px-5"} pb-4 text-slate-700`}>
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white">
            {userInitial}
          </span>
          {!collapsed && (
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Signed in</p>
              <p className="text-sm font-semibold text-slate-700">{user.email}</p>
            </div>
          )}
        </div>
      )}

      <div className={`px-5 ${collapsed ? "text-center" : ""}`}>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Your papers</p>
      </div>

      <ul className="mt-4 flex-1 space-y-3 overflow-y-auto px-4 pb-6 lg:max-h-[calc(100vh-11rem)]">
        {library.map((paper) => {
          const isActive = paper.slug === activeSlug;
          const baseItemClasses = collapsed
            ? "flex flex-col items-center gap-2 rounded-2xl border border-transparent bg-white/80 p-3 text-xs font-medium text-slate-500"
            : "flex items-start gap-3 rounded-2xl border border-slate-100 bg-white/80 p-4 text-sm text-slate-600";
          const activeClasses = isActive
            ? "border-slate-900 bg-slate-900 text-white shadow-lg"
            : "hover:border-slate-200 hover:bg-white";

          const cardContent = (
            <>
              <span
                className={`flex h-11 w-11 items-center justify-center rounded-2xl text-sm font-semibold shadow-inner ${
                  isActive ? "bg-white/15 text-white" : "bg-slate-100 text-slate-700"
                }`}
              >
                {getInitials(paper.title)}
              </span>
              {!collapsed && (
                <div className="flex-1">
                  <div className="flex items-center justify-between text-xs uppercase tracking-wide text-slate-400">
                    <span>{paper.owner}</span>
                    <span>{paper.uploadedAt}</span>
                  </div>
                  <p className="mt-1 text-sm font-medium text-slate-900">{paper.title}</p>
                  <p className="mt-1 text-xs text-slate-500">{paper.doi}</p>
                  <div className="mt-3 flex flex-wrap gap-1 text-[11px]">
                    {tabOrder
                      .filter((key) => paper.tabSummaries?.[key])
                      .map((key) => (
                        <span
                          key={key}
                          className={`rounded-full px-2 py-1 font-medium ${
                            isActive ? "bg-white/15 text-white" : "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {tabLabels[key]}
                          <span
                            className={`ml-1 font-semibold ${
                              isActive ? "text-white/90" : "text-slate-700"
                            }`}
                          >
                            {paper.tabSummaries?.[key]}
                          </span>
                        </span>
                      ))}
                  </div>
                </div>
              )}
            </>
          );

          return (
            <li key={paper.id}>
              {onSelectPaper ? (
                <button
                  type="button"
                  onClick={() => onSelectPaper(paper.slug)}
                  className={`${baseItemClasses} transition-colors ${activeClasses}`}
                  aria-pressed={isActive}
                >
                  {cardContent}
                </button>
              ) : (
                <div className={`${baseItemClasses} transition-colors ${activeClasses}`}>
                  {cardContent}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
