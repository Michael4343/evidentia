"use client";

import { useEffect, useState } from "react";

import { getTutorialEmbedUrl } from "@/lib/tutorial-url";

const DESKTOP_BREAKPOINT = 768;
const DISMISS_KEY = "evidentia_tutorial_modal_dismissed";
const tutorialUrl = process.env.NEXT_PUBLIC_TUTORIAL_URL ?? "";
const embedUrl = getTutorialEmbedUrl(tutorialUrl);

function isMobileUserAgent(userAgent: string) {
  return /Mobi|Android|iP(?!.*OS X)|Phone|Tablet|Touch/i.test(userAgent);
}

export function TutorialModal() {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (!tutorialUrl.trim()) {
      return;
    }

    const evaluate = () => {
      if (typeof window === "undefined") {
        return;
      }

      const isDesktopViewport = window.innerWidth >= DESKTOP_BREAKPOINT;
      const mobileAgent = typeof navigator !== "undefined" && isMobileUserAgent(navigator.userAgent);
      let dismissed = false;
      try {
        dismissed = window.sessionStorage?.getItem(DISMISS_KEY) === "true";
      } catch (error) {
        console.warn("Unable to read tutorial modal dismissal", error);
      }

      setIsVisible(isDesktopViewport && !mobileAgent && !dismissed);
    };

    evaluate();
    window.addEventListener("resize", evaluate);

    return () => {
      window.removeEventListener("resize", evaluate);
    };
  }, []);

  if (!tutorialUrl.trim() || !isVisible) {
    return null;
  }

  const handleDismiss = () => {
    setIsVisible(false);
    if (typeof window !== "undefined") {
      try {
        window.sessionStorage?.setItem(DISMISS_KEY, "true");
      } catch (error) {
        console.warn("Unable to persist tutorial modal dismissal", error);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-950/70 px-4 backdrop-blur-sm sm:px-6">
      <div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl">
        <div className="space-y-4 text-center">
          <h2 className="text-xl font-semibold text-slate-900">Watch the quick tutorial</h2>
          <p className="text-sm text-slate-600">Learn the workflow in a couple of minutes before you dive in.</p>
          {embedUrl ? (
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
              className="inline-flex h-10 items-center justify-center rounded-full bg-slate-900 px-6 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
            >
              Watch tutorial
            </a>
          )}
          <button
            type="button"
            onClick={handleDismiss}
            className="inline-flex h-10 items-center justify-center rounded-full border border-slate-200 px-6 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
          >
            Skip for now
          </button>
        </div>
      </div>
    </div>
  );
}
