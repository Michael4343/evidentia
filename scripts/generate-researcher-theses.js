#!/usr/bin/env node

/**
 * Interactive helper for assembling researcher thesis intelligence prompts.
 *
 * Usage:
 *   node scripts/generate-researcher-theses.js
 */

const fs = require("fs");
const path = require("path");
const { cleanUrlStrict } = require("../lib/clean-url-strict.js");
const {
  readLibrary,
  writeLibrary,
  upsertEntry,
  getEntry,
  promptForEntrySelection,
  MAX_ENTRIES
} = require("./mock-library-utils");
const {
  createInterface,
  closeInterface,
  ask,
  copyPromptToClipboard,
  collectJsonInput
} = require("./mock-cli-utils");

const MAX_GROUPS_PER_PAPER = 6;
const MAX_CONTACTS_PER_GROUP = 4;

let CURRENT_LIBRARY = null;
let CURRENT_ENTRY_ID = null;

function writeMockLibrary(entryData) {
  if (!CURRENT_LIBRARY || !CURRENT_ENTRY_ID) {
    throw new Error("Mock library context not initialised. Select an entry before writing.");
  }

  const previousIds = CURRENT_LIBRARY.entries.map((item) => item.id);
  const payload = {
    ...(entryData ?? {}),
    id: CURRENT_ENTRY_ID
  };

  upsertEntry(CURRENT_LIBRARY, payload);
  writeLibrary(path.basename(__filename), CURRENT_LIBRARY);

  return previousIds.filter((id) => !CURRENT_LIBRARY.entries.some((item) => item.id === id));
}

const CLEANUP_PROMPT_HEADER = `You are a cleanup agent. Convert the analyst's notes into strict JSON for Evidentia's researcher thesis UI.

Output requirements:
- Return a single JSON object with keys: researchers (array), promptNotes (optional string).
- Each researcher object must include: name (string), email (string|null), group (string|null),
  latest_publication (object with title (string|null), year (number|null), venue (string|null), url (string|null)),
  phd_thesis (null or object with title (string|null), year (number|null), institution (string|null), url (string|null)),
  data_publicly_available ("yes" | "no" | "unknown").
- Use null for unknown scalars. Use lowercase for data_publicly_available values.
- Every url field must be a direct https:// link. If the notes provide a markdown link or reference-style footnote, extract the underlying URL and place it in the url field. Never leave a url blank when the notes include a working link.
- For phd_thesis.url, copy the repository/download link from the analyst notes' "Data access link" column; if multiple are provided, prefer the PDF/download URL. Only set null when no link is given or it is explicitly unavailable.
- No markdown, commentary, or trailing prose. Valid JSON only (double quotes).
- Preserve factual content from the notes; do not invent new theses or publications.
Before responding, you must paste the analyst notes after these instructions so you can structure them. Use them verbatim; do not add new facts.`;

const CURLY_QUOTES_TO_ASCII = [
  [/\u2018|\u2019|\u201A|\u201B/g, "'"],
  [/\u201C|\u201D|\u201E|\u201F/g, '"'],
  [/\u2013|\u2014|\u2015|\u2212/g, "-"],
  [/\u2026/g, "..."],
  [/\u00A0/g, " "],
  [/\u200B|\u200C|\u200D|\uFEFF/g, ""],
  [/\u0000|\u0001|\u0002|\u0003|\u0004|\u0005|\u0006|\u0007|\u0008|\u0009|\u000A|\u000B|\u000C|\u000D/g, " "]
];

function cleanPlainText(input) {
  if (typeof input !== "string") {
    return input;
  }

  let value = input.replace(/\r\n/g, "\n").trim();
  for (const [pattern, replacement] of CURLY_QUOTES_TO_ASCII) {
    value = value.replace(pattern, replacement);
  }

  value = value.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, (match, label, url) => `${label} (${url})`);
  value = value.replace(/\[(\d+|[a-zA-Z]+)\]/g, " $1");

  value = value
    .split("\n")
    .map((line) => line.trim())
    .filter((line, index, lines) => line.length > 0 || (index > 0 && lines[index - 1].length > 0))
    .join("\n");

  return value.trim();
}


async function collectCleanedJson(rl) {
  return collectJsonInput(rl, { promptLabel: "cleaned JSON" });
}

function normaliseDoi(input) {
  if (typeof input !== "string") {
    return "";
  }
  const match = input.match(/10\.\d{4,9}\/[^\s)"'>]+/i);
  if (!match) {
    return "";
  }
  return match[0].replace(/[.,;]+$/, "").toLowerCase();
}

function buildPaperMetaLookup(library) {
  const byDoi = new Map();
  const byTitle = new Map();

  const register = (meta) => {
    if (!meta) {
      return;
    }
    if (meta.doi) {
      byDoi.set(meta.doi.toLowerCase(), meta);
    }
    if (meta.titleKey) {
      byTitle.set(meta.titleKey, meta);
    }
  };

  const cleanTitleKey = (value) => {
    const cleaned = cleanPlainText(value || "");
    return cleaned ? cleaned.toLowerCase() : "";
  };

  const sourcePaper = library?.sourcePaper || library?.agent?.sourcePaper;
  if (sourcePaper) {
    const sourceMeta = {
      title: cleanPlainText(sourcePaper.title || ""),
      doi: normaliseDoi(sourcePaper.doi || ""),
      year: typeof sourcePaper.year === "number" ? sourcePaper.year : null,
      authors: Array.isArray(sourcePaper.authors)
        ? sourcePaper.authors.map((author) => cleanPlainText(author)).filter(Boolean)
        : [],
      titleKey: cleanTitleKey(sourcePaper.title || "")
    };
    register(sourceMeta);
  }

  if (Array.isArray(library?.similarPapers)) {
    library.similarPapers.forEach((paper) => {
      const meta = {
        title: cleanPlainText(paper?.title || ""),
        doi: normaliseDoi(paper?.doi || paper?.identifier || ""),
        year: typeof paper?.year === "number" ? paper.year : null,
        authors: Array.isArray(paper?.authors)
          ? paper.authors.map((author) => cleanPlainText(author)).filter(Boolean)
          : [],
        titleKey: cleanTitleKey(paper?.title || "")
      };
      register(meta);
    });
  }

  return {
    resolve(title, identifier) {
      const doi = normaliseDoi(identifier || "");
      if (doi && byDoi.has(doi)) {
        return byDoi.get(doi);
      }
      const titleKey = cleanTitleKey(title || "");
      if (titleKey && byTitle.has(titleKey)) {
        return byTitle.get(titleKey);
      }
      return null;
    }
  };
}

function collectPaperTargets(library) {
  const papers = library?.researchGroups?.structured?.papers;
  if (!Array.isArray(papers) || papers.length === 0) {
    return [];
  }

  const metaLookup = buildPaperMetaLookup(library);

  return papers
    .map((paper) => {
      const title = cleanPlainText(paper?.title || "");
      if (!title) {
        return null;
      }

      const identifier = cleanPlainText(paper?.identifier || "");
      const meta = metaLookup.resolve(title, identifier) || {};

      const groups = Array.isArray(paper?.groups)
        ? paper.groups
            .map((group) => {
              const name = cleanPlainText(group?.name || "");
              if (!name) {
                return null;
              }

              const institution = cleanPlainText(group?.institution || "");
              const website = cleanUrlStrict(group?.website || "");
              const notes = cleanPlainText(group?.notes || "");

              const researchers = Array.isArray(group?.researchers)
                ? group.researchers
                    .map((person) => {
                      const personName = cleanPlainText(person?.name || "");
                      if (!personName) {
                        return null;
                      }
                      const role = cleanPlainText(person?.role || "");
                      const email = cleanPlainText(person?.email || "");
                      return {
                        name: personName,
                        role: role || null,
                        email: email || null
                      };
                    })
                    .filter(Boolean)
                    .slice(0, MAX_CONTACTS_PER_GROUP)
                : [];

              return {
                name,
                institution: institution || null,
                website: website || null,
                notes: notes || null,
                researchers
              };
            })
            .filter(Boolean)
            .slice(0, MAX_GROUPS_PER_PAPER)
        : [];

      if (!groups.length) {
        return null;
      }

      return {
        title,
        identifier: identifier || null,
        doi: meta.doi || normaliseDoi(identifier || "") || null,
        year: typeof meta.year === "number" ? meta.year : null,
        authors: Array.isArray(meta.authors) ? meta.authors : [],
        groups
      };
    })
    .filter(Boolean);
}

function buildThesisDiscoveryPrompt(library) {
  const paperTargets = collectPaperTargets(library);

  if (!paperTargets.length) {
    throw new Error(
      "No research groups with researchers found. Run the research groups helper to capture structured group data first."
    );
  }

  const lines = [
    "You are a careful research assistant.",
    "",
    "Compile PhD Theses from Research Groups of Paper Authors",
    "",
    "Goal: For each paper below, surface PhD theses that validate the research groups' expertise and connect directly to the paper's author teams.",
    "Work sequentially: paper → authors → research groups → thesis evidence.",
    "",
    "Methodology:",
    "1. Map every author and their active research group(s) at the time of publication. Use the listed groups as starting points and expand to co-affiliations when needed.",
    "2. For each group, search for PhD theses published within ±5 years of the paper's publication year. Prioritise official repositories (institutional libraries, national theses portals, ProQuest, HAL, ETH Research Collection, etc.).",
    "3. Rank theses by closeness to authors: lead author groups first, then co-author groups following author order. If the thesis author is also on the paper, mark that explicitly.",
    "4. Record whether the thesis or underlying datasets are publicly accessible. Capture the exact URL to the repository or PDF when it exists; otherwise note the access route (embargo, request required, etc.).",
    "5. Keep notes concise, cite concrete URLs, and flag gaps where information cannot be verified after diligent searching."
  ];

  lines.push(
    "",
    "Deliverable:",
    "- Return plain text with one Markdown table per paper using these exact columns (in order):",
    "  | Thesis title | Thesis author | Research group | Year | Associated paper author | Author position | Relevance ranking | Data availability | Data access link |",
    "- Sort each table by relevance (1 = highest).",
    "- After each table, add a short bullet list (≤3 bullets) noting key sources checked and any missing data that needs follow-up."
  );

  paperTargets.forEach((paper, index) => {
    const headerPieces = [];
    headerPieces.push(`Paper ${index + 1}: ${paper.title}`);
    if (typeof paper.year === "number") {
      headerPieces.push(`Publication year: ${paper.year}`);
    }
    if (paper.doi) {
      headerPieces.push(`DOI: ${paper.doi}`);
    } else if (paper.identifier) {
      headerPieces.push(`Identifier: ${paper.identifier}`);
    }

    lines.push("", headerPieces.join(" | "));

    if (paper.authors.length) {
      lines.push(`Authors (listed order): ${paper.authors.join(", ")}`);
    }

    lines.push("Known research groups to start from:");

    paper.groups.forEach((group) => {
      const groupLineParts = [group.name];
      if (group.institution) {
        groupLineParts.push(`Institution: ${group.institution}`);
      }
      lines.push(`- ${groupLineParts.join(" — ")}`);
      if (group.website) {
        lines.push(`  Website: ${group.website}`);
      }
      if (group.notes) {
        lines.push(`  Focus: ${group.notes}`);
      }
      if (group.researchers.length) {
        const contacts = group.researchers
          .map((person) => {
            const pieces = [person.name];
            if (person.role) {
              pieces.push(person.role);
            }
            if (person.email) {
              pieces.push(person.email);
            }
            return pieces.join(" | ");
          })
          .join("; ");
        lines.push(`  Contacts: ${contacts}`);
      }
    });

    lines.push(
      "  Checklist:",
      "  - Verify additional groups for any authors not covered by the list above.",
      "  - Capture thesis titles verbatim; include repository identifiers (handle, DOI) when available.",
      "  - Note if no qualifying thesis exists and explain why (e.g., MSc only, thesis unpublished, author still a candidate)."
    );
  });

  return lines.join("\n");
}

function buildCleanupPrompt() {
  return [
    CLEANUP_PROMPT_HEADER.trim(),
    "",
    "Refer to the analyst notes in the previous message (do not paste them here).",
    "---",
    "[Notes already provided above]",
    "---",
    "Return the JSON object now."
  ].join("\n");
}

function normaliseLatestPublication(entry) {
  const title = entry && typeof entry.title === "string" ? cleanPlainText(entry.title) : null;
  const year = typeof entry?.year === "number" ? entry.year : null;
  const venue = entry && typeof entry.venue === "string" ? cleanPlainText(entry.venue) : null;
  const urlRaw = entry && typeof entry.url === "string" ? cleanUrlStrict(entry.url) : "";
  const url = urlRaw && urlRaw.length > 0 ? urlRaw : null;

  return {
    title: title && title.length > 0 ? title : null,
    year,
    venue: venue && venue.length > 0 ? venue : null,
    url
  };
}

function normaliseThesis(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const title = typeof entry.title === "string" ? cleanPlainText(entry.title) : null;
  const year = typeof entry.year === "number" ? entry.year : null;
  const institution = typeof entry.institution === "string" ? cleanPlainText(entry.institution) : null;
  const urlRaw = typeof entry.url === "string" ? cleanUrlStrict(entry.url) : "";
  const url = urlRaw && urlRaw.length > 0 ? urlRaw : null;

  if (!title && !year && !institution && !url) {
    return null;
  }

  return {
    title: title && title.length > 0 ? title : null,
    year,
    institution: institution && institution.length > 0 ? institution : null,
    url
  };
}

function normaliseDataAvailability(value) {
  if (typeof value !== "string") {
    return "unknown";
  }
  const normalised = value.trim().toLowerCase();
  if (normalised === "yes" || normalised === "no" || normalised === "unknown") {
    return normalised;
  }
  return "unknown";
}

function normaliseResearcher(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const name = cleanPlainText(entry.name || "");
  if (!name) {
    return null;
  }

  const emailRaw = typeof entry.email === "string" ? entry.email.trim() : "";
  const email = emailRaw ? emailRaw.toLowerCase() : null;
  const group = entry.group ? cleanPlainText(entry.group) : null;

  const latestPublication = normaliseLatestPublication(entry.latest_publication || {});
  const thesis = normaliseThesis(entry.phd_thesis);
  const dataAvailability = normaliseDataAvailability(entry.data_publicly_available);

  return {
    name,
    email,
    group: group && group.length > 0 ? group : null,
    latest_publication: latestPublication,
    phd_thesis: thesis,
    data_publicly_available: dataAvailability
  };
}

function normaliseThesisPayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Cleanup agent response must be a JSON object.");
  }

  if (!Array.isArray(payload.researchers) || payload.researchers.length === 0) {
    throw new Error("researchers must be a non-empty array.");
  }

  const researchers = payload.researchers
    .map((entry) => normaliseResearcher(entry))
    .filter(Boolean);

  if (!researchers.length) {
    throw new Error("No valid researcher records after normalisation.");
  }

  const promptNotes = typeof payload.promptNotes === "string" ? cleanPlainText(payload.promptNotes) : "";

  return {
    researchers,
    promptNotes
  };
}

function formatResearcherTheses(researchers) {
  return researchers
    .map((researcher) => {
      const lines = [
        `Researcher: ${researcher.name}${researcher.group ? ` — ${researcher.group}` : ""}`,
        `Email: ${researcher.email || "Not provided"}`,
        `Data publicly available: ${researcher.data_publicly_available}`
      ];

      const pub = researcher.latest_publication || {};
      lines.push("Latest publication:");
      lines.push(`  - Title: ${pub.title || "Not found"}`);
      lines.push(`  - Year: ${typeof pub.year === "number" ? pub.year : "Not found"}`);
      lines.push(`  - Venue: ${pub.venue || "Not found"}`);
      lines.push(`  - URL: ${pub.url || "Not found"}`);

      if (researcher.phd_thesis) {
        const thesis = researcher.phd_thesis;
        lines.push("PhD thesis:");
        lines.push(`  - Title: ${thesis.title || "Not found"}`);
        lines.push(`  - Year: ${typeof thesis.year === "number" ? thesis.year : "Not found"}`);
        lines.push(`  - Institution: ${thesis.institution || "Not found"}`);
        lines.push(`  - URL: ${thesis.url || "Not found"}`);
      } else {
        lines.push("PhD thesis: Not found");
      }

      return lines.join("\n");
    })
    .join("\n\n");
}

async function runResearcherTheses(options = {}) {
  const rl = createInterface();
  const workingDir = process.cwd();
  const {
    entryId: presetEntryId = null
  } = options;

  try {
    console.log("\n=== Researcher Thesis Prompt Helper ===\n");
    console.log(`Working directory: ${workingDir}`);

    const library = readLibrary();
    if (!library.entries.length) {
      console.error("\n❌ No existing mock library found. Run the Similar Papers generator first.");
      return { entryId: null, status: "skipped" };
    }

    let entryId = presetEntryId;
    if (!entryId) {
      const selection = await promptForEntrySelection({
        ask: (question) => ask(rl, question),
        library,
        allowCreate: false,
        header: "Select the mock entry for researcher thesis generation"
      });
      entryId = selection.entryId;
    }

    CURRENT_LIBRARY = library;
    CURRENT_ENTRY_ID = entryId;

    let existingLibrary = getEntry(library, entryId);
    if (!existingLibrary) {
      console.error(`\n❌ Entry "${entryId}" not found.`);
      return { entryId, status: "skipped" };
    }
    existingLibrary = JSON.parse(JSON.stringify(existingLibrary));

    if (!existingLibrary.researchGroups || !existingLibrary.researchGroups.structured) {
      console.error(
        `\n❌ Research groups data missing for entry "${entryId}". Run the research groups generator before extracting thesis prompts.`
      );
      return { entryId, status: "skipped" };
    }

    const discoveryPrompt = buildThesisDiscoveryPrompt(existingLibrary);
    try {
      await copyPromptToClipboard(discoveryPrompt, {
        label: "Discovery prompt"
      });
    } catch (error) {
      console.warn("Failed to copy discovery prompt. Printing below:\n");
      console.log(discoveryPrompt);
    }

    console.log("\nPaste it into the deep research agent to gather thesis notes.\n");
    console.log(
      "\nNext steps:\n  1. Paste the prompt into your research agent and let it complete.\n  2. Collect the per-researcher notes using the provided template.\n  3. Press ENTER here when you're ready for the cleanup prompt.\n"
    );

    await ask(rl, "\nPress ENTER once the notes are ready to receive the cleanup prompt: ");

    const cleanupPrompt = buildCleanupPrompt();
    try {
      await copyPromptToClipboard(cleanupPrompt, {
        label: "Cleanup prompt"
      });
    } catch (error) {
      console.warn("Failed to copy cleanup prompt. Printing below:\n");
      console.log(cleanupPrompt);
    }

    console.log(
      "\nCleanup prompt ready. Paste it into the cleanup agent, add the notes beneath the divider, and request JSON.\n"
    );
    console.log(
      "\nNext steps:\n  1. Paste the cleanup prompt into your LLM.\n  2. Add the discovery notes beneath the placeholder line, then run the cleanup.\n  3. Paste the cleaned JSON back here (press ENTER on an empty line when finished).\n"
    );

    const cleanedJsonRaw = await collectCleanedJson(rl);

    if (!cleanedJsonRaw) {
      console.log("No cleaned JSON provided. Mock library left unchanged.");
      return { entryId: CURRENT_ENTRY_ID, status: "skipped" };
    }

    let cleanedPayload;
    try {
      cleanedPayload = JSON.parse(cleanedJsonRaw);
    } catch (error) {
      console.error("\n❌ Failed to parse the researcher theses JSON. Ensure the cleanup agent returns valid JSON only.");
      console.error("Raw snippet preview:");
      console.error(cleanedJsonRaw.slice(0, 200));
      throw new Error(`Failed to parse researcher theses JSON: ${error instanceof Error ? error.message : String(error)}`);
    }

    const normalised = normaliseThesisPayload(cleanedPayload);
    const formattedText = formatResearcherTheses(normalised.researchers);

    const thesisData = {
      maxChars: formattedText.length,
      truncated: false,
      text: formattedText,
      structured: {
        researchers: normalised.researchers,
        promptNotes: normalised.promptNotes
      }
    };

    const libraryData = {
      ...existingLibrary,
      generatedAt: existingLibrary.generatedAt ?? new Date().toISOString(),
      researcherTheses: thesisData
    };

    const removedIds = writeMockLibrary(libraryData);
    if (removedIds.length > 0) {
      console.log(`\nNote: removed entries ${removedIds.join(", ")} to maintain the ${MAX_ENTRIES}-entry limit.`);
    }

    console.log(`\nMock library updated with researcher theses for entry "${CURRENT_ENTRY_ID}".`);
    return { entryId: CURRENT_ENTRY_ID, status: "completed" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\n❌ ${message}`);
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(message);
  } finally {
    closeInterface(rl);
  }
}

module.exports = {
  runResearcherTheses
};

if (require.main === module) {
  runResearcherTheses().catch(() => {
    process.exitCode = 1;
  });
}
