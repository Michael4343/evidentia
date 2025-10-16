export function StatusBanner() {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-gradient-to-r from-primary/15 via-white to-emerald-100 px-4 py-3 text-sm text-slate-700 shadow-inner">
      <div className="flex items-center gap-2">
        <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500" />
        <span className="font-medium text-slate-800">Processing complete.</span>
        <span className="text-slate-500">Figures promoted once worker pipeline is enabled.</span>
      </div>
      <button className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-600 shadow-sm hover:text-slate-900">
        View processing log
      </button>
    </div>
  );
}
