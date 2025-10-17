"use client";

import { useState } from "react";

import { useAuthModal } from "@/components/auth-modal-provider";

interface SidebarPaperItem {
  id: string;
  name: string;
  fileName: string;
  uploadedAt: Date;
}

interface AppSidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  papers: SidebarPaperItem[];
  activePaperId: string | null;
  onSelectPaper: (paperId: string) => void;
}

export function AppSidebar({
  collapsed,
  onToggle,
  papers,
  activePaperId,
  onSelectPaper
}: AppSidebarProps) {
  const isCollapsed = collapsed;
  const activeId = activePaperId;
  const hasPapers = papers.length > 0;
  const { open, user, signOut, isAuthReady } = useAuthModal();
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleAuthClick = async () => {
    if (user) {
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
      return;
    }
    open("login");
  };

  return (
    <aside
      className={`relative flex min-h-screen flex-col border-r border-slate-200 bg-white/95 pb-8 pt-8 shadow-sm transition-all duration-300 ${
        isCollapsed ? "w-20 px-4" : "w-64 px-6"
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="absolute -right-3 top-8 inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-base font-semibold text-slate-500 shadow-sm transition hover:border-slate-300 hover:text-slate-900"
        aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        <span aria-hidden="true">{isCollapsed ? "›" : "‹"}</span>
      </button>
      <div className={`flex items-center ${isCollapsed ? "justify-center" : "gap-3"} text-slate-900`}>
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/90 text-sm font-semibold text-primary-foreground shadow-sm">
          Ev
        </span>
        {!isCollapsed && <p className="text-base font-semibold">Evidentia</p>}
      </div>

      <button
        type="button"
        onClick={() => {
          void handleAuthClick();
        }}
        disabled={user ? isSigningOut : !isAuthReady}
        className={`mt-8 flex items-center justify-center rounded-full border border-slate-200 text-sm font-semibold text-slate-600 transition hover:border-primary/40 hover:text-slate-900 ${
          isCollapsed ? "h-10 w-10" : "h-10 w-full px-4"
        } ${user && isSigningOut ? "opacity-70" : ""}`}
        aria-label={user ? "Sign out" : "Sign in"}
      >
        {isCollapsed ? (
          <span aria-hidden="true" className="text-base">
            👤
          </span>
        ) : (
          <span>{user ? (isSigningOut ? "Signing out…" : "Sign out") : "Sign in"}</span>
        )}
      </button>

      <div className="mt-10 flex-1">
        <p
          className={`text-[11px] font-semibold uppercase tracking-wide text-slate-400 ${
            isCollapsed ? "flex items-center justify-center gap-1" : ""
          } ${isCollapsed ? "text-center" : ""}`}
        >
          {isCollapsed ? (
            <span aria-hidden="true" className="text-base">
              📚
            </span>
          ) : (
            "Library"
          )}
          {isCollapsed && <span className="sr-only">Library</span>}
        </p>
        <div className={`mt-4 ${isCollapsed ? "space-y-3" : "space-y-2"}`}>
          {hasPapers ? (
            <ul className="space-y-2">
              {papers.map((paper) => {
                const isActive = paper.id === activeId;
                const baseClasses = isCollapsed
                  ? "w-full rounded-2xl border border-transparent bg-white/70 px-0 py-3 text-xs font-medium text-slate-500"
                  : "w-full rounded-2xl border border-slate-200 bg-white/70 px-4 py-3 text-left text-sm text-slate-700";
                const activeClasses = isActive
                  ? "border-slate-900 bg-slate-900 text-white shadow-md"
                  : "hover:border-slate-300 hover:bg-white";

                return (
                  <li key={paper.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onSelectPaper(paper.id);
                      }}
                      className={`${baseClasses} transition-colors ${activeClasses}`}
                      aria-pressed={isActive}
                    >
                      {isCollapsed ? (
                        <span className="flex items-center justify-center text-sm font-semibold" aria-hidden="true">
                          {paper.name.slice(0, 2).toUpperCase()}
                        </span>
                      ) : (
                        <div className="flex flex-col">
                          <span className="truncate font-medium">{paper.name}</span>
                          <span className="truncate text-xs text-slate-400">{paper.fileName}</span>
                        </div>
                      )}
                      <span className="sr-only">Select {paper.fileName}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div
              className={`rounded-2xl border border-dashed border-slate-200 bg-white/60 px-4 py-6 text-center text-xs text-slate-400 ${
                isCollapsed ? "px-0" : ""
              }`}
            >
              {isCollapsed ? "No papers" : "No papers yet. Upload a PDF to see it here."}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
