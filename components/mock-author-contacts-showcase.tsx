"use client";

import { listMockLibrarySummaries } from "@/lib/mock-library";

interface MockAuthorContactsShowcaseProps {
  paperId?: string | null;
}

interface Profile {
  platform: string;
  url: string;
}

interface Author {
  name: string;
  email: string | null;
  role: string | null;
  orcid: string | null;
  profiles: Profile[];
}

interface Paper {
  title: string;
  identifier: string | null;
  authors: Author[];
}

interface AuthorContactsData {
  papers: Paper[];
  promptNotes?: string;
}

export function MockAuthorContactsShowcase({ paperId }: MockAuthorContactsShowcaseProps = {}) {
  const summaries = listMockLibrarySummaries();
  const summary = paperId ? summaries.find((entry) => entry.id === paperId) ?? summaries[0] : summaries[0];

  if (!summary) {
    return null;
  }

  const mock = summary.raw;
  const authorContactsRaw = (mock?.authorContacts as any)?.structured as AuthorContactsData | undefined;
  const papers = Array.isArray(authorContactsRaw?.papers) ? authorContactsRaw.papers : [];
  const promptNotes = typeof authorContactsRaw?.promptNotes === "string" ? authorContactsRaw.promptNotes : null;

  if (papers.length === 0) {
    return (
      <section className="w-full space-y-8 px-6 py-8">
        <header className="space-y-2">
          <h2 className="text-xl font-semibold text-slate-900">Author Contacts</h2>
          <p className="text-sm text-slate-600">
            No author contacts found. Run the author contacts generator script to populate this section.
          </p>
        </header>
      </section>
    );
  }

  // Calculate statistics
  const totalPapers = papers.length;
  const totalAuthors = papers.reduce((sum, paper) => sum + (paper.authors?.length || 0), 0);
  const authorsWithEmails = papers.reduce(
    (sum, paper) => sum + (paper.authors?.filter((author) => author.email).length || 0),
    0
  );

  return (
    <section className="w-full space-y-8 px-6 py-8">
      <header className="space-y-2">
        <h2 className="text-xl font-semibold text-slate-900">Author Contacts</h2>
        <p className="text-sm leading-relaxed text-slate-600">
          Contact information for the first 3 authors of each paper.
        </p>
      </header>

      {/* At a glance section */}
      {promptNotes && (
        <section className="bg-gradient-to-r from-blue-50/50 to-slate-50/50 rounded-xl p-6 border border-blue-100/50">
          <p className="text-base leading-relaxed text-slate-700">
            <span className="text-blue-700 font-semibold">At a glance:</span> {promptNotes}
          </p>
        </section>
      )}

      {/* Statistics cards */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Papers</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">{totalPapers}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Total authors</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">{totalAuthors}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">With emails</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">{authorsWithEmails}</p>
        </div>
      </div>

      {/* Paper cards */}
      <div className="space-y-6">
        {papers.map((paper, paperIndex) => {
          const paperUrl = paper.identifier
            ? paper.identifier.startsWith("http")
              ? paper.identifier
              : `https://doi.org/${paper.identifier}`
            : null;

          return (
            <article
              key={`${paper.title}-${paperIndex}`}
              className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
            >
              {/* Paper header */}
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                  Paper {paperIndex + 1}
                </p>
                {paperUrl ? (
                  <h3 className="text-lg font-semibold">
                    <a
                      href={paperUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-slate-900 hover:text-blue-600 transition"
                    >
                      {paper.title}
                    </a>
                  </h3>
                ) : (
                  <h3 className="text-lg font-semibold text-slate-900">{paper.title}</h3>
                )}
                <p className="text-xs text-slate-500">{paper.identifier || "No identifier"}</p>
              </div>

              {/* Author cards */}
              {paper.authors && paper.authors.length > 0 ? (
                <div className="mt-5 space-y-4">
                  {paper.authors.map((author, authorIndex) => (
                    <div
                      key={`${paper.title}-${author.name}-${authorIndex}`}
                      className="rounded-xl border border-slate-200 bg-slate-50/80 p-5 space-y-3"
                    >
                      {/* Author name */}
                      <div className="flex items-start justify-between">
                        <p className="text-base font-semibold text-slate-900">{author.name}</p>
                      </div>

                      {/* Contact info row */}
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        {/* Role badge */}
                        {author.role && (
                          <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                            {author.role}
                          </span>
                        )}

                        {/* Email */}
                        {author.email ? (
                          <a
                            href={`mailto:${author.email}`}
                            className="font-medium text-blue-600 hover:underline"
                          >
                            {author.email}
                          </a>
                        ) : (
                          <span className="text-slate-500">No email</span>
                        )}
                      </div>

                      {/* ORCID + Profiles */}
                      {(author.orcid || (author.profiles && author.profiles.length > 0)) && (
                        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-200">
                          {author.orcid && (
                            <a
                              href={`https://orcid.org/${author.orcid}`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
                            >
                              <span className="font-medium">ORCID:</span> {author.orcid}
                            </a>
                          )}

                          {author.profiles && author.profiles.length > 0 && (
                            <div className="flex flex-wrap items-center gap-2">
                              {author.profiles.map((profile, profileIndex) => (
                                <a
                                  key={`${author.name}-${profile.platform}-${profileIndex}`}
                                  href={profile.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700 hover:bg-blue-100 transition"
                                >
                                  {profile.platform}
                                </a>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-sm text-slate-600">No author contacts found for this paper.</p>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
