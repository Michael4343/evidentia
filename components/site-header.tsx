"use client";

import { useState } from "react";

import { useAuthModal } from "@/components/auth-modal-provider";

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
  const { open, user, signOut, isAuthReady } = useAuthModal();
  const [isSigningOut, setIsSigningOut] = useState(false);

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
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/70">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 text-lg font-semibold text-slate-900">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-primary/90 text-sm font-bold text-primary-foreground shadow-sm">
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
        <div className="flex items-center gap-3">
          {user ? (
            <>
              <span className="hidden h-9 w-9 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white sm:inline-flex">
                {userInitial}
              </span>
              <div className="hidden text-right sm:flex sm:flex-col sm:items-end">
                <span className="text-[11px] uppercase tracking-wide text-slate-400">Signed in</span>
                <span className="max-w-[180px] truncate text-sm font-semibold text-slate-700">{user.email}</span>
              </div>
              <button
                type="button"
                onClick={handleSignOut}
                disabled={isSigningOut}
                className="rounded-full border border-slate-200 px-3 py-1 text-sm font-medium text-slate-600 transition-colors hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSigningOut ? "Signing out…" : "Sign out"}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => open("login")}
              disabled={!isAuthReady}
              className="rounded-full border border-slate-200 px-3 py-1 text-sm font-medium text-slate-600 transition-colors hover:border-primary/30 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Sign in
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
