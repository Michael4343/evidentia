"use client";

import { useState } from "react";
import Image from "next/image";

import { useAuthModal } from "@/components/auth-modal-provider";

interface SidebarPaperItem {
  id: string;
  name: string;
  fileName: string;
  uploadedAt: Date;
  doi?: string | null;
}

interface AppSidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  papers: SidebarPaperItem[];
  activePaperId: string | null;
  onSelectPaper: (paperId: string) => void;
  onShowUpload?: () => void;
  isLoading?: boolean;
}

export function AppSidebar({
  collapsed,
  onToggle,
  papers,
  activePaperId,
  onSelectPaper,
  onShowUpload,
  isLoading = false
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

  const handleAddPaperClick = () => {
    onShowUpload?.();
  };

  return (
    <aside
      className={`relative flex min-h-screen flex-col border-r border-slate-200 bg-white/95 pb-4 pt-4 shadow-sm transition-all duration-300 ${
        isCollapsed ? "w-20 px-4" : "w-64 px-6"
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="absolute -right-3 top-4 inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-base font-semibold text-slate-500 shadow-sm transition hover:border-slate-300 hover:text-slate-900"
        aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        <span aria-hidden="true">{isCollapsed ? "›" : "‹"}</span>
      </button>
      <div className={`flex items-center ${isCollapsed ? "justify-center" : "gap-3"} text-slate-900`}>
        <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-full">
          <Image
            src="/logo.png"
            alt="Evidentia logo"
            width={32}
            height={32}
            className="rounded-full object-contain"
          />
        </div>
        {!isCollapsed && <p className="text-base font-semibold">Evidentia</p>}
      </div>

      <button
        type="button"
        onClick={() => {
          void handleAuthClick();
        }}
        disabled={user ? isSigningOut : !isAuthReady}
        className={`mt-4 flex items-center justify-center rounded-full border border-slate-200 text-sm font-semibold text-slate-600 transition hover:border-primary/40 hover:text-slate-900 ${
          isCollapsed ? "h-12 w-12" : "h-10 w-full px-4"
        } ${user && isSigningOut ? "opacity-70" : ""}`}
        aria-label={user ? "Sign out" : "Sign in"}
      >
        {isCollapsed ? (
          <span aria-hidden="true" className="text-lg">
            👤
          </span>
        ) : (
          <span>{user ? (isSigningOut ? "Signing out…" : "Sign out") : "Sign in"}</span>
        )}
      </button>

      <button
        type="button"
        onClick={handleAddPaperClick}
        disabled={isLoading}
        className={`mt-3 flex items-center justify-center rounded-full border border-dashed border-slate-300 text-sm font-semibold text-slate-600 transition hover:border-slate-400 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50 ${
          isCollapsed ? "h-12 w-12" : "h-12 w-full px-4"
        }`}
        aria-label="Add paper"
      >
        {isCollapsed ? (
          <span aria-hidden="true" className="text-lg">
            +
          </span>
        ) : (
          <span>Add paper</span>
        )}
      </button>

      <div className="mt-6 flex-1">
        {isCollapsed ? (
          <button
            type="button"
            onClick={onToggle}
            className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-slate-200 text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
            aria-label="Open library"
          >
            <span aria-hidden="true" className="text-lg">📚</span>
          </button>
        ) : (
          <p className="text-sm font-semibold text-slate-500">
            Library
          </p>
        )}
        <div className={`mt-4 ${isCollapsed ? "space-y-3" : "space-y-2"}`}>
          {hasPapers ? (
            <ul className="space-y-2">
              {papers.map((paper) => {
                const isActive = paper.id === activeId;

                // Build classes more explicitly to avoid Tailwind conflicts
                const baseClasses = isCollapsed
                  ? "mx-auto h-12 w-12 rounded-full border text-xs font-semibold"
                  : "w-full rounded-2xl border px-4 py-3 text-left text-sm font-semibold";

                const stateClasses = isActive
                  ? isCollapsed
                    ? "border-slate-900 bg-slate-900 text-white shadow-md"
                    : "border-slate-900 bg-white text-slate-900 shadow-sm ring-1 ring-slate-900/20"
                  : isCollapsed
                    ? "border-transparent bg-white/70 text-slate-500 hover:border-slate-300 hover:bg-white"
                    : "border-slate-200 bg-white/70 text-slate-700 hover:border-slate-300 hover:bg-white";
                const trimmedName = paper.name?.trim() ?? "";
                const cleanedFileName = (paper.fileName ?? "").replace(/\s+/g, " ").trim();
                const baseLabel = cleanedFileName.replace(/\.pdf$/i, "");
                const displayLabel =
                  trimmedName.length > 0
                    ? trimmedName
                    : baseLabel.length > 0
                      ? baseLabel
                      : cleanedFileName.length > 0
                        ? cleanedFileName
                        : paper.name ?? paper.fileName ?? paper.id;
                const finalLabel = displayLabel || paper.doi || "Untitled paper";

                return (
                  <li key={paper.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onSelectPaper(paper.id);
                      }}
                      className={`${baseClasses} ${stateClasses} transition-colors ${isCollapsed ? "flex items-center justify-center" : ""}`}
                      aria-pressed={isActive}
                    >
                      {isCollapsed ? (
                        <span aria-hidden="true">
                          {finalLabel.slice(0, 2).toUpperCase()}
                        </span>
                      ) : (
                        <span className="truncate">{finalLabel}</span>
                      )}
                      <span className="sr-only">Select {finalLabel}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            !isCollapsed && (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-white/60 px-4 py-6 text-center text-xs text-slate-400">
                {isLoading ? "Loading your papers…" : "No papers yet. Upload a PDF to see it here."}
              </div>
            )
          )}
        </div>
      </div>
    </aside>
  );
}
