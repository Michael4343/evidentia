interface PdfViewerMockProps {
  frameless?: boolean;
  className?: string;
}

export function PdfViewerMock({ frameless = false, className }: PdfViewerMockProps) {
  const containerClassNames = [
    "relative w-full overflow-hidden bg-white",
    frameless ? "h-[80vh]" : "rounded-3xl border border-slate-200 shadow-sm",
    className ?? ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={containerClassNames}>
      <div className="absolute inset-y-0 left-0 w-14 bg-slate-900/95 p-3 text-xs text-slate-200">
        <div className="space-y-2">
          {Array.from({ length: 12 }).map((_, index) => (
            <div
              key={index}
              className={`h-6 rounded-md transition ${index === 1 ? "bg-primary/80" : "bg-white/10"}`}
            />
          ))}
        </div>
      </div>
      <div className="ml-14 space-y-6 bg-slate-50 p-6">
        {Array.from({ length: 3 }).map((_, index) => (
          <div
            key={index}
            className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-inner"
          >
            <div className="h-6 w-40 rounded-full bg-slate-200" />
            <div className="space-y-2">
              <div className="h-3 w-3/4 rounded-full bg-slate-200" />
              <div className="h-3 w-11/12 rounded-full bg-slate-100" />
              <div className="h-3 w-5/6 rounded-full bg-slate-100" />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="h-32 rounded-xl bg-slate-900/80" />
              <div className="space-y-2">
                <div className="h-3 w-4/5 rounded-full bg-slate-200" />
                <div className="h-3 w-3/4 rounded-full bg-slate-100" />
                <div className="h-3 w-2/3 rounded-full bg-slate-100" />
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="absolute right-6 top-6 flex items-center gap-2 rounded-full bg-white/90 px-3 py-1 text-xs font-medium text-slate-500 shadow">
        <span className="h-2 w-2 rounded-full bg-emerald-500" />
        Live collaboration on
      </div>
    </div>
  );
}
