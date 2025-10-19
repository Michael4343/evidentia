#!/usr/bin/env node

/**
 * Interactive prototype helper for the Similar Papers UI experiments.
 *
 * Run with:
 *   node scripts/generate-similar-papers.js
 *
 * Flow:
 *   1. Scans the current directory for PDFs and lets you pick one.
*   2. Extracts text + metadata, then copies the exact prompt our Similar Papers API sends to GPT-5 to your clipboard.
 *   3. Lets you paste the deep-research agent's JSON (type END to finish) and
 *      writes the mock library file that powers the landing page.
 */

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const clipboardModule = require("clipboardy");
const clipboardy = clipboardModule?.default ?? clipboardModule;
const pdfParse = require("pdf-parse");

const DEFAULT_OUTPUT_PATH = path.join(__dirname, "../lib/mock-similar-papers.ts");
const PUBLIC_SAMPLE_PDF_PATH = path.join(__dirname, "../public/mock-paper.pdf");
const MAX_LISTED_PDFS = 40;
const MAX_SCAN_DEPTH = 3;
const IGNORED_DIRS = new Set(["node_modules", ".git", ".next", "out", "dist", "build", "tmp", "temp", "public"]);

const MAX_PROMPT_NOTES_PREVIEW = 400;

const CLEANUP_PROMPT_HEADER = `You are a cleanup agent. Convert the analyst's notes into strict JSON for Evidentia's Similar Papers UI.

Output requirements:
- Return a single JSON object with keys: sourcePaper, similarPapers, promptNotes (optional).
- sourcePaper fields:
  - summary: string (keep concise, two sentences max)
  - keyMethodSignals: array of 3-5 short strings (no numbering)
  - searchQueries: array of 3-5 search phrases
- similarPapers: array of 3-5 objects. Each object must include:
  identifier (string), title (string), doi (string|null), url (string|null),
  authors (array of strings), year (number|null), venue (string|null),
  clusterLabel ("Sample and model" | "Field deployments" | "Insight primers"),
  whyRelevant (string), overlapHighlights (array of exactly 3 short strings),
  methodMatrix (object with keys: sampleModel, materialsSetup, equipmentSetup, procedureSteps, controls, outputsMetrics, qualityChecks, outcomeSummary),
  gapsOrUncertainties (string|null).
- Use "Not reported" inside methodMatrix when information is missing. Use null for unknown scalars.
- No markdown, no commentary, no trailing prose. Ensure valid JSON (double quotes only).
- Preserve factual content; do not invent new details.
`;

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

  // Convert markdown links to "label (url)" so we keep both signals if present.
  value = value.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, (match, label, url) => {
    return `${label} (${url})`;
  });

  // Strip stray closing "](" sequences that can linger after partial links.
  value = value.replace(/\]\((https?:\/\/[^)]+)\)/g, " ($1)");

  // Remove leftover reference-style link brackets like [1].
  value = value.replace(/\[(\d+|[a-zA-Z]+)\]/g, " $1");

  // Collapse internal whitespace but keep newlines meaningful.
  value = value
    .split("\n")
    .map((line) => line.trim())
    .filter((line, index, lines) => line.length > 0 || (index > 0 && lines[index - 1].length > 0))
    .join("\n");

  return value.trim();
}

function cleanUrl(input) {
  if (typeof input !== "string") {
    return input;
  }

  let value = input.trim();
  const markdownUrlMatch = value.match(/\((https?:\/\/[^)]+)\)/);
  if (markdownUrlMatch) {
    value = markdownUrlMatch[1];
  }

  if (!value.startsWith("http")) {
    const firstUrl = value.match(/https?:\/\/[^\s)]+/);
    if (firstUrl) {
      value = firstUrl[0];
    }
  }

  value = value.replace(/^\[+/, "").replace(/\]+$/, "");
  value = value.replace(/["')]+$/g, "").replace(/^["'(]+/g, "");
  return value.trim();
}

function toStringArray(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === "string" ? cleanPlainText(entry) : entry))
      .filter((entry) => typeof entry === "string" && entry.trim().length > 0);
  }

  if (typeof value === "string") {
    return value
      .split(/\r?\n|[•·]|;|\|/)
      .map((item) => cleanPlainText(item))
      .filter((item) => item.length > 0);
  }

  return [];
}

function deepCleanValue(value, key) {
  if (typeof value === "string") {
    if (key === "url" || key.endsWith("Url")) {
      return cleanUrl(value);
    }
    return cleanPlainText(value);
  }

  if (Array.isArray(value)) {
    const cleanedArray = value
      .map((item) => deepCleanValue(item, key))
      .filter((item) => {
        if (item == null) {
          return false;
        }
        if (typeof item === "string") {
          return item.trim().length > 0;
        }
        if (Array.isArray(item)) {
          return item.length > 0;
        }
        if (typeof item === "object") {
          return Object.values(item).some((entry) => {
            if (entry == null) {
              return false;
            }
            if (typeof entry === "string") {
              return entry.trim().length > 0;
            }
            if (Array.isArray(entry)) {
              return entry.length > 0;
            }
            if (typeof entry === "object") {
              return Object.keys(entry).length > 0;
            }
            return true;
          });
        }
        return true;
      });
    return cleanedArray;
  }

  if (value && typeof value === "object") {
    return deepCleanObject(value);
  }

  return value;
}

function deepCleanObject(obj) {
  if (!obj || typeof obj !== "object") {
    return obj;
  }

  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    const cleanedValue = deepCleanValue(value, key);
    if (cleanedValue == null) {
      continue;
    }
    if (typeof cleanedValue === "string" && cleanedValue.trim().length === 0) {
      continue;
    }
    if (Array.isArray(cleanedValue) && cleanedValue.length === 0) {
      continue;
    }
    if (
      typeof cleanedValue === "object" &&
      !Array.isArray(cleanedValue) &&
      Object.keys(cleanedValue).length === 0
    ) {
      continue;
    }
    result[key] = cleanedValue;
  }

  return result;
}

function normaliseSourcePaper(paper) {
  const cleaned = deepCleanObject(paper);
  if (!cleaned || typeof cleaned !== "object") {
    return {};
  }

  const normalised = { ...cleaned };

  if (normalised.keyMethodSignals) {
    const signals = toStringArray(normalised.keyMethodSignals);
    normalised.keyMethodSignals = signals.slice(0, 5);
  }

  if (normalised.searchQueries) {
    normalised.searchQueries = toStringArray(normalised.searchQueries).slice(0, 6);
  } else if (normalised.searchPlaybookQueries) {
    normalised.searchQueries = toStringArray(normalised.searchPlaybookQueries).slice(0, 6);
    delete normalised.searchPlaybookQueries;
  } else if (normalised.searchPlaybook) {
    const queries = toStringArray(normalised.searchPlaybook);
    normalised.searchQueries = queries.slice(0, 6);
    delete normalised.searchPlaybook;
  }

  return normalised;
}

function normaliseSimilarPayload(payload) {
  const sourcePaper = normaliseSourcePaper(payload.sourcePaper);
  const similarPapers = Array.isArray(payload.similarPapers)
    ? payload.similarPapers
        .map((entry) => normaliseSimilarPaper(entry))
        .filter((entry) => Object.keys(entry).length > 0)
        .slice(0, 5)
    : [];
  const promptNotes = typeof payload.promptNotes === "string" ? cleanPlainText(payload.promptNotes) : "";

  return {
    sourcePaper,
    similarPapers,
    promptNotes
  };
}

const METHOD_MATRIX_KEY_ALIASES = {
  samplemodel: "sampleModel",
  sample: "sampleModel",
  model: "sampleModel",
  materials: "materialsSetup",
  materialssetup: "materialsSetup",
  materialsmaterial: "materialsSetup",
  equipment: "equipmentSetup",
  equipments: "equipmentSetup",
  instrument: "equipmentSetup",
  instrumentation: "equipmentSetup",
  equipmentsetup: "equipmentSetup",
  procedure: "procedureSteps",
  procedures: "procedureSteps",
  proceduresteps: "procedureSteps",
  preparation: "procedureSteps",
  preparationsteps: "procedureSteps",
  methods: "procedureSteps",
  controls: "controls",
  controlsetup: "controls",
  outputs: "outputsMetrics",
  output: "outputsMetrics",
  outputsmetrics: "outputsMetrics",
  readouts: "outputsMetrics",
  measurements: "outputsMetrics",
  metrics: "outputsMetrics",
  quality: "qualityChecks",
  qualitychecks: "qualityChecks",
  qc: "qualityChecks",
  qualitycontrol: "qualityChecks",
  outcome: "outcomeSummary",
  outcomes: "outcomeSummary",
  outcomesummary: "outcomeSummary"
};

const METHOD_MATRIX_CANONICAL_KEYS = [
  "sampleModel",
  "materialsSetup",
  "equipmentSetup",
  "procedureSteps",
  "controls",
  "outputsMetrics",
  "qualityChecks",
  "outcomeSummary"
];

function normaliseMethodMatrix(rawMatrix) {
  if (!rawMatrix || typeof rawMatrix !== "object") {
    return undefined;
  }

  const cleanedEntries = deepCleanObject(rawMatrix);
  const canonical = {};

  for (const [key, value] of Object.entries(cleanedEntries)) {
    const lookupKey = key.trim().replace(/[^a-z]/gi, "").toLowerCase();
    const aliasKey = METHOD_MATRIX_KEY_ALIASES[lookupKey];
    const resolvedKey = aliasKey || key;

    if (typeof value === "string") {
      const existing = canonical[resolvedKey];
      canonical[resolvedKey] = existing ? `${existing}; ${value}` : value;
      continue;
    }

    canonical[resolvedKey] = value;
  }

  const result = {};
  METHOD_MATRIX_CANONICAL_KEYS.forEach((key) => {
    if (canonical[key]) {
      result[key] = canonical[key];
    }
  });

  for (const [key, value] of Object.entries(canonical)) {
    if (!(key in result) && value) {
      result[key] = value;
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function normaliseSimilarPaper(paper) {
  const cleaned = deepCleanObject(paper);
  if (!cleaned || typeof cleaned !== "object") {
    return {};
  }

  const normalised = { ...cleaned };

  if (!normalised.identifier) {
    if (normalised.doi) {
      normalised.identifier = normaliseDoi(normalised.doi);
    } else if (normalised.url) {
      normalised.identifier = cleanUrl(normalised.url);
    }
  }

  if (normalised.doi) {
    normalised.doi = normaliseDoi(normalised.doi);
  }

  if (normalised.url) {
    normalised.url = cleanUrl(normalised.url);
  }

  if (normalised.authors) {
    const authors = toStringArray(normalised.authors);
    normalised.authors = authors.length ? authors : undefined;
  }

  if (normalised.overlapHighlights) {
    const highlights = toStringArray(normalised.overlapHighlights).map((item) => item.replace(/^[-•\d.\s]+/, ""));
    if (!highlights.length) {
      normalised.overlapHighlights = ["Not reported", "Not reported", "Not reported"];
    } else {
      while (highlights.length < 3) {
        highlights.push("Not reported");
      }
      normalised.overlapHighlights = highlights.slice(0, 3);
    }
  } else {
    normalised.overlapHighlights = ["Not reported", "Not reported", "Not reported"];
  }

  if (typeof normalised.year === "string") {
    const parsedYear = Number.parseInt(normalised.year, 10);
    normalised.year = Number.isFinite(parsedYear) ? parsedYear : null;
  }

  if (normalised.clusterLabel) {
    const label = cleanPlainText(normalised.clusterLabel).toLowerCase();
    if (label.includes("sample")) {
      normalised.clusterLabel = "Sample and model";
    } else if (label.includes("field")) {
      normalised.clusterLabel = "Field deployments";
    } else if (label.includes("insight")) {
      normalised.clusterLabel = "Insight primers";
    } else {
      normalised.clusterLabel = cleanPlainText(normalised.clusterLabel);
    }
  } else {
    normalised.clusterLabel = "Sample and model";
  }

  if (cleaned.methodMatrix) {
    const normalisedMatrix = normaliseMethodMatrix(cleaned.methodMatrix);
    if (normalisedMatrix) {
      normalised.methodMatrix = normalisedMatrix;
    } else {
      delete normalised.methodMatrix;
    }
  }

  if (!('gapsOrUncertainties' in normalised)) {
    normalised.gapsOrUncertainties = null;
  }

  return normalised;
}

function normaliseDoi(raw) {
  return raw.replace(/[\s<>\]\).,;:]+$/g, "").replace(/^[\s"'(<\[]+/g, "").toLowerCase();
}

function extractDoiCandidate(text) {
  const DOI_REGEX = /10\.\d{4,9}\/[\-._;()/:a-z0-9]+/gi;
  const matches = text.match(DOI_REGEX);
  if (matches && matches.length > 0) {
    return normaliseDoi(matches[0]);
  }
  return null;
}

function limitList(items, limit) {
  if (!Array.isArray(items)) {
    return [];
  }
  return items
    .map((item) => (typeof item === "string" ? cleanPlainText(item) : ""))
    .filter((item) => item && item.trim().length > 0)
    .slice(0, limit);
}

function generateSearchPhrase(text) {
  if (typeof text !== "string") {
    return "";
  }
  const cleaned = cleanPlainText(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    return "";
  }

  const tokens = cleaned.split(" ").filter((token) => token.length > 3);
  const unique = [];
  for (const token of tokens) {
    if (!unique.includes(token)) {
      unique.push(token);
    }
    if (unique.length >= 5) {
      break;
    }
  }

  return unique.join(" ");
}

function deriveSignalsFromClaims(structured) {
  const empty = {
    summaryLines: [],
    methodSignals: [],
    searchQueries: [],
    claimsOverview: [],
    gapHighlights: [],
    methodsSnapshot: [],
    riskItems: [],
    openQuestions: []
  };

  if (!structured || typeof structured !== "object") {
    return empty;
  }

  const summaryLines = limitList(structured.executiveSummary, 3);

  const claimsArray = Array.isArray(structured.claims)
    ? structured.claims.filter((claim) => claim && typeof claim === "object")
    : [];

  const methodSignals = claimsArray
    .slice(0, 4)
    .map((claim) => {
      const id = typeof claim.id === "string" && claim.id.trim().length > 0 ? claim.id.trim() : "Claim";
      const evidence = cleanPlainText(claim.evidenceSummary || claim.claim || "");
      return `${id}: ${evidence}`;
    })
    .filter((entry) => entry && entry.trim().length > 0);

  const claimsOverview = claimsArray
    .slice(0, 6)
    .map((claim) => {
      const id = typeof claim.id === "string" && claim.id.trim().length > 0 ? claim.id.trim() : "Claim";
      const strength = typeof claim.strength === "string" && claim.strength.trim().length > 0 ? ` [${claim.strength.trim()}]` : "";
      const text = cleanPlainText(claim.claim || claim.evidenceSummary || "");
      return `${id}${strength}: ${text}`;
    })
    .filter((entry) => entry && entry.trim().length > 0);

  const searchQueries = [];
  for (const claim of claimsArray) {
    if (searchQueries.length >= 5) {
      break;
    }
    const phrase = generateSearchPhrase(claim.claim || claim.evidenceSummary || "");
    if (phrase && !searchQueries.includes(phrase)) {
      searchQueries.push(phrase);
    }
  }

  const filteredQueries = searchQueries.filter((entry) => entry && entry.trim().length > 0);

  const gapsArray = Array.isArray(structured.gaps)
    ? structured.gaps.filter((gap) => gap && typeof gap === "object")
    : [];

  const gapHighlights = gapsArray
    .slice(0, 4)
    .map((gap) => {
      const category = cleanPlainText(gap.category || "Gap");
      const detail = cleanPlainText(gap.detail || "Detail not provided");
      const claims = Array.isArray(gap.relatedClaimIds) && gap.relatedClaimIds.length > 0 ? ` (claims: ${gap.relatedClaimIds.join(", ")})` : "";
      return `${category}: ${detail}${claims}`;
    })
    .filter((entry) => entry && entry.trim().length > 0);

  const methodsSnapshot = limitList(structured.methodsSnapshot, 4);

  const riskItems = Array.isArray(structured.riskChecklist)
    ? structured.riskChecklist
        .filter((item) => item && typeof item === "object")
        .slice(0, 4)
        .map((item) => {
          const label = cleanPlainText(item.item || "Assessment");
          const status = typeof item.status === "string" && item.status.trim().length > 0 ? item.status.trim() : "unclear";
          const note = cleanPlainText(item.note || "");
          return `${label} — ${status}${note ? ` (${note})` : ""}`;
        })
        .filter((entry) => entry && entry.trim().length > 0)
    : [];

  const openQuestions = limitList(structured.openQuestions, 5);

  return {
    summaryLines,
    methodSignals,
    searchQueries: filteredQueries,
    claimsOverview,
    gapHighlights,
    methodsSnapshot,
    riskItems,
    openQuestions
  };
}

function buildClaimsReferenceAddon(derived) {
  const sections = [];

  if (derived.claimsOverview.length) {
    sections.push("Claims brief references:");
    derived.claimsOverview.forEach((line) => {
      sections.push(`- ${line}`);
    });
  }

  if (derived.gapHighlights.length) {
    sections.push("", "Gaps & limitations to address:");
    derived.gapHighlights.forEach((line) => {
      sections.push(`- ${line}`);
    });
  }

  if (derived.methodsSnapshot.length) {
    sections.push("", "Methods snapshot cues:");
    derived.methodsSnapshot.forEach((line) => {
      sections.push(`- ${line}`);
    });
  }

  if (derived.riskItems.length) {
    sections.push("", "Risk / quality notes:");
    derived.riskItems.forEach((line) => {
      sections.push(`- ${line}`);
    });
  }

  if (derived.openQuestions.length) {
    sections.push("", "Open questions to pursue:");
    derived.openQuestions.forEach((line) => {
      sections.push(`- ${line}`);
    });
  }

  return sections.join("\n");
}

function normaliseAuthorName(author) {
  if (!author) {
    return null;
  }

  if (typeof author === "string") {
    const cleaned = author.trim();
    return cleaned.length ? cleaned : null;
  }

  if (typeof author === "object" && author !== null && "name" in author && typeof author.name === "string") {
    const cleaned = author.name.trim();
    return cleaned.length ? cleaned : null;
  }

  return null;
}

function formatAuthors(authors) {
  if (!authors) {
    return "Not provided";
  }

  if (typeof authors === "string") {
    const raw = authors.trim();
    if (!raw) {
      return "Not provided";
    }
    const split = raw.split(/[,;|\n]+/).map((entry) => entry.trim()).filter(Boolean);
    return split.length ? split.join(", ") : raw;
  }

  if (Array.isArray(authors)) {
    const names = authors.map((entry) => normaliseAuthorName(entry)).filter(Boolean);
    return names.length ? names.join(", ") : "Not provided";
  }

  return "Not provided";
}

function buildDiscoveryPrompt(paper, claimsDerived) {
  const title = paper.title && paper.title.trim().length > 0 ? paper.title.trim() : "Unknown title";
  const doiOrId =
    (paper.doi && paper.doi.trim()) ||
    (paper.scraped_url && paper.scraped_url.trim()) ||
    (paper.url && paper.url.trim()) ||
    "Not provided";
  const authors = formatAuthors(paper.authors);

  const summaryLines = claimsDerived.summaryLines.length > 0
    ? claimsDerived.summaryLines
    : [cleanPlainText(paper.abstract || "Summary not provided in claims brief.")];

  const methodSignals = claimsDerived.methodSignals.length > 0
    ? claimsDerived.methodSignals
    : ["No method signals extracted from claims brief. Focus on pore structure, microbiome functions, and management levers." ];

  const searchQueriesRaw = claimsDerived.searchQueries.length > 0
    ? claimsDerived.searchQueries
    : [generateSearchPhrase(`${title} soil structure microbiome management`), "soil aggregate microbiome greenhouse gases"];

  const searchQueries = Array.from(
    new Set(
      searchQueriesRaw
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter((entry) => entry.length > 0)
    )
  );

  const lines = [
    "You are powering Evidentia’s Similar Papers feature. Collect the research notes we need before a cleanup agent converts them to JSON.",
    "You are provided with a structured claims brief (executive summary, claims, gaps, methods, risk, next steps). Use it as the authoritative context—do not re-open the PDF.",
    "Focus on the methods, evidence strength, gaps, and open questions surfaced in that brief when selecting comparison papers.",
    "When you reference the brief, note the section (e.g., Key Claims C1/C2, Gaps, Methods Snapshot) so downstream systems can trace provenance.",
    "Use the exact headings and bullet structure below for your output. Keep language plain and concrete.",
    "",
    "Source Paper (claims brief synthesis):",
    `- Title: ${title}`,
    `- Identifier: ${doiOrId}`,
    `- Authors: ${authors}`,
    "- Summary:",
  ];

  summaryLines.slice(0, 3).forEach((entry) => {
    lines.push(`  - ${entry}`);
  });

  lines.push("- Key method signals:");
  methodSignals.slice(0, 5).forEach((entry) => {
    lines.push(`  - ${entry}`);
  });

  lines.push("- Search queries:");
  searchQueries.slice(0, 5).forEach((entry) => {
    lines.push(`  - ${entry}`);
  });

  lines.push(
    "",
    "Similar Papers (3-5 entries):",
    "For each entry use this template (start each paper with its number):",
    "1. Identifier: <DOI or stable URL>",
    "   Title: <paper title>",
    "   Authors: <comma-separated names>",
    "   Year: <year or 'Not reported'>",
    "   Venue: <journal/conference or 'Not reported'>",
    "   Cluster: <Sample and model | Field deployments | Insight primers>",
    "   Why relevant: <2 sentences focusing on method overlap>",
    "   Overlap highlights:",
    "   - <short fragment 1>",
    "   - <short fragment 2>",
    "   - <short fragment 3>",
    "   Method matrix:",
    "   - Sample / model: <text>",
    "   - Materials: <text>",
    "   - Equipment: <text>",
    "   - Procedure: <text>",
    "   - Controls: <text>",
    "   - Outputs / metrics: <text>",
    "   - Quality checks: <text>",
    "   - Outcome summary: <text>",
    "   Gaps or uncertainties: <note if something is missing or risky>",
    "",
    "Guidelines:",
    "- Anchor recommendations to the claims brief: pull method cues, evidence strength, and gaps directly from the provided sections.",
    "- Pick papers with executable method overlap (instrumentation, controls, sample handling).",
    "- Where possible, map each similar paper back to the brief: cite which claim/gap/next-step it supports or extends.",
    "- If information is missing, write 'Not reported' inside the relevant bullet.",
    "- Keep each method matrix bullet to ~12-18 words.",
    "- Stay under 1,000 tokens total.",
    "",
    "Respond using these headings exactly. No JSON yet."
  );

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

function buildAssembledPrompt(basePrompt, referenceAddon, claimsSummaryText) {
  const segments = [basePrompt.trim()];

  if (referenceAddon && referenceAddon.trim().length > 0) {
    segments.push("", referenceAddon.trim());
  }

  if (claimsSummaryText && claimsSummaryText.trim().length > 0) {
    segments.push("", "Claims brief (verbatim for reference):", claimsSummaryText.trim());
  }

  return segments.join("\n");
}

function ensureDirExists(targetPath) {
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function writeMockLibrary(outputPath, libraryData) {
  ensureDirExists(outputPath);
  const banner = `// Auto-generated by scripts/${path.basename(__filename)} on ${new Date().toISOString()}\n`;
  const warning = "// Do not edit by hand. Re-run the script with updated inputs.";
  const fileContents = `${banner}${warning}\n\nexport const MOCK_SIMILAR_PAPERS_LIBRARY = ${JSON.stringify(libraryData, null, 2)} as const;\n`;
  fs.writeFileSync(outputPath, fileContents, "utf-8");
}

function readExistingLibrary(outputPath) {
  if (!fs.existsSync(outputPath)) {
    return null;
  }

  try {
    const fileContents = fs.readFileSync(outputPath, "utf-8");
    const match = fileContents.match(/export const MOCK_SIMILAR_PAPERS_LIBRARY = (\{[\s\S]*\}) as const;/);
    if (!match || !match[1]) {
      return null;
    }
    return JSON.parse(match[1]);
  } catch (error) {
    console.warn("Failed to read existing mock library", error);
    return null;
  }
}

function sanitiseAgentPayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Agent response must be a JSON object");
  }

  if (!payload.sourcePaper || !payload.similarPapers) {
    throw new Error("Agent response missing required keys: sourcePaper + similarPapers");
  }

  if (!Array.isArray(payload.similarPapers) || payload.similarPapers.length === 0) {
    throw new Error("similarPapers must be a non-empty array");
  }

  return {
    sourcePaper: payload.sourcePaper,
    similarPapers: payload.similarPapers,
    promptNotes: payload.promptNotes || ""
  };
}

function findPdfFiles(rootDir, maxDepth = MAX_SCAN_DEPTH, limit = MAX_LISTED_PDFS) {
  const results = [];

  function walk(currentDir, depth) {
    if (results.length >= limit) {
      return;
    }
    if (depth > maxDepth) {
      return;
    }

    let entries = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch (error) {
      return;
    }

    for (const entry of entries) {
      if (results.length >= limit) {
        break;
      }
      if (entry.name.startsWith(".")) {
        continue;
      }

      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) {
          walk(fullPath, depth + 1);
        }
        continue;
      }

      if (entry.isFile() && entry.name.toLowerCase().endsWith(".pdf")) {
        results.push({
          relative: path.relative(rootDir, fullPath) || entry.name,
          absolute: fullPath
        });
      }
    }
  }

  walk(rootDir, 0);
  return results;
}

function createInterface() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
}

function ask(rl, question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}

async function promptForPdfPath(rl, rootDir) {
  const pdfFiles = findPdfFiles(rootDir);

  if (pdfFiles.length > 0) {
    console.log(`\nFound ${pdfFiles.length} PDF${pdfFiles.length === 1 ? "" : "s"} within ${path.basename(rootDir) || "."}:`);
    pdfFiles.forEach((file, index) => {
      console.log(`  [${index + 1}] ${file.relative}`);
    });
    console.log("  [0] Enter a custom path");

    while (true) {
      const answer = await ask(rl, "\nSelect a PDF by number (or type a custom path): ");
      const trimmed = answer.trim();
      if (!trimmed) {
        continue;
      }

      if (/^\d+$/.test(trimmed)) {
        const index = Number.parseInt(trimmed, 10);
        if (index === 0) {
          break;
        }
        if (index >= 1 && index <= pdfFiles.length) {
          return pdfFiles[index - 1].absolute;
        }
        console.log("Invalid selection. Try again.");
        continue;
      }

      const resolved = path.resolve(rootDir, trimmed);
      if (fs.existsSync(resolved) && resolved.toLowerCase().endsWith(".pdf")) {
        return resolved;
      }
      console.log("Path does not point to a PDF. Try again.");
    }
  }

  while (true) {
    const manual = await ask(rl, "Enter the path to a PDF: ");
    const resolved = path.resolve(rootDir, manual.trim());
    if (fs.existsSync(resolved) && resolved.toLowerCase().endsWith(".pdf")) {
      return resolved;
    }
    console.log("Could not find that PDF. Please try again.");
  }
}

async function collectAgentJson(rl) {
  console.log("\nPaste the cleaned JSON now. Press ENTER on an empty line when you're done.");
  console.log("Press ENTER immediately to skip when you don't have output yet.\n");

  const lines = [];
  while (true) {
    const line = await ask(rl, "> ");
    const trimmed = line.trim();
    if (lines.length === 0 && !trimmed) {
      return "";
    }
    if (!trimmed) {
      break;
    }
    if (trimmed.toUpperCase() === "END") {
      break;
    }
    lines.push(line);
  }

  return lines.join("\n").trim();
}

function derivePaperMetadata(info, fallbackTitle, detectedDoi) {
  const authors = info?.Author || info?.Authors || info?.Creator || null;
  const abstract = info?.Subject || info?.Keywords || null;

  return {
    title: info?.Title && info.Title.trim().length ? info.Title.trim() : fallbackTitle,
    doi: detectedDoi,
    url: null,
    scraped_url: null,
    authors,
    abstract
  };
}

async function buildPromptFromPdf(pdfPath, options = {}) {
  const { claimsText, claimsStructured } = options;
  if (typeof claimsText !== "string" || claimsText.trim().length === 0) {
    throw new Error("Claims summary text is required to build the similar papers prompt.");
  }
  if (!claimsStructured || typeof claimsStructured !== "object") {
    throw new Error("Claims structured data is required. Re-run the claims analysis script to populate structured output.");
  }
  const pdfBuffer = fs.readFileSync(pdfPath);
  const data = await pdfParse(pdfBuffer);
  const info = data.info || {};
  const combinedText = data.text || "";
  const fallbackTitle = path.basename(pdfPath, path.extname(pdfPath));
  const detectedDoi = extractDoiCandidate(`${combinedText}\n${JSON.stringify(info)}`);
  const paper = derivePaperMetadata(info, fallbackTitle, detectedDoi);

  const claimsSummary = cleanPlainText(claimsText);
  const derivedSignals = deriveSignalsFromClaims(claimsStructured);
  const basePrompt = buildDiscoveryPrompt(paper, derivedSignals);
  const referenceAddon = buildClaimsReferenceAddon(derivedSignals);
  const assembledPrompt = buildAssembledPrompt(basePrompt, referenceAddon, claimsSummary);

  return {
    prompt: assembledPrompt,
    context: {
      title: paper.title,
      detectedDoi,
      pageCount: data.numpages,
      summaryChars: claimsSummary.length,
      authors: paper.authors,
      abstract: paper.abstract
    }
  };
}

async function run() {
  const rl = createInterface();
  const workingDir = process.cwd();

  try {
    console.log("\n=== Similar Papers Prototype Helper ===\n");
    console.log(`Working directory: ${workingDir}`);

    const pdfPath = await promptForPdfPath(rl, workingDir);
    console.log(`\nUsing PDF: ${pdfPath}`);

    const outputPath = path.resolve(workingDir, DEFAULT_OUTPUT_PATH);
    const existingLibrary = readExistingLibrary(outputPath);

    const claimsSummaryText =
      existingLibrary && typeof existingLibrary.claimsAnalysis?.text === "string"
        ? existingLibrary.claimsAnalysis.text.trim()
        : "";

    const claimsStructured =
      existingLibrary && existingLibrary.claimsAnalysis && typeof existingLibrary.claimsAnalysis.structured === "object"
        ? existingLibrary.claimsAnalysis.structured
        : null;

    if (!claimsSummaryText) {
      console.error(
        "\nNo claims analysis summary found. Run `node scripts/generate-claims-analysis.js` first to populate lib/mock-similar-papers.ts."
      );
      rl.close();
      return;
    }

    if (!claimsStructured) {
      console.error(
        "\nClaims structured data missing. Re-run `node scripts/generate-claims-analysis.js` so the structured payload is saved."
      );
      rl.close();
      return;
    }

    const { prompt: similarPrompt, context } = await buildPromptFromPdf(pdfPath, {
      claimsText: claimsSummaryText,
      claimsStructured
    });

    await clipboardy.write(similarPrompt);

    console.log("\nDiscovery prompt copied to your clipboard. Paste it into the deep research agent to gather Similar Papers notes.\n");
    console.log("Using claims analysis summary from lib/mock-similar-papers.ts as the source text.");
    console.log(`Claims summary length: ${context.summaryChars.toLocaleString()} characters.`);
    console.log("Preview:");
    console.log(`${similarPrompt.slice(0, 240)}${similarPrompt.length > 240 ? "…" : ""}`);
    console.log(
      "\nNext steps:\n  1. Paste the prompt into your deep research agent.\n  2. Wait for the structured notes to finish.\n  3. Press ENTER here when you're ready for the cleanup prompt.\n"
    );

    await ask(rl, "\nPress ENTER once you've captured the notes to grab the cleanup prompt: ");

    const cleanupPrompt = buildCleanupPrompt();
    await clipboardy.write(cleanupPrompt);

    console.log("\nCleanup prompt copied to your clipboard. Paste it into the cleanup agent, add the notes below the divider, and convert to JSON.\n");
    console.log("Preview:");
    console.log(`${cleanupPrompt.slice(0, 240)}${cleanupPrompt.length > 240 ? "…" : ""}`);
    console.log(
      "\nNext steps:\n  1. Paste the cleanup prompt into your LLM.\n  2. Add the discovery notes beneath the placeholder line, then run the cleanup.\n  3. Paste the cleaned JSON back here (press ENTER on an empty line when finished).\n"
    );

    const agentRaw = await collectAgentJson(rl);
    if (!agentRaw) {
      console.log("No cleaned JSON provided. Landing page mock left unchanged.");
      return;
    }

    let agentPayload;
    try {
      agentPayload = JSON.parse(agentRaw);
    } catch (error) {
      console.error("\n❌ Failed to parse the Similar Papers JSON. Make sure it's valid JSON only — no markdown, trailing commas, or smart quotes.");
      console.error("Raw snippet preview:");
      console.error(agentRaw.slice(0, 200));
      throw new Error(`Failed to parse agent JSON: ${error instanceof Error ? error.message : String(error)}`);
    }

    const cleanPayload = sanitiseAgentPayload(agentPayload);
    const normalisedPayload = normaliseSimilarPayload(cleanPayload);

    if (!normalisedPayload.similarPapers.length) {
      throw new Error("similarPapers array was empty after cleanup. Provide at least one paper.");
    }

    const sourcePaperData = {
      title: context.title,
      ...normalisedPayload.sourcePaper
    };
    if (Array.isArray(sourcePaperData?.keyMethods) || sourcePaperData?.keyMethods === null) {
      delete sourcePaperData.keyMethods;
    }

    const promptNotes = normalisedPayload.promptNotes && normalisedPayload.promptNotes.length > 0
      ? normalisedPayload.promptNotes
      : "";

    const libraryData = {
      ...existingLibrary,
      generatedAt: new Date().toISOString(),
      sourcePdf: {
        path: path.relative(path.join(__dirname, ".."), pdfPath),
        title: context.title,
        doi: context.detectedDoi,
        pages: context.pageCount
      },
      agent: {
        maxChars: context.summaryChars,
        promptNotes
      },
      claimsAnalysis: existingLibrary?.claimsAnalysis ?? null,
      sourcePaper: sourcePaperData,
      similarPapers: normalisedPayload.similarPapers,
      researchGroups: existingLibrary?.researchGroups ?? null,
      researcherTheses: existingLibrary?.researcherTheses ?? null
    };

    writeMockLibrary(outputPath, libraryData);

    try {
      ensureDirExists(PUBLIC_SAMPLE_PDF_PATH);
      fs.copyFileSync(pdfPath, PUBLIC_SAMPLE_PDF_PATH);
      console.log(`Copied PDF to ${path.relative(workingDir, PUBLIC_SAMPLE_PDF_PATH)}`);
    } catch (copyError) {
      console.warn("Failed to copy PDF into public/mock-paper.pdf", copyError);
    }

    console.log(`\nMock library updated: ${path.relative(workingDir, DEFAULT_OUTPUT_PATH)}`);
  } catch (error) {
    console.error(`\n❌ ${error.message}`);
    process.exitCode = 1;
  } finally {
    rl.close();
  }
}

run();
