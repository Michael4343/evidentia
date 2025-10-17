"use client";

import { PdfViewerMock } from "@/components/pdf-viewer-mock";

export function PaperReaderContent() {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <PdfViewerMock />
    </div>
  );
}
