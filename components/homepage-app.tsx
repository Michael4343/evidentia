"use client";

import { PdfViewerMock } from "@/components/pdf-viewer-mock";

export function HomepageApp() {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="overflow-hidden rounded-2xl border border-slate-200">
        <PdfViewerMock />
      </div>
    </section>
  );
}
