"use client";

import { useState } from "react";

import { useAuthModal } from "@/components/auth-modal-provider";

interface AppSidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function AppSidebar({ collapsed, onToggle }: AppSidebarProps) {
  const { open, user, signOut, isAuthReady } = useAuthModal();
  const [isSigningOut, setIsSigningOut] = useState(false);

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
      className={`relative flex min-h-screen flex-col border-r border-slate-200 bg-white/95 pb-8 pt-8 shadow-sm transition-all duration-300 ${
        collapsed ? "w-20 px-4" : "w-64 px-6"
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="absolute -right-3 top-8 inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-base font-semibold text-slate-500 shadow-sm transition hover:border-slate-300 hover:text-slate-900"
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        <span aria-hidden="true">{collapsed ? "›" : "‹"}</span>
      </button>
      <div className={`flex items-center ${collapsed ? "justify-center" : "gap-3"} text-slate-900`}>
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/90 text-sm font-semibold text-primary-foreground shadow-sm">
          Ev
        </span>
        {!collapsed && (
          <div>
            <p className="text-base font-semibold">Evidentia</p>
          </div>
        )}
      </div>
      <button
        type="button"
        className={`mt-8 flex items-center justify-center rounded-full border border-slate-200 text-sm font-semibold text-slate-600 transition hover:border-primary/40 hover:text-slate-900 ${
          collapsed ? "h-10 w-10" : "h-10 w-full px-4"
        }`}
        aria-label={user ? "Sign out" : "Sign in"}
        onClick={() => {
          if (user) {
            void handleSignOut();
            return;
          }
          open("login");
        }}
        disabled={user ? isSigningOut : !isAuthReady}
      >
        <span className={collapsed ? "sr-only" : ""}>{user ? (isSigningOut ? "Signing out…" : "Sign out") : "Sign in"}</span>
        {collapsed && (
          <span aria-hidden="true" className="text-base">
            👤
          </span>
        )}
      </button>
      <div className="mt-auto" />
    </aside>
  );
}
