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
const MAX_INPUT_CHARS = 20_000; // mirrors /api/similar-papers limit
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

function truncateForPrompt(text, limit) {
  if (!text || text.length <= limit) {
    return { clipped: text || "", truncated: false };
  }

  return {
    clipped: `${text.slice(0, limit)}\n\n[Truncated input to ${limit} characters for the request]`,
    truncated: true
  };
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

function buildDiscoveryPrompt(paper) {
  const title = paper.title && paper.title.trim().length > 0 ? paper.title.trim() : "Unknown title";
  const doiOrId =
    (paper.doi && paper.doi.trim()) ||
    (paper.scraped_url && paper.scraped_url.trim()) ||
    (paper.url && paper.url.trim()) ||
    "Not provided";
  const authors = formatAuthors(paper.authors);
  const abstractLine =
    paper.abstract && paper.abstract.trim().length > 0
      ? `- Optional abstract: ${paper.abstract.trim()}`
      : "- Optional abstract: not provided";

  return [
    "You are powering Evidentia’s Similar Papers feature. Collect the research notes we need before a cleanup agent converts them to JSON.",
    "Use the exact headings and bullet structure below. Keep language plain and concrete.",
    "",
    "Source Paper:",
    `- Summary: two sentences on what the paper does (methods focus).`,
    `- Key method signals: bullet the 3-5 method-level highlights founders must know.`,
    `- Search queries: list 3-5 reusable search phrases (no numbering).`,
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
    "- Pick papers with executable method overlap (instrumentation, controls, sample handling).",
    "- If information is missing, write 'Not reported' inside the relevant bullet.",
    "- Keep each method matrix bullet to ~12-18 words.",
    "- Stay under 1,000 tokens total.",
    "",
    "Respond using these headings exactly. No JSON yet."
  ].join("\n");
}

function buildCleanupPrompt() {
  return [
    CLEANUP_PROMPT_HEADER.trim(),
    "",
    "Paste the analyst notes beneath this line before submitting:",
    "---",
    "<PASTE NOTES HERE>",
    "---",
    "Return the JSON object now."
  ].join("\n");
}

function buildAssembledPrompt(basePrompt, extractedText, truncated) {
  return [
    basePrompt,
    "",
    truncated
      ? `Extracted PDF text (truncated to ${MAX_INPUT_CHARS} characters):`
      : "Extracted PDF text:",
    extractedText
  ].join("\n");
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

async function buildPromptFromPdf(pdfPath) {
  const pdfBuffer = fs.readFileSync(pdfPath);
  const data = await pdfParse(pdfBuffer);
  const info = data.info || {};
  const combinedText = data.text || "";
  const fallbackTitle = path.basename(pdfPath, path.extname(pdfPath));
  const detectedDoi = extractDoiCandidate(`${combinedText}\n${JSON.stringify(info)}`);
  const paper = derivePaperMetadata(info, fallbackTitle, detectedDoi);

  const basePrompt = buildDiscoveryPrompt(paper);
  const { clipped, truncated } = truncateForPrompt(combinedText, MAX_INPUT_CHARS);
  const assembledPrompt = buildAssembledPrompt(basePrompt, clipped, truncated);

  return {
    prompt: assembledPrompt,
    context: {
      title: paper.title,
      detectedDoi,
      pageCount: data.numpages,
      truncated,
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

    const { prompt: similarPrompt, context } = await buildPromptFromPdf(pdfPath);

    await clipboardy.write(similarPrompt);

    console.log("\nDiscovery prompt copied to your clipboard. Paste it into the deep research agent to gather Similar Papers notes.\n");
    if (context.truncated) {
      console.log(`Note: extracted text was clipped to ${MAX_INPUT_CHARS.toLocaleString()} characters to match the API limit.`);
    }
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
      generatedAt: new Date().toISOString(),
      sourcePdf: {
        path: path.relative(path.join(__dirname, ".."), pdfPath),
        title: context.title,
        doi: context.detectedDoi,
        pages: context.pageCount
      },
      agent: {
        maxChars: MAX_INPUT_CHARS,
        promptNotes
      },
      sourcePaper: sourcePaperData,
      similarPapers: normalisedPayload.similarPapers,
      researchGroups: existingLibrary?.researchGroups ?? null
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
