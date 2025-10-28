"use client";

import { useEffect, useState } from "react";

const MOBILE_BREAKPOINT = 768;

function isMobileUserAgent(userAgent: string) {
  return /Mobi|Android|iP(?!.*OS X)|Phone|Tablet|Touch/i.test(userAgent);
}

export function MobileDesktopModal() {
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const evaluateViewport = () => {
      if (typeof window === "undefined") {
        return;
      }

      const hasMobileWidth = window.innerWidth > 0 && window.innerWidth < MOBILE_BREAKPOINT;
      const hasMobileAgent = typeof navigator !== "undefined" && isMobileUserAgent(navigator.userAgent);

      setIsMobileViewport(hasMobileWidth || hasMobileAgent);
    };

    evaluateViewport();
    window.addEventListener("resize", evaluateViewport);

    return () => {
      window.removeEventListener("resize", evaluateViewport);
    };
  }, []);

  if (!isMobileViewport || dismissed) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 px-6 backdrop-blur-sm">
      <div className="max-w-sm rounded-2xl bg-white p-6 text-center shadow-2xl">
        <h2 className="text-lg font-semibold text-slate-900">Evidentia works best on a computer.</h2>
        <p className="mt-3 text-sm text-slate-600">Please continue on desktop for the full experience.</p>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="mt-6 inline-flex items-center justify-center rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
        >
          Continue anyway
        </button>
      </div>
    </div>
  );
}
