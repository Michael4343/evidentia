"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

import { useAuthModal } from "@/components/auth-modal-provider";
import { listMockLibraryEntryIds } from "@/lib/mock-library";

const MOCK_ENTRY_IDS = listMockLibraryEntryIds();
const MOCK_ENTRY_ID_SET = new Set(MOCK_ENTRY_IDS);
const DESKTOP_BREAKPOINT = 768;

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
  onDeletePaper?: (paperId: string) => void;
  isLoading?: boolean;
}

export function AppSidebar({
  collapsed,
  onToggle,
  papers,
  activePaperId,
  onSelectPaper,
  onShowUpload,
  onDeletePaper,
  isLoading = false
}: AppSidebarProps) {
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const updateViewport = () => {
      if (typeof window === "undefined") {
        return;
      }
      setIsDesktop(window.innerWidth >= DESKTOP_BREAKPOINT);
    };

    updateViewport();
    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, []);

  const isCollapsed = isDesktop && collapsed;
  const activeId = activePaperId;
  const hasPapers = papers.length > 0;
  const { open, user, signOut, isAuthReady } = useAuthModal();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [hoveredPaperId, setHoveredPaperId] = useState<string | null>(null);

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
    // Check if user is logged in before showing upload
    if (!user) {
      open("login");
      return;
    }
    onShowUpload?.();
  };

  const containerPadding = isCollapsed ? "px-4 md:px-4" : "px-4 sm:px-6 md:px-6";

  return (
    <aside
      className={`relative flex w-full flex-col border-b border-slate-200 bg-white/95 pb-4 pt-4 shadow-sm transition-all duration-300 md:min-h-screen md:flex-shrink-0 md:border-b-0 md:border-r ${
        isCollapsed ? "md:w-20" : "md:w-64"
      } ${containerPadding}`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="absolute -right-3 top-4 hidden h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-base font-semibold text-slate-500 shadow-sm transition hover:border-slate-300 hover:text-slate-900 md:inline-flex"
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
                const isSamplePaper = MOCK_ENTRY_ID_SET.has(paper.id);

                // Build classes more explicitly to avoid Tailwind conflicts
                const baseClasses = isCollapsed
                  ? "mx-auto h-12 w-12 rounded-full border text-xs font-semibold"
                  : "w-full rounded-2xl border px-4 py-3 text-left text-sm font-semibold";

                const stateClasses = isActive
                  ? "border-slate-900 bg-slate-900 text-white shadow-md"
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

                const isHovered = hoveredPaperId === paper.id;
                const showDeleteButton = isHovered && !isCollapsed && onDeletePaper && !isSamplePaper;

                return (
                  <li key={paper.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onSelectPaper(paper.id);
                      }}
                      onMouseEnter={() => setHoveredPaperId(paper.id)}
                      onMouseLeave={() => setHoveredPaperId(null)}
                      className={`${baseClasses} ${stateClasses} relative transition-colors ${isCollapsed ? "flex items-center justify-center" : ""}`}
                      aria-pressed={isActive}
                    >
                      {isCollapsed ? (
                        <span aria-hidden="true">
                          {finalLabel.slice(0, 2).toUpperCase()}
                        </span>
                      ) : (
                        <>
                          <span className="pr-8 break-words">{finalLabel}</span>
                          {showDeleteButton && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onDeletePaper(paper.id);
                              }}
                              className={`absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-full transition-colors ${
                                isActive
                                  ? "text-white/70 hover:text-white hover:bg-white/20"
                                  : "text-slate-400 hover:text-red-600 hover:bg-red-50"
                              }`}
                              aria-label={`Delete ${finalLabel}`}
                            >
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className="h-4 w-4"
                              >
                                <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6" />
                              </svg>
                            </button>
                          )}
                        </>
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
