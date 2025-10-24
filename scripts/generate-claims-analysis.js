#!/usr/bin/env node

/**
 * Prototype helper that prepares the claims & gaps prompt for the homepage mock.
 *
 * Usage:
 *   node scripts/generate-claims-analysis.js
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
const MAX_SCAN_DEPTH = 3;
const MAX_LISTED_PDFS = 40;
const IGNORED_DIRS = new Set(["node_modules", ".git", ".next", "out", "dist", "build", "tmp", "temp", "public"]);

const CLAIMS_PROMPT_TEMPLATE = `Objective: Generate a rigorous, concise, text-only claims analysis of a single scientific paper, clearly stating its top 3 claims, supporting evidence, and gaps or limitations.

Context: You will receive raw text extracted from one scientific PDF. Work strictly from this text (no external sources). Focus on identifying and evaluating the paper's top 3 claims. Keep behaviour tightly scoped: prioritise producing the answer efficiently, proceed under reasonable assumptions without asking for clarification, and stop once acceptance criteria are met.

Audience and Tone: Research analysts and domain experts; tone is neutral, precise, evidence-centred, and concise.

Inputs:

Raw PDF text: [PASTE RAW TEXT HERE]

Constraints:

Text-only output (no JSON). Use Australian spelling and DD/MM/YYYY dates.

Base all findings strictly on the provided text; no external browsing or inference.

Attribute every claim and evidence item to page/section/figure/table references where available.

Extract numerical results exactly as written (effect sizes, CIs, p-values, N, timeframes).

Flag OCR artefacts or ambiguities with [UNCLEAR]; state assumptions explicitly.

Calibrate model behaviour: low verbosity, high reasoning; avoid unnecessary exploration and terminate once all acceptance criteria are satisfied.

Output Format:

Executive Summary: main findings, headline numbers, overall evidence strength (High/Moderate/Low).

Top 3 Claims and Evidence (C1–C3 only), each with:

One-sentence claim.

Evidence summary (design, sample, measures, analysis).

Key numbers (effect size, CI, p, N, timeframe).

Source location (page/section/figure/table).

Strength rating (High/Moderate/Low/Unclear) and key assumptions/conditions.

Gaps & Limitations: identify weaknesses and link each to C1–C3.

Methods Snapshot: brief overview of study design and approach.

Risk-of-Bias/Quality Checklist: brief assessment.

Open Questions & Next Steps: specific, testable follow-ups.

Steps or Acceptance Criteria:

Parse and segment the raw text; note missing sections explicitly.

Identify all distinct claims; rank by centrality (presence in abstract/conclusion, frequency, emphasis); select the top 3 only.

For C1–C3, summarise direct supporting evidence with precise locations and key numbers; classify evidence type (e.g., RCT, observational, simulation, qualitative, prior work).

Rate strength: High (appropriate design, adequate N, consistent results, clear statistics); Moderate (some limitations); Low (weak support/speculative); Unclear (insufficient detail).

Identify gaps/limitations tied to C1–C3.

Provide a concise methods snapshot and risk-of-bias checklist based only on stated details.

QA: all sections present; numbers match text exactly; each of C1–C3 has strength ratings and location references or [DETAIL NEEDED]; stop once checks pass.
`;

const CLEANUP_PROMPT_HEADER = `Objective: Convert the single-paper claims summary into strict JSON for Evidentia's claims UI (expects up to 3 claims: C1–C3).

Context: Input is the text output from the analysis step. Deterministic ETL process; preserve content exactly, validate schema, avoid extra keys or prose.

Schema Requirements:

Return a single JSON object with keys: text (string), structured (object), promptNotes (optional string).

text: Reproduce the analyst's formatted summary exactly (including headings and bullet markers). Replace every newline with \n and escape embedded double quotes with \".

structured.executiveSummary: array of strings.

structured.claims (max 3 items): array of objects { id, claim, evidenceSummary, keyNumbers (array of strings), source, strength, assumptions, evidenceType }. strength ∈ {"High","Moderate","Low","Unclear"}. Use [] for missing keyNumbers; use null for unknown scalars.

structured.gaps: array of objects { category, detail, relatedClaimIds (array of strings limited to ["C1","C2","C3"]) }.

structured.methodsSnapshot: array of strings.

structured.riskChecklist: array of objects { item, status, note }, where status ∈ {"met","partial","missing","unclear"} (lowercase).

structured.openQuestions: array of strings.

Output raw JSON only — no markdown fences, comments, or trailing prose. Must be valid under JSON.parse.

Preserve factual content; do not invent claims or numbers. Use "[DETAIL NEEDED]" exactly when details are missing.

Keep verbosity low; terminate once validation succeeds.

Validation Steps:

1. Ingest the analyst summary string exactly as provided.
2. Produce text by escaping embedded double quotes and replacing each newline with \n, preserving all characters.
3. Parse the summary into structured fields (executiveSummary, claims [C1–C3 only], gaps, methodsSnapshot, riskChecklist, openQuestions).
4. For each claim (max 3), populate all fields; use [] for missing arrays and null for unknown scalars.
5. Populate riskChecklist statuses with only {"met","partial","missing","unclear"}.
6. Emit a single JSON object with exactly the allowed keys.
7. Validate with JSON.parse; if invalid, fix escaping/typing and re-validate; stop when valid.
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

  value = value
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n");

  return value.trim();
}

function collectPdfFiles(root, depth = 0, results = []) {
  if (depth > MAX_SCAN_DEPTH) {
    return results;
  }

  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (error) {
    return results;
  }

  for (const entry of entries) {
    if (results.length >= MAX_LISTED_PDFS) {
      break;
    }

    if (entry.name.startsWith(".")) {
      continue;
    }

    const fullPath = path.join(root, entry.name);

    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) {
        continue;
      }
      collectPdfFiles(fullPath, depth + 1, results);
      continue;
    }

    if (entry.isFile() && entry.name.toLowerCase().endsWith(".pdf")) {
      results.push(fullPath);
    }
  }

  return results;
}

async function selectPdf(rl, files) {
  if (!files.length) {
    console.log("\nNo PDF files found. Place a paper in the project root and rerun.\n");
    return null;
  }

  console.log("\nSelect a PDF to analyse:\n");
  files.forEach((file, index) => {
    const relative = path.relative(process.cwd(), file);
    console.log(`${index + 1}. ${relative}`);
  });
  console.log("");

  const answer = await ask(rl, `Enter a number (1-${files.length}) or paste a custom path: `);
  const trimmed = answer.trim();

  if (!trimmed) {
    return files[0];
  }

  const index = Number.parseInt(trimmed, 10);
  if (Number.isInteger(index) && index >= 1 && index <= files.length) {
    return files[index - 1];
  }

  const candidatePath = path.isAbsolute(trimmed) ? trimmed : path.join(process.cwd(), trimmed);
  if (fs.existsSync(candidatePath) && candidatePath.toLowerCase().endsWith(".pdf")) {
    return candidatePath;
  }

  console.warn("Could not resolve that path. Falling back to the first detected PDF.\n");
  return files[0];
}

async function extractPdfText(filePath) {
  const buffer = fs.readFileSync(filePath);
  const data = await pdfParse(buffer).catch((error) => {
    throw new Error(`Failed to parse PDF: ${error.message}`);
  });
  const rawText = typeof data?.text === "string" ? data.text : "";
  return cleanPlainText(rawText);
}

function buildClaimsPrompt(rawText) {
  return CLAIMS_PROMPT_TEMPLATE.replace("[PASTE RAW TEXT HERE]", rawText);
}

function normaliseStringArray(value) {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? cleanPlainText(item) : ""))
      .filter((item) => item.length > 0);
  }
  if (typeof value === "string") {
    return cleanPlainText(value)
      .split(/\r?\n|[•·]|;|\|/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
  return [];
}

function normaliseStrength(input) {
  if (typeof input !== "string") {
    return undefined;
  }
  const value = input.trim().toLowerCase();
  if (!value) {
    return undefined;
  }
  const mapping = {
    high: "High",
    moderate: "Moderate",
    medium: "Moderate",
    low: "Low",
    unclear: "Unclear",
    tentative: "Unclear"
  };
  return mapping[value] ?? undefined;
}

function normaliseRiskStatus(input) {
  if (typeof input !== "string") {
    return "unclear";
  }
  const value = input.trim().toLowerCase();
  if (["met", "partial", "missing", "unclear"].includes(value)) {
    return value;
  }
  if (value.includes("na")) {
    return "unclear";
  }
  if (value.includes("yes")) {
    return "met";
  }
  if (value.includes("no")) {
    return "missing";
  }
  return "unclear";
}

function normaliseClaimsPayload(raw) {
  if (!raw || typeof raw !== "object") {
    throw new Error("Claims payload must be an object.");
  }

  const text = typeof raw.text === "string" ? cleanPlainText(raw.text) : "";

  const structuredRaw = raw.structured && typeof raw.structured === "object" ? raw.structured : {};

  const claims = Array.isArray(structuredRaw.claims)
    ? structuredRaw.claims
        .map((entry) => {
          if (!entry || typeof entry !== "object") {
            return null;
          }
          const id = typeof entry.id === "string" && entry.id.trim().length > 0 ? entry.id.trim() : null;
          const claim = typeof entry.claim === "string" ? cleanPlainText(entry.claim) : "";
          if (!id || !claim) {
            return null;
          }
          const evidenceSummary = typeof entry.evidenceSummary === "string" ? cleanPlainText(entry.evidenceSummary) : null;
          const keyNumbers = normaliseStringArray(entry.keyNumbers);
          const source = typeof entry.source === "string" ? cleanPlainText(entry.source) : null;
          const strength = normaliseStrength(entry.strength);
          const assumptions = typeof entry.assumptions === "string" ? cleanPlainText(entry.assumptions) : null;
          const evidenceType = typeof entry.evidenceType === "string" ? cleanPlainText(entry.evidenceType) : null;
          return {
            id,
            claim,
            evidenceSummary,
            keyNumbers,
            source,
            strength,
            assumptions,
            evidenceType
          };
        })
        .filter(Boolean)
    : [];

  const gaps = Array.isArray(structuredRaw.gaps)
    ? structuredRaw.gaps
        .map((item) => {
          if (!item || typeof item !== "object") {
            return null;
          }
          const category = typeof item.category === "string" ? cleanPlainText(item.category) : null;
          const detail = typeof item.detail === "string" ? cleanPlainText(item.detail) : null;
          if (!category || !detail) {
            return null;
          }
          const relatedClaimIds = normaliseStringArray(item.relatedClaimIds);
          return { category, detail, relatedClaimIds };
        })
        .filter(Boolean)
    : [];

  const methodsSnapshot = normaliseStringArray(structuredRaw.methodsSnapshot);
  const executiveSummary = normaliseStringArray(structuredRaw.executiveSummary);
  const openQuestions = normaliseStringArray(structuredRaw.openQuestions);
  const crossPaperComparison = normaliseStringArray(structuredRaw.crossPaperComparison);

  const riskChecklist = Array.isArray(structuredRaw.riskChecklist)
    ? structuredRaw.riskChecklist
        .map((entry) => {
          if (!entry || typeof entry !== "object") {
            return null;
          }
          const item = typeof entry.item === "string" ? cleanPlainText(entry.item) : null;
          if (!item) {
            return null;
          }
          const note = typeof entry.note === "string" ? cleanPlainText(entry.note) : null;
          const status = normaliseRiskStatus(entry.status);
          return { item, status, note };
        })
        .filter(Boolean)
    : [];

  return {
    text,
    structured: {
      executiveSummary,
      claims,
      gaps,
      methodsSnapshot,
      riskChecklist,
      openQuestions,
      crossPaperComparison
    }
  };
}

const REPO_ROOT = path.join(__dirname, "..");

async function runClaimsAnalysis(options = {}) {
  const rl = createInterface();
  const {
    entryId: presetEntryId = null,
    pdfPath: presetPdfPath = null
  } = options;

  try {
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
      const pdfFiles = collectPdfFiles(process.cwd());
      const selected = await selectPdf(rl, pdfFiles);
      if (!selected) {
        console.log("\nNo PDF selected.\n");
        return { entryId: null, pdfPath: null, status: "skipped" };
      }
      pdfPath = selected;
    }

    const library = readLibrary();

    let entryId = presetEntryId;
    let isNew = false;
    let entry;

    if (entryId) {
      const existingEntry = getEntry(library, entryId);
      if (existingEntry) {
        entry = JSON.parse(JSON.stringify(existingEntry));
      } else {
        isNew = true;
        entry = { id: entryId };
      }
    } else {
      const suggestedSlug = path.basename(pdfPath, path.extname(pdfPath));
      const selection = await promptForEntrySelection({
        ask: (question) => ask(rl, question),
        library,
        allowCreate: true,
        suggestedId: suggestedSlug,
        header: "Choose which mock entry to update"
      });

      entryId = selection.entryId;
      isNew = selection.isNew;
      const existingEntry = getEntry(library, entryId);
      entry = existingEntry ? JSON.parse(JSON.stringify(existingEntry)) : { id: entryId };
    }

    const relativePdfPath = path.relative(REPO_ROOT, pdfPath);
    const publicPdfPath = copyPdfToPublic(pdfPath, entryId);

    entry.sourcePdf = {
      ...(entry.sourcePdf ?? {}),
      path: relativePdfPath,
      publicPath: publicPdfPath,
      title: entry.sourcePdf?.title ?? path.basename(pdfPath, path.extname(pdfPath)),
      originalFileName: path.basename(pdfPath)
    };

    if (!entry.label) {
      entry.label = entry.sourcePaper?.title ?? entry.sourcePdf?.title ?? entryId;
    }

    console.log(`\nExtracting text from: ${path.relative(process.cwd(), pdfPath)}`);
    const extractedText = await extractPdfText(pdfPath);
    if (!extractedText) {
      console.error("No text extracted from PDF. Aborting.");
      return { entryId, pdfPath, status: "skipped" };
    }

    const prompt = buildClaimsPrompt(extractedText);

    try {
      await copyPromptToClipboard(prompt, {
        label: "Claims prompt",
        previewLength: 320
      });
      console.log("\nPaste it into your LLM of choice.\n");
    } catch (error) {
      console.warn("Failed to copy prompt to clipboard. Printing below:\n");
      console.log(prompt);
    }

    const shouldCopyCleanup = await ask(rl, "Press ENTER to copy the cleanup prompt, or type 'print' to show it inline: ");
    if (shouldCopyCleanup.trim().toLowerCase() === "print") {
      console.log("\nCleanup prompt:\n");
      console.log(`${CLEANUP_PROMPT_HEADER}`);
    } else {
      try {
        await copyPromptToClipboard(CLEANUP_PROMPT_HEADER, {
          label: "Cleanup prompt"
        });
        console.log("\nPaste it after the LLM returns the textual summary.\n");
      } catch (error) {
        console.warn("Failed to copy cleanup prompt. Printing below:\n");
        console.log(`${CLEANUP_PROMPT_HEADER}`);
      }
    }

    const rawJson = await collectJsonInput(rl, { promptLabel: "cleanup JSON" });
    if (!rawJson) {
      console.log("\nNo JSON provided. Exiting without changes.\n");
      return { entryId, pdfPath, status: "skipped" };
    }

    let parsed;
    try {
      parsed = JSON.parse(rawJson);
    } catch (error) {
      console.error("\nFailed to parse JSON:", error.message);
      return { entryId, pdfPath, status: "skipped" };
    }

    let claimsPayload;
    try {
      claimsPayload = normaliseClaimsPayload(parsed);
    } catch (error) {
      console.error("\nInvalid claims payload:", error.message);
      return { entryId, pdfPath, status: "skipped" };
    }

    entry.generatedAt = new Date().toISOString();
    entry.claimsAnalysis = claimsPayload;

    const previousIds = library.entries.map((item) => item.id);
    upsertEntry(library, entry);
    writeLibrary(path.basename(__filename), library);

    const removedIds = previousIds.filter((id) => !library.entries.some((item) => item.id === id));
    if (isNew && removedIds.length > 0) {
      console.log(`\nNote: removed oldest mock entry (${removedIds.join(", ")}) to keep the list at ${MAX_ENTRIES}.`);
    }

    console.log(`\nSaved claims analysis to entry "${entryId}". PDF available at ${entry.sourcePdf.publicPath}.\n`);
    return { entryId, pdfPath, status: "completed" };
  } finally {
    closeInterface(rl);
  }
}

module.exports = {
  runClaimsAnalysis
};

if (require.main === module) {
  runClaimsAnalysis().catch((error) => {
    console.error("\nUnexpected error:", error);
    process.exit(1);
  });
}
