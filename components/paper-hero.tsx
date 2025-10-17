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
      <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
          Abstract (public)
        </p>
        <p className="mt-3 text-sm leading-relaxed text-slate-700">{abstract}</p>
      </div>
    </section>
  );
}
