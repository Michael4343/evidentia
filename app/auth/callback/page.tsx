"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

export default function AuthCallbackPage() {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const router = useRouter();
  const [status, setStatus] = useState<"working" | "error">("working");
  const [message, setMessage] = useState("Completing sign-in. This will only take a moment.");

  useEffect(() => {
    const finalizeAuth = async () => {
      if (!supabase) {
        setStatus("error");
        setMessage("Supabase configuration is missing. Please try again later.");
        return;
      }

      const params = new URLSearchParams(window.location.search);
      const rawError = params.get("error");
      const rawDescription = params.get("error_description");
      const redirectTo = params.get("next");

      const decode = (value: string) => {
        try {
          return decodeURIComponent(value);
        } catch {
          return value;
        }
      };

      if (rawError) {
        const decoded = rawDescription ? decode(rawDescription) : rawError;
        console.error("[auth-callback] OAuth error:", decoded);
        setStatus("error");
        setMessage("We couldn't complete the sign-in. Please try again.");
        return;
      }

      const { error } = await supabase.auth.getSessionFromUrl({ storeSession: true });

      if (error) {
        console.error("[auth-callback] Session exchange failed:", error);
        setStatus("error");
        setMessage(error.message || "We couldn't complete the sign-in. Please try again.");
        return;
      }

      setMessage("Signed in successfully. Redirecting you back now…");
      const target = redirectTo && redirectTo.startsWith("/") ? redirectTo : "/";
      await router.replace(target);
    };

    void finalizeAuth();
  }, [router, supabase]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-100 px-4 py-16">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-lg">
        <h1 className="text-xl font-semibold text-slate-900">Completing sign-in…</h1>
        <p className="mt-4 text-sm text-slate-600">{message}</p>
        {status === "error" && (
          <button
            type="button"
            className="mt-6 inline-flex items-center justify-center rounded-full border border-slate-300 px-5 py-2 text-sm font-semibold text-slate-600 transition hover:border-slate-400 hover:text-slate-900"
            onClick={() => {
              void router.replace("/");
            }}
          >
            Return to homepage
          </button>
        )}
      </div>
    </div>
  );
}
