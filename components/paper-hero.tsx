import { PaperDetail } from "@/lib/mock-data";

interface PaperHeroProps {
  paper: PaperDetail;
}

export function PaperHero({ paper }: PaperHeroProps) {
  const { title, authors, venue, year, abstract, status } = paper;

  return (
    <section className="space-y-6 rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
            {venue} · {year}
          </p>
          <h1 className="text-3xl font-semibold text-slate-900 sm:text-4xl">{title}</h1>
          <p className="text-sm text-slate-500">{authors.join(", ")}</p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-600">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          {status}
        </span>
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
              Abstract (public)
            </p>
            <p className="mt-3 text-sm leading-relaxed text-slate-700">{abstract}</p>
          </div>
        </div>
        <aside className="flex flex-col gap-3 rounded-2xl border border-slate-100 bg-slate-50/80 p-5 text-sm text-slate-600">
          <h2 className="text-sm font-semibold text-slate-900">Reader checklist</h2>
          <ul className="space-y-2 text-sm">
            <li>Highlight or comment on any passage once signed in.</li>
            <li>Request expert verification for important claims.</li>
            <li>Figures render directly within the PDF viewer.</li>
          </ul>
          <button className="mt-auto rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:scale-[1.01]">
            Continue with Google
          </button>
        </aside>
      </div>
    </section>
  );
}
