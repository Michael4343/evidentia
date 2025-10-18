"use client";

import { MOCK_SIMILAR_PAPERS_LIBRARY } from "@/lib/mock-similar-papers";

export function MockSimilarPapersShowcase() {
  const mock = MOCK_SIMILAR_PAPERS_LIBRARY;
  const similarPapers = Array.isArray(mock?.similarPapers) ? mock.similarPapers : [];
  const hasRecommendations = similarPapers.length > 0;

  if (!mock) {
    return null;
  }

  const methodRows: Array<{ label: string; key: keyof (typeof similarPapers)[number]["methodMatrix"] }> = [
    { label: "Sample / model", key: "sampleModel" },
    { label: "Materials", key: "materialsSetup" },
    { label: "Equipment", key: "equipmentSetup" },
    { label: "Procedure", key: "procedureSteps" },
    { label: "Controls", key: "controls" },
    { label: "Outputs / metrics", key: "outputsMetrics" },
    { label: "Quality checks", key: "qualityChecks" },
    { label: "Outcome summary", key: "outcomeSummary" }
  ];

  const getMatrixValue = (paper: (typeof similarPapers)[number], key: typeof methodRows[number]["key"]) => {
    const value = paper?.methodMatrix?.[key];
    if (!value || !value.trim()) {
      return "Not reported";
    }
    return value;
  };

  return (
    <section className="w-full space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">{mock.sourcePaper?.title ?? "Untitled"}</h2>
        {mock.sourcePaper?.summary && (
          <p className="mt-1 text-sm text-slate-600 leading-relaxed">{mock.sourcePaper.summary}</p>
        )}
      </div>

      {hasRecommendations ? (
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse">
            <thead>
              <tr className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="sticky left-0 z-10 bg-slate-50 px-4 py-3 text-slate-600">Method dimension</th>
                {similarPapers.map((paper, index) => (
                  <th key={paper.identifier ?? index} className="px-4 py-3 text-slate-600">
                      <div className="flex flex-col gap-1">
                        <span className="text-[11px] font-semibold text-slate-400">Track #{index + 1}</span>
                        <span className="text-sm font-semibold text-slate-800 leading-snug">
                          {paper.title ?? "Untitled"}
                        </span>
                        <span className="text-xs text-slate-500">
                          {paper.year ? paper.year : "Year unknown"}
                        </span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {methodRows.map((row) => (
                  <tr key={row.key} className="border-t border-slate-100 align-top text-sm">
                    <th className="sticky left-0 z-10 bg-white px-4 py-4 text-left text-sm font-medium text-slate-700">
                      {row.label}
                    </th>
                    {similarPapers.map((paper, index) => (
                      <td key={`${paper.identifier ?? index}-${row.key}`} className="px-4 py-4 text-sm text-slate-700">
                        {getMatrixValue(paper, row.key)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
          </table>
          <p className="mt-3 text-xs text-slate-500">“Not reported” highlights gaps teams may need to fill before replication or scale-up.</p>
        </div>
      ) : (
        <div className="border border-dashed border-slate-200 bg-slate-50/60 p-6 text-sm text-slate-600">
          Paste the agent JSON when you re-run the script to populate the crosswalk matrix.
        </div>
      )}

      {hasRecommendations && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-800">Recommended Papers</h3>
          <ol className="space-y-3">
            {similarPapers.map((paper, index) => (
              <li key={paper.identifier ?? paper.title ?? index} className="border-t border-slate-200 pt-3 first:border-t-0">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-1">
                    <p className="text-base font-semibold text-slate-900">
                      <span className="mr-2 text-xs text-slate-400">#{index + 1}</span>
                      {paper.title ?? "Untitled"}
                    </p>
                    <div className="text-xs text-slate-500">
                      {paper.authors?.length ? paper.authors.join(", ") : "Unknown authors"}
                      {paper.year ? ` · ${paper.year}` : ""}
                      {paper.venue ? ` · ${paper.venue}` : ""}
                      {paper.clusterLabel ? ` · ${paper.clusterLabel}` : ""}
                    </div>
                  </div>
                  <div className="flex flex-shrink-0 flex-col items-end gap-1 text-right text-xs">
                    {paper.doi && (
                      <a
                        href={`https://doi.org/${paper.doi}`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium text-primary hover:underline"
                      >
                        DOI link
                      </a>
                    )}
                  </div>
                </div>
                {paper.whyRelevant && (
                  <p className="mt-2 text-sm leading-relaxed text-slate-700">{paper.whyRelevant}</p>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
