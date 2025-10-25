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
const pdfParse = require("pdf-parse");
const {
  readLibrary,
  writeLibrary,
  upsertEntry,
  getEntry,
  copyPdfToPublic,
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

const MAX_LISTED_PDFS = 40;
const MAX_SCAN_DEPTH = 3;
const IGNORED_DIRS = new Set(["node_modules", ".git", ".next", "out", "dist", "build", "tmp", "temp", "public"]);

const MAX_PROMPT_NOTES_PREVIEW = 400;
const REPO_ROOT = path.join(__dirname, "..");

const CLEANUP_PROMPT_HEADER = `🚨 CRITICAL: USE ONLY STRAIGHT ASCII QUOTES (") - NEVER SMART QUOTES (" " ' ')

Your output MUST be valid JSON that passes JSON.parse. The #1 cause of failure is smart quotes.

BAD (will fail):  "summary": "trained on "cell sentences""
GOOD (will work): "summary": "trained on \"cell sentences\""

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Objective: Convert similar papers notes (from web search + full-text analysis) into strict, valid JSON.

Context: You are receiving notes from a discovery agent that performed web searches and fully read 3-5 papers. Transform this into clean JSON. This is a deterministic ETL process—preserve content exactly, validate schema, avoid extra keys or prose.

CRITICAL JSON FORMATTING RULES:

1. Use ONLY straight ASCII double quotes (") - NEVER use curly/smart quotes (" " ' ')
2. Escape any internal quotes in strings with backslash: \"
3. No trailing commas in arrays or objects
4. No single quotes - only double quotes for strings
5. Numbers must be unquoted (year: 2024, not year: "2024")
6. No markdown code fences (\`\`\`json) or backticks
7. No comments (// or /* */) anywhere
8. No trailing prose after the JSON closes
9. Escape all internal double quotes inside string values with backslash: \"

Example of CORRECT quote handling:
"summary": "The paper uses \"cell sentences\" to train models"

Example of WRONG (will fail):
"summary": "The paper uses "cell sentences" to train models"

Schema Requirements:

Return a single JSON object with keys: sourcePaper, similarPapers, promptNotes (optional).

sourcePaper: {
  summary (string),
  keyMethodSignals (array of strings),
  methodComparison: {
    sample (string - from claims brief),
    materials (string - from claims brief),
    equipment (string - from claims brief),
    procedure (string - from claims brief),
    outcomes (string - from claims brief)
  }
}

similarPapers (array, 3-5 items max): {
  identifier (string - accept DOI, arXiv ID, PubMed URL, or any stable full-text URL),
  title (string),
  authors (array of strings),
  year (number|null),
  venue (string|null),
  whyRelevant (string - extracted from full paper analysis),
  methodOverlap (array of exactly 3 strings - specific points from full paper),
  methodComparison: {
    sample (string - from methods section),
    materials (string - from methods section),
    equipment (string - from methods section),
    procedure (string - from methods section),
    outcomes (string - from results/methods)
  },
  gaps (string|null - uncertainties noted in full paper)
}

Output Requirements:

- Raw JSON only — start with { and end with }
- Must be valid under JSON.parse (strict JSON syntax)
- Use ONLY straight ASCII double quotes (")
- Escape internal quotes: "text with \"quoted\" words"
- NO smart quotes, NO curly quotes, NO single quotes for strings
- Preserve all factual content from the discovery notes exactly
- Use "Not reported" for any missing method fields
- Use null for missing scalar values (year, venue, gaps)
- Keep verbosity low; terminate once validation succeeds

Validation Steps:

1. Ingest analyst notes exactly as provided
2. Parse into structured fields (sourcePaper, similarPapers)
3. Ensure 3-5 papers maximum (accept fewer if that's what was found)
4. For sourcePaper and each similarPaper, populate all 5 methodComparison fields (sample, materials, equipment, procedure, outcomes)
5. Validate conciseness: methodComparison fields should be 1-3 sentences each; gaps should be 2-3 sentences total; whyRelevant should be 2 sentences max
6. Ensure methodOverlap has exactly 3 items per similar paper (each should be 5-15 words)
7. CHECK FOR QUOTE ISSUES: Replace any curly/smart quotes (" " ' ') with straight quotes ("), properly escape internal quotes with \"
8. Validate with JSON.parse; if it fails with quote errors, fix the quotes and retry
9. Final QA: Search your output for any " characters inside strings that are not already escaped; replace them with \" before returning.
10. Stop when valid JSON passes JSON.parse`;

const CURLY_QUOTES_TO_ASCII = [
  [/\u2018|\u2019|\u201A|\u201B/g, "'"],
  [/\u201C|\u201D|\u201E|\u201F/g, '"'],
  [/\u2013|\u2014|\u2015|\u2212/g, "-"],
  [/\u2026/g, "..."],
  [/\u00A0/g, " "],
  [/\u200B|\u200C|\u200D|\uFEFF/g, ""],
  [/\u0000|\u0001|\u0002|\u0003|\u0004|\u0005|\u0006|\u0007|\u0008|\u0009|\u000A|\u000B|\u000C|\u000D/g, " "]
];

const STRING_CLOSERS = new Set([",", "}", "]", ":"]);

function findNextNonWhitespace(str, startIndex) {
  for (let i = startIndex; i < str.length; i += 1) {
    const char = str[i];
    if (char && !/\s/.test(char)) {
      return char;
    }
  }
  return null;
}

function escapeDanglingQuotes(jsonStr) {
  let result = "";
  let inString = false;

  for (let i = 0; i < jsonStr.length; i += 1) {
    const char = jsonStr[i];
    const prevChar = i > 0 ? jsonStr[i - 1] : "";

    if (char === '"' && prevChar !== "\\") {
      if (inString) {
        const nextNonWhitespace = findNextNonWhitespace(jsonStr, i + 1);
        if (nextNonWhitespace && !STRING_CLOSERS.has(nextNonWhitespace)) {
          result += '\\"';
          continue;
        }
        inString = false;
        result += char;
        continue;
      }

      inString = true;
      result += char;
      continue;
    }

    result += char;
  }

  return result;
}


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
    : ["No method signals extracted from claims brief. Focus on method-level overlap."];

  const lines = [
    "Objective: Identify 3-5 papers with the highest methodological overlap to the source paper, based on its claims analysis.",
    "",
    "Context: You have a claims brief (top 3 claims, evidence, gaps, methods). Work strictly from this brief—do not re-open the PDF. Focus on method similarity, not just topical relevance.",
    "",
    "CRITICAL REQUIREMENTS:",
    "1. You MUST use web search to find candidate papers",
    "2. You MUST fully read the COMPLETE full text of each paper before including it in your results",
    "3. Do NOT include any paper you have not read in its entirety",
    "4. If you encounter a paywall or cannot access the full text, SKIP that paper entirely",
    "5. If you can only see an abstract, SKIP that paper - abstracts are insufficient",
    "",
    "Audience: Research analysts comparing experimental approaches.",
    "",
    "Inputs:",
    `- Source paper: ${title}`,
    `- Authors: ${authors}`,
    `- Identifier: ${doiOrId}`,
    "- Claims brief summary:",
  ];

  summaryLines.slice(0, 3).forEach((entry) => {
    lines.push(`  ${entry}`);
  });

  lines.push("", "- Key method signals from brief:");
  methodSignals.slice(0, 5).forEach((entry) => {
    lines.push(`  ${entry}`);
  });

  lines.push(
    "",
    "Constraints:",
    "",
    "Low verbosity, high reasoning; prioritize producing the answer efficiently.",
    "",
    "You MUST read each paper completely from beginning to end before analyzing it.",
    "",
    "Extract method details ONLY from papers you have fully read - never from abstracts, summaries, or partial access.",
    "",
    "Find 3-5 papers maximum—rank by methodological overlap (instrumentation, controls, sample handling).",
    "",
    "Link each paper to specific claims/gaps/next-steps from the brief.",
    "",
    "If you cannot find enough papers with full text access, return fewer papers (even 1-2) rather than including papers you haven't fully read.",
    "",
    "Output Format:",
    "",
    "Output Guidelines:",
    "- Method comparison: Keep each field (sample, materials, equipment, procedure, outcomes) to 1-3 concise sentences. Focus on key distinguishing details only, not exhaustive descriptions.",
    "- Gaps: Summarize in 2-3 sentences maximum. Highlight the most significant limitation or uncertainty.",
    "- Why relevant: Maximum 2 sentences focusing specifically on method overlap with the source paper.",
    "- Key overlaps: 3 bullet points, each 1 sentence or short phrase (5-15 words).",
    "",
    "Source Paper Context: brief synthesis from claims",
    "",
    "Source Paper Methods (extract from the claims brief):",
    "- Sample: <extract from claims brief methods/claims, 1-3 sentences>",
    "- Materials: <extract from claims brief methods/claims, 1-3 sentences>",
    "- Equipment: <extract from claims brief methods/claims, 1-3 sentences>",
    "- Procedure: <extract from claims brief methods/claims, 1-3 sentences>",
    "- Outcomes: <extract from claims brief results/claims, 1-3 sentences>",
    "",
    "Similar Papers (3-5 only, but ONLY papers you have fully read):",
    "",
    "For each paper:",
    "- Title, authors, year, venue, identifier (DOI or URL to full text)",
    "- Why relevant (2 sentences max, focus on method overlap from your full reading)",
    "- Key overlaps (3 specific points, 5-15 words each, citing sections from the full paper)",
    "- Method comparison (1-3 sentences per field: sample, materials, equipment, procedure, key outcomes)",
    "- Gaps or uncertainties (2-3 sentences max from your full paper analysis)",
    "",
    "Steps:",
    "",
    "1. Extract method signals from claims brief",
    "2. WEB SEARCH for papers with similar methods using extracted signals",
    "3. For each candidate paper in search results:",
    "   a. Attempt to access full text (try open access repositories, preprints, institutional access)",
    "   b. If you hit a paywall or can only see abstract: SKIP immediately and try next candidate",
    "   c. If you can access full text: READ THE ENTIRE PAPER from start to finish",
    "   d. Only after reading completely: extract method details and assess overlap",
    "4. Rank papers you have fully read by methodological overlap",
    "5. Select top 3-5 papers that you have completely read",
    "6. Map each back to brief (which claim/gap it addresses)",
    "7. QA: Confirm you have read every single paper in your results from beginning to end; stop once verified"
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
  return collectJsonInput(rl, { promptLabel: "cleaned JSON" });
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

async function runSimilarPapers(options = {}) {
  const rl = createInterface();
  const workingDir = process.cwd();
  const {
    entryId: presetEntryId = null,
    pdfPath: presetPdfPath = null
  } = options;

  try {
    console.log("\n=== Similar Papers Prototype Helper ===\n");
    console.log(`Working directory: ${workingDir}`);

    let pdfPath = null;
    if (presetPdfPath) {
      const resolvedPreset = path.resolve(presetPdfPath);
      if (fs.existsSync(resolvedPreset)) {
        pdfPath = resolvedPreset;
      } else {
        console.warn(`Preset PDF path not found: ${presetPdfPath}`);
      }
    }

    if (!pdfPath) {
      pdfPath = await promptForPdfPath(rl, workingDir);
      if (!pdfPath) {
        console.log("\nNo PDF selected.\n");
        return { entryId: null, pdfPath: null, status: "skipped" };
      }
    }

    console.log(`\nUsing PDF: ${pdfPath}`);

    const library = readLibrary();

    let entryId = presetEntryId;
    let isNew = false;
    let entry;

    if (entryId) {
      const existingEntry = getEntry(library, entryId);
      if (!existingEntry) {
        console.error(`\n❌ Entry "${entryId}" not found.`);
        return { entryId, pdfPath, status: "skipped" };
      }
      entry = JSON.parse(JSON.stringify(existingEntry));
    } else {
      const suggestedSlug = path.basename(pdfPath, path.extname(pdfPath));
      const selection = await promptForEntrySelection({
        ask: (question) => ask(rl, question),
        library,
        allowCreate: true,
        suggestedId: suggestedSlug,
        header: "Select the mock entry to update"
      });

      entryId = selection.entryId;
      isNew = selection.isNew;
      const existingEntry = getEntry(library, entryId);
      entry = existingEntry ? JSON.parse(JSON.stringify(existingEntry)) : { id: entryId };
    }

    const claimsSummaryText =
      entry && typeof entry.claimsAnalysis?.text === "string"
        ? entry.claimsAnalysis.text.trim()
        : "";

    const claimsStructured =
      entry && entry.claimsAnalysis && typeof entry.claimsAnalysis.structured === "object"
        ? entry.claimsAnalysis.structured
        : null;

    if (!claimsSummaryText) {
      console.error(
        `\nNo claims analysis summary found for entry "${entryId}". Run \`node scripts/generate-claims-analysis.js\` first.`
      );
      return { entryId, pdfPath, status: "skipped" };
    }

    if (!claimsStructured) {
      console.error(
        `\nStructured claims data missing for entry "${entryId}". Re-run the claims analysis cleanup to populate it.`
      );
      return { entryId, pdfPath, status: "skipped" };
    }

    const { prompt: similarPrompt, context } = await buildPromptFromPdf(pdfPath, {
      claimsText: claimsSummaryText,
      claimsStructured
    });

    try {
      await copyPromptToClipboard(similarPrompt, {
        label: "Discovery prompt"
      });
    } catch (error) {
      console.warn("Failed to copy discovery prompt. Printing below:\n");
      console.log(similarPrompt);
    }

    console.log("\nPaste it into the deep research agent to gather Similar Papers notes.\n");
    console.log(`Using claims analysis summary from entry "${entryId}".`);
    console.log(`Claims summary length: ${context.summaryChars.toLocaleString()} characters.`);
    console.log(
      "\nNext steps:\n  1. Paste the prompt into your deep research agent.\n  2. Wait for the structured notes to finish.\n  3. Press ENTER here when you're ready for the cleanup prompt.\n"
    );

    await ask(rl, "\nPress ENTER once you've captured the notes to grab the cleanup prompt: ");

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
      "\nCleanup prompt ready. Paste it into the cleanup agent, add the notes below the divider, and convert to JSON.\n"
    );
    console.log(
      "\nNext steps:\n  1. Paste the cleanup prompt into your LLM.\n  2. Add the discovery notes beneath the placeholder line, then run the cleanup.\n  3. Paste the cleaned JSON back here (press ENTER on an empty line when finished).\n"
    );

    const agentRaw = await collectAgentJson(rl);
    if (!agentRaw) {
      console.log("No cleaned JSON provided. Landing page mock left unchanged.");
      return { entryId, pdfPath, status: "skipped" };
    }

    /**
     * Clean JSON string by replacing smart quotes and other problematic characters
     * that would break JSON.parse
     */
    function cleanJsonString(jsonStr) {
      let cleaned = jsonStr;

      // Apply all smart quote replacements
      for (const [pattern, replacement] of CURLY_QUOTES_TO_ASCII) {
        cleaned = cleaned.replace(pattern, replacement);
      }

      // Remove any markdown code fences if present
      cleaned = cleaned.replace(/^```json\s*/gm, '');
      cleaned = cleaned.replace(/^```\s*/gm, '');

      cleaned = escapeDanglingQuotes(cleaned);

      return cleaned.trim();
    }

    let agentPayload;
    try {
      const cleanedJson = cleanJsonString(agentRaw);
      agentPayload = JSON.parse(cleanedJson);
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

    const publicPdfPath = copyPdfToPublic(pdfPath, entryId);

    entry.sourcePdf = {
      ...(entry.sourcePdf ?? {}),
      path: path.relative(REPO_ROOT, pdfPath),
      publicPath: publicPdfPath,
      title: context.title,
      doi: context.detectedDoi,
      pages: context.pageCount
    };

    entry.agent = {
      maxChars: context.summaryChars,
      promptNotes
    };

    entry.sourcePaper = sourcePaperData;
    entry.similarPapers = normalisedPayload.similarPapers;
    entry.generatedAt = new Date().toISOString();

    if (!entry.label) {
      entry.label = sourcePaperData.title ?? entryId;
    }

    const previousIds = library.entries.map((item) => item.id);
    upsertEntry(library, entry);
    writeLibrary(path.basename(__filename), library);

    const removedIds = previousIds.filter((id) => !library.entries.some((item) => item.id === id));
    if (isNew && removedIds.length > 0) {
      console.log(`\nNote: removed oldest mock entry (${removedIds.join(", ")}) to keep the list at ${MAX_ENTRIES}.`);
    }

    console.log(`\nMock library updated for entry "${entryId}". PDF copied to ${publicPdfPath}.`);
    return { entryId, pdfPath, status: "completed" };
  } catch (error) {
    console.error(`\n❌ ${error.message}`);
    throw error;
  } finally {
    closeInterface(rl);
  }
}

module.exports = {
  runSimilarPapers
};

if (require.main === module) {
  runSimilarPapers().catch(() => {
    process.exitCode = 1;
  });
}
