import { AnnotationSidebar } from "@/components/annotation-sidebar";
import { PdfViewerMock } from "@/components/pdf-viewer-mock";
import { samplePaper } from "@/lib/mock-data";

const readerTips = [
  "Use the page navigator to jump between sections once processing completes.",
  "Highlights and comments sync in realtime across collaborators.",
  "Verification requests notify experts when the queue is enabled."
];

export default function PaperPage() {
  const paper = samplePaper;

  return (
    <div className="space-y-8">
      <section className="rounded-3xl border border-slate-200 bg-white/95 p-5 shadow-sm">
        <header className="mb-4 flex flex-wrap items-center justify-between gap-4 text-sm text-slate-500">
          <span className="inline-flex items-center gap-2 text-slate-600">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            Ready to explore
          </span>
          <span className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-500">
            PDF viewer prototype
          </span>
        </header>
        <PdfViewerMock />
        <p className="mt-4 text-xs text-slate-500">
          Figures render within the viewer. Hotspots and thumbnails arrive once the worker pipeline ships.
        </p>
      </section>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section className="rounded-3xl border border-slate-200 bg-white/90 p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-900">Reader basics</h3>
          <ul className="mt-3 space-y-2 text-sm text-slate-600">
            {readerTips.map((tip) => (
              <li key={tip} className="flex gap-2">
                <span className="mt-1 h-1.5 w-1.5 rounded-full bg-primary/70" />
                <span>{tip}</span>
              </li>
            ))}
          </ul>
        </section>
        <AnnotationSidebar comments={paper.comments} />
      </div>
    </div>
  );
}
