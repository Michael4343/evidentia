"use client";

import { listMockLibrarySummaries } from "@/lib/mock-library";
import { resolvePaperHref, resolveDoiMetadata } from "@/lib/paper-links";

interface MockSimilarPapersShowcaseProps {
  paperId?: string | null;
}

export function MockSimilarPapersShowcase({ paperId }: MockSimilarPapersShowcaseProps = {}) {
  const summaries = listMockLibrarySummaries();
  const summary = paperId ? summaries.find((entry) => entry.id === paperId) ?? summaries[0] : summaries[0];
  if (!summary) {
    return null;
  }

  const mock = summary.raw;
  const similarPapers = Array.isArray(mock?.similarPapers) ? mock.similarPapers : [];

  const methodRows = [
    { label: "Sample / model", key: "sampleModel" },
    { label: "Materials", key: "materialsSetup" },
    { label: "Equipment", key: "equipmentSetup" },
    { label: "Procedure", key: "procedureSteps" },
    { label: "Controls", key: "controls" },
    { label: "Outputs / metrics", key: "outputsMetrics" },
    { label: "Quality checks", key: "qualityChecks" },
    { label: "Outcome summary", key: "outcomeSummary" }
  ] as const;

  type MethodKey = (typeof methodRows)[number]["key"];

  type SimilarPaperRecord = (typeof similarPapers)[number] & {
    methodMatrix?: Record<MethodKey, string | null | undefined>;
  };

  type ComparisonPaper = {
    identifier: string | null;
    title: string;
    doi?: string | null;
    url?: string | null;
    authors?: readonly string[] | string[];
    year?: number | null;
    venue?: string;
    clusterLabel?: string;
    whyRelevant?: string;
    overlapHighlights?: readonly string[] | string[];
    methodMatrix: Record<MethodKey, string>;
    gapsOrUncertainties?: string;
  };

  const deriveSourceMeta = () => {
    const path = mock?.sourcePdf?.path;
    if (!path) {
      return { authors: [] as string[], year: null as number | null, derivedTitle: null as string | null };
    }
    const base = path.replace(/\.pdf$/i, "");
    const match = base.match(/^(.*?)(?:\s*\((\d{4})\))?$/);
    let derivedTitle: string | null = base;
    let authors: string[] = [];
    let year: number | null = null;
    if (match) {
      const authorPart = match[1]?.trim();
      derivedTitle = authorPart && match[2] ? authorPart : base;
      if (match[2]) {
        year = Number.parseInt(match[2], 10);
      }
      if (authorPart) {
        authors = authorPart
          .split(/[,&]/)
          .map((segment) => segment.trim())
          .filter(Boolean);
      }
    }
    return { authors, year, derivedTitle };
  };

  const normalizeMatrix = (paper: SimilarPaperRecord | undefined): Record<MethodKey, string> => {
    return methodRows.reduce<Record<MethodKey, string>>((acc, row) => {
      const value = paper?.methodMatrix?.[row.key];
      acc[row.key] = typeof value === "string" && value.trim().length > 0 ? value : "";
      return acc;
    }, {} as Record<MethodKey, string>);
  };

  const sourcePdf = mock?.sourcePdf;
  const sourceNotes = mock?.sourcePaper;
  const { authors: derivedAuthors, year: derivedYear, derivedTitle } = deriveSourceMeta();

  const sourceSummary = typeof sourceNotes?.summary === "string" ? sourceNotes.summary : "Primary manuscript used for this comparison.";
  const methodHighlights = Array.isArray(sourceNotes?.keyMethodSignals) ? sourceNotes.keyMethodSignals : [];

  const sourceMethodMatrix: Partial<Record<MethodKey, string>> = {
    sampleModel:
      methodHighlights[0] ??
      "Review aggregates field-to-pore studies on agroecosystem soil structure and microbiome interactions.",
    materialsSetup:
      methodHighlights[1] ??
      "Summarises assays ranging from stable-isotope tracers to metagenomics, enzyme panels, and flux chambers.",
    equipmentSetup:
      methodHighlights[2] ??
      "Highlights instrumentation such as synchrotron μCT, IRMS, and high-throughput sequencing across cited work.",
    procedureSteps:
      methodHighlights[3] ??
      "Distils workflows for aggregate fractionation, pore imaging, isotopic tracing, and functional profiling.",
    controls:
      methodHighlights[4] ??
      "Notes comparative controls across management regimes, pore classes, and replicated field platforms.",
    outputsMetrics:
      "Emphasises gas fluxes, carbon turnover, microbiome composition, and structure-function correlations.",
    qualityChecks:
      "Synthesises QA considerations across the cited literature, from imaging segmentation to isotope balances.",
    outcomeSummary: sourceSummary
  };

  const sourcePaperEntry = sourcePdf
    ? {
        identifier: sourcePdf.doi ? `https://doi.org/${sourcePdf.doi}` : sourcePdf.path ?? null,
        title: sourcePdf.title ?? sourceNotes?.title ?? derivedTitle ?? "Source paper",
        doi: sourcePdf.doi ?? null,
        url: sourcePdf.doi ? `https://doi.org/${sourcePdf.doi}` : null,
        authors:
          Array.isArray((sourceNotes as any)?.authors) && (sourceNotes as any)?.authors.length > 0
            ? (sourceNotes as any).authors
            : derivedAuthors,
        year: (sourceNotes as any)?.year ?? derivedYear,
        venue: (sourceNotes as any)?.venue ?? "Review",
        clusterLabel: undefined,
        whyRelevant:
          typeof sourceNotes?.summary === "string" && sourceNotes.summary.length > 0
            ? sourceNotes.summary
            : "Primary manuscript used for this comparison.",
        overlapHighlights: Array.isArray(sourceNotes?.keyMethodSignals)
          ? sourceNotes.keyMethodSignals
          : [],
        methodMatrix: normalizeMatrix({ methodMatrix: sourceMethodMatrix } as SimilarPaperRecord),
        gapsOrUncertainties: undefined
      }
    : null;

  const comparisonPapers: ComparisonPaper[] = [
    ...(sourcePaperEntry
      ? [{
          ...sourcePaperEntry,
          methodMatrix: normalizeMatrix(sourcePaperEntry as SimilarPaperRecord)
        }]
      : []),
    ...similarPapers.map((paper) => ({
      ...paper,
      methodMatrix: normalizeMatrix(paper)
    }))
  ];

  const primarySourceHref = sourcePaperEntry
    ? resolvePaperHref({
        url: sourcePaperEntry.url,
        doi: sourcePaperEntry.doi,
        identifier: sourcePaperEntry.identifier
      })
    : null;

  const hasRecommendations = comparisonPapers.length > 0;

  const getMatrixValue = (paper: ComparisonPaper, key: MethodKey) => {
    const value = paper?.methodMatrix?.[key];
    if (!value || !value.trim()) {
      return "Not reported";
    }
    return value;
  };

  return (
    <section className="w-full space-y-8 px-6 py-8">
      <header className="space-y-2">
        <h2 className="text-xl font-semibold text-slate-900">
          {primarySourceHref ? (
            <a href={primarySourceHref} target="_blank" rel="noreferrer" className="hover:underline">
              {mock.sourcePaper?.title ?? "Untitled"}
            </a>
          ) : (
            mock.sourcePaper?.title ?? "Untitled"
          )}
        </h2>
        {mock.sourcePaper?.summary && (
          <p className="text-sm leading-relaxed text-slate-600">{mock.sourcePaper.summary}</p>
        )}
      </header>

      {!hasRecommendations ? (
        <p className="text-sm text-slate-600">Paste the agent JSON when you re-run the script to populate the crosswalk matrix.</p>
      ) : (
        <div className="space-y-8">
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="sticky left-0 z-10 bg-slate-50 px-4 py-3 text-slate-500">Method dimension</th>
                  {comparisonPapers.map((paper, index) => {
                    const paperUrl = resolvePaperHref({
                      url: paper.url,
                      doi: paper.doi,
                      identifier: paper.identifier
                    });
                    return (
                      <th key={paper.identifier ?? index} className="px-4 py-3 text-slate-600">
                        <div className="space-y-0.5">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                            Paper #{index + 1}
                          </p>
                          {paperUrl ? (
                            <a
                              href={paperUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-sm font-semibold text-blue-600 leading-snug hover:underline transition block"
                            >
                              {paper.title ?? "Untitled"}
                            </a>
                          ) : (
                            <p className="text-sm font-semibold text-slate-900 leading-snug">
                              {paper.title ?? "Untitled"}
                            </p>
                          )}
                          <p className="text-xs text-slate-500">
                            {[paper.year, paper.venue].filter(Boolean).join(" · ") || "Metadata pending"}
                          </p>
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {methodRows.map((row) => (
                  <tr key={row.key} className="border-t border-slate-100 align-top">
                    <th className="sticky left-0 z-10 bg-white px-4 py-4 text-left text-sm font-medium text-slate-700">
                      {row.label}
                    </th>
                    {comparisonPapers.map((paper, index) => (
                      <td key={`${paper.identifier ?? index}-${row.key}`} className="px-4 py-4 text-sm leading-relaxed text-slate-700">
                        {getMatrixValue(paper, row.key)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="px-4 pb-4 text-xs text-slate-500">“Not reported” highlights gaps to close before replication or scale-up.</p>
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">Recommended papers</h3>
            <ol className="space-y-6">
              {comparisonPapers.map((paper, index) => {
                const paperUrl = resolvePaperHref({
                  url: paper.url,
                  doi: paper.doi,
                  identifier: paper.identifier
                });
                const doiMeta = resolveDoiMetadata(paper.doi);
                return (
                  <li
                    key={paper.identifier ?? paper.title ?? index}
                    className="rounded-lg border border-slate-200 bg-white px-4 py-4 shadow-sm"
                  >
                    <div className="space-y-1.5">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Paper #{index + 1}</p>
                      {paperUrl ? (
                        <h4 className="text-base font-semibold">
                          <a
                            href={paperUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-slate-900 hover:text-blue-600 transition"
                          >
                            {paper.title ?? "Untitled"}
                          </a>
                        </h4>
                      ) : (
                        <h4 className="text-base font-semibold text-slate-900">{paper.title ?? "Untitled"}</h4>
                      )}
                      <p className="text-sm text-slate-600">
                        {[paper.authors?.join(", ") ?? "Unknown authors", paper.year, paper.venue]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>

                  {paper.whyRelevant && (
                    <p className="mt-3 text-sm leading-relaxed text-slate-700">{paper.whyRelevant}</p>
                  )}

                  {paper.overlapHighlights?.length ? (
                    <div className="mt-3 space-y-1.5">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Overlap highlights</p>
                      <ul className="space-y-1.5 pl-4 text-sm leading-relaxed text-slate-700">
                        {paper.overlapHighlights.map((highlight, highlightIndex) => (
                          <li key={`${paper.identifier ?? paper.title ?? index}-overlap-${highlightIndex}`} className="list-disc marker:text-slate-400">
                            {highlight}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {paper.gapsOrUncertainties && (
                    <div className="mt-4 rounded border-l-2 border-amber-300 bg-amber-50/60 px-4 py-3 text-sm leading-relaxed text-amber-800">
                      <span className="font-semibold">Follow-up gaps: </span>
                      {paper.gapsOrUncertainties}
                    </div>
                  )}

                  {(paperUrl || doiMeta) && (
                    <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-slate-600">
                      {paperUrl && (
                        <a
                          href={paperUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center rounded-full border border-primary px-3 py-1 font-semibold text-primary transition hover:bg-primary/5"
                        >
                          Open publication
                        </a>
                      )}
                      {doiMeta && (
                        <a
                          href={doiMeta.href}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sm text-slate-500 underline-offset-4 hover:underline"
                        >
                          DOI: {doiMeta.doi}
                        </a>
                      )}
                    </div>
                  )}
                </li>
                );
              })}
            </ol>
          </div>
        </div>
      )}
    </section>
  );
}
