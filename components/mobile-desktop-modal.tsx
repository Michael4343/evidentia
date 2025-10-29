"use client";

import { useEffect, useState } from "react";

import { getTutorialEmbedUrl } from "@/lib/tutorial-url";

const MOBILE_BREAKPOINT = 768;
const MOBILE_DISMISS_KEY = "evidentia_mobile_modal_dismissed";
const tutorialUrl = process.env.NEXT_PUBLIC_TUTORIAL_URL ?? "";
const embedUrl = getTutorialEmbedUrl(tutorialUrl);

function isMobileUserAgent(userAgent: string) {
  return /Mobi|Android|iP(?!.*OS X)|Phone|Tablet|Touch/i.test(userAgent);
}

export function MobileDesktopModal() {
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      try {
        if (window.sessionStorage?.getItem(MOBILE_DISMISS_KEY) === "true") {
          setDismissed(true);
        }
      } catch (error) {
        console.warn("Unable to read mobile modal dismissal", error);
      }
    }

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

  const handleDismiss = () => {
    setDismissed(true);
    if (typeof window !== "undefined") {
      try {
        window.sessionStorage?.setItem(MOBILE_DISMISS_KEY, "true");
      } catch (error) {
        console.warn("Unable to persist mobile modal dismissal", error);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 px-4 backdrop-blur-sm sm:px-6">
      <div className="w-full max-w-xs rounded-2xl bg-white p-5 text-center shadow-2xl sm:max-w-sm sm:p-6">
        <h2 className="text-lg font-semibold text-slate-900">Evidentia works best on a computer.</h2>
        <p className="mt-3 text-sm text-slate-600">Please continue on desktop for the full experience.</p>
        <div className="mt-6 flex flex-col items-stretch gap-3">
          {tutorialUrl.trim() && (
            embedUrl ? (
              <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black shadow">
                <iframe
                  src={embedUrl}
                  title="Evidentia tutorial video"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                  loading="lazy"
                  referrerPolicy="strict-origin-when-cross-origin"
                  className="absolute inset-0 h-full w-full"
                />
              </div>
            ) : (
              <a
                href={tutorialUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex w-full items-center justify-center rounded-full border border-slate-200 px-5 py-2 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
              >
                Watch tutorial
              </a>
            )
          )}
          <button
            type="button"
            onClick={handleDismiss}
            className="inline-flex w-full items-center justify-center rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
          >
            Continue anyway
          </button>
        </div>
      </div>
    </div>
  );
}
