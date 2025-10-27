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
  deliverPrompt,
  copyPromptToClipboard,
  collectJsonInput
} = require("./mock-cli-utils");

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

const CLEANUP_PROMPT_HEADER = `You are a cleanup agent. Review ALL discovery responses in this conversation thread and compile them into strict JSON for Evidentia's researcher thesis UI.

Task: Scan back through this conversation to find all author thesis discovery responses. Compile every author's information into a single JSON object.

Output requirements:
- Return a single JSON object with keys: researchers (array), promptNotes (optional string).
- Each researcher object must include: name (string), email (string|null),
  latest_publication (object with title (string|null), year (number|null), venue (string|null), url (string|null)),
  phd_thesis (null or object with title (string|null), year (number|null), institution (string|null), url (string|null)),
  data_publicly_available ("yes" | "no" | "unknown").
- Use null for unknown scalars. Use lowercase for data_publicly_available values.
- Every url field must be a direct https:// link. If the discovery responses include markdown links or reference-style footnotes, extract the underlying URL. Never leave a url blank when a working link was provided.
- For phd_thesis.url, prefer PDF/download URLs when multiple links are available. Only use null when no link was found or it is explicitly unavailable.
- No markdown, commentary, or trailing prose. Valid JSON only (double quotes).
- Preserve factual content from the discovery responses; do not invent new theses or publications.
- Include ALL researchers from ALL discovery responses in this thread - do not skip anyone.`;

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
  const papers = library?.authorContacts?.structured?.papers;
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

      // Extract authors directly from the paper
      const authors = Array.isArray(paper?.authors)
        ? paper.authors
            .map((author) => {
              const name = cleanPlainText(author?.name || "");
              if (!name) {
                return null;
              }
              const role = cleanPlainText(author?.role || "");
              const email = cleanPlainText(author?.email || "");
              return {
                name,
                role: role || null,
                email: email || null
              };
            })
            .filter(Boolean)
        : [];

      if (!authors.length) {
        return null;
      }

      return {
        title,
        identifier: identifier || null,
        doi: meta.doi || normaliseDoi(identifier || "") || null,
        year: typeof meta.year === "number" ? meta.year : null,
        authors
      };
    })
    .filter(Boolean);
}

function collectAuthorTargets(paperTargets) {
  // Flatten papers into individual researchers with paper context
  const targets = [];

  paperTargets.forEach((paper) => {
    if (!Array.isArray(paper.authors) || paper.authors.length === 0) {
      return;
    }

    paper.authors.forEach((author) => {
      targets.push({
        paper,
        author
      });
    });
  });

  return targets;
}

function buildThesisDiscoveryPrompts(library) {
  const paperTargets = collectPaperTargets(library);

  if (!paperTargets.length) {
    throw new Error(
      "No author contacts found. Run the research groups generator (which creates author contacts) before extracting thesis prompts."
    );
  }

  // Generate one prompt per paper (covering all its authors)
  return paperTargets.map((paper) => {
    const lines = [
      "You are a research analyst specializing in PhD thesis discovery for Evidentia.",
      "",
      "Your PRIMARY task is to find the doctoral dissertations for the paper authors listed below.",
      "Use systematic database searches and verify researcher identity carefully.",
      "",
      `Paper: ${paper.title}`
    ];

    if (typeof paper.year === "number") {
      lines.push(`Publication year: ${paper.year}`);
    }
    if (paper.doi) {
      lines.push(`DOI: ${paper.doi}`);
    } else if (paper.identifier) {
      lines.push(`Identifier: ${paper.identifier}`);
    }

    lines.push("", "Authors to investigate:");
    paper.authors.forEach((author, index) => {
      const details = [`${index + 1}. ${author.name}`];
      if (author.role) {
        details.push(author.role);
      }
      if (author.email) {
        details.push(author.email);
      }
      lines.push(`- ${details.join(" — ")}`);
    });

    lines.push(
      "",
      "PRIMARY GOAL: Find the PhD thesis for each researcher listed above.",
      "",
      "For each researcher, complete the following steps in order:",
      "",
      "STEP 1 - PhD Thesis Search (PRIORITY):",
      "Find their doctoral dissertation using the systematic search workflow below. Provide:",
      "- Thesis title",
      "- Year completed",
      "- Awarding institution",
      "- Direct URL to thesis or PDF (institutional repository, national library, or ProQuest)",
      "- Identity verification notes (see workflow below)",
      "",
      "If no thesis is found after thorough search, write \"No thesis verified\" and explain which databases were checked and why no match was found (e.g., researcher may have industry background, thesis not digitized, name ambiguity).",
      "",
      "STEP 2 - Supporting Context (SECONDARY):",
      "If easily available, note:",
      "- Most recent peer-reviewed publication (2022+ preferred): title, year, venue, URL",
      "- Data availability from that publication (yes/no/unknown)",
      "",
      "PhD Thesis Search Workflow (follow this sequence):",
      "",
      "1. START with institutional repositories:",
      "   - Use the author's current/known affiliation to search their institution's thesis repository",
      "   - Check department thesis lists and supervisor pages",
      "   - Look for theses related to the paper's research topic",
      "",
      "2. National thesis databases:",
      "   - ProQuest Dissertations & Theses (global coverage)",
      "   - National/regional thesis libraries (e.g., NDLTD, EThOS UK, HAL France, NARCIS Netherlands)",
      "   - University repository networks (OpenDOAR, BASE)",
      "",
      "3. Cross-reference with academic profiles:",
      "   - Google Scholar: check \"Cited by\" and early publications",
      "   - ORCID profile: look for thesis entries",
      "   - ResearchGate, LinkedIn: check education history",
      "",
      "4. Identity verification (CRITICAL):",
      "   - Confirm the thesis author matches the target researcher by checking:",
      "     • Thesis year aligns with current role (e.g., postdoc in 2023 likely PhD ~2018-2023)",
      "     • Research topic matches the paper's focus area",
      "     • Co-authors or supervisor names appear in their publication history",
      "     • Institution matches known affiliations",
      "   - If multiple candidates appear, explain the ambiguity",
      "",
      "5. Name variations to check:",
      "   - Different first name spellings or middle initials",
      "   - Maiden names (especially for researchers who may have married)",
      "   - Hyphenated surnames",
      "   - Name order variations (Eastern vs Western conventions)",
      "",
      "Output format (plain text notes, no markdown tables):",
      "Researcher: <Full name>",
      "Email: <email or Not provided>",
      "Role: <role or Not provided>",
      "",
      "PhD Thesis:",
      "  Title: <thesis title or No thesis verified>",
      "  Year: <year completed or Unknown>",
      "  Institution: <awarding institution or Unknown>",
      "  URL: <direct https:// link to thesis/PDF or Not found>",
      "  Verification: <concise note on how identity was confirmed OR why no thesis was found>",
      "",
      "Latest Publication (if easily found):",
      "  Title: <title or Skipped>",
      "  Year: <year or Skipped>",
      "  Venue: <venue or Skipped>",
      "  URL: <direct https:// link or Skipped>",
      "  Data Available: <yes/no/unknown or Skipped>",
      "",
      "Search Summary: <list 2-3 key databases checked>",
      "",
      "---",
      "",
      "Repeat this block for every author in the list. Do not skip anyone.",
      "At the end, provide a summary:",
      "- Total authors searched: <number>",
      "- Theses found: <number>",
      "- Theses not verified: <number>",
      "- Primary databases used: <list top 3>"
    );

    return {
      prompt: lines.join("\n"),
      paperTitle: paper.title,
      authorCount: paper.authors.length
    };
  });
}

function buildCleanupPrompt() {
  return [
    CLEANUP_PROMPT_HEADER.trim(),
    "",
    "Look back through this entire conversation thread to find all discovery responses.",
    "Compile every author's PhD thesis information into a single JSON object.",
    "",
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

  const latestPublication = normaliseLatestPublication(entry.latest_publication || {});
  const thesis = normaliseThesis(entry.phd_thesis);
  const dataAvailability = normaliseDataAvailability(entry.data_publicly_available);

  return {
    name,
    email,
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
        `Researcher: ${researcher.name}`,
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

    if (!existingLibrary.authorContacts || !existingLibrary.authorContacts.structured) {
      console.error(
        `\n❌ Author contacts data missing for entry "${entryId}". Run the research groups generator (which creates author contacts) before extracting thesis prompts.`
      );
      return { entryId, status: "skipped" };
    }

    const discoveryPrompts = buildThesisDiscoveryPrompts(existingLibrary);
    const totalPrompts = discoveryPrompts.length;

    console.log(
      `\nPrepared ${totalPrompts} thesis discovery prompt${totalPrompts === 1 ? "" : "s"}. Run them sequentially and keep the notes for cleanup.\n`
    );

    for (let index = 0; index < totalPrompts; index += 1) {
      const chunk = discoveryPrompts[index];
      const label = totalPrompts === 1 ? "Discovery prompt" : `Discovery prompt ${index + 1}/${totalPrompts}`;
      const steps = [
        `Paste into your research agent and gather thesis intel for authors of: ${chunk.paperTitle}.`,
        "Capture per-author findings using the specified output block with direct thesis links when available.",
        "Save the notes from this prompt so you can feed them into the cleanup pass."
      ];

      const waitMessage =
        totalPrompts === 1
          ? "\nPress ENTER once you've captured the notes to continue: "
          : `\nPress ENTER once you've captured notes for paper ${index + 1} ${index === totalPrompts - 1 ? "to continue: " : "to load the next prompt: "}`;

      try {
        await deliverPrompt(rl, chunk.prompt, {
          label,
          previewLength: 320,
          steps,
          waitMessage
        });
      } catch (error) {
        console.warn("Failed to copy discovery prompt. Printing below:\n");
        console.log(chunk.prompt);
        console.log("\nNext steps:");
        steps.forEach((step, stepIndex) => {
          console.log(`  ${stepIndex + 1}. ${step}`);
        });
        await ask(rl, waitMessage);
      }
    }

    console.log(
      "\nAll discovery prompts delivered. Consolidate the collected notes before moving to cleanup.\n"
    );

    await ask(rl, "\nPress ENTER once the combined notes are ready to receive the cleanup prompt: ");

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
