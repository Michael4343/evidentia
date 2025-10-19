#!/usr/bin/env node

/**
 * Prototype helper that prepares the claims & gaps prompt for the homepage mock.
 *
 * Usage:
 *   node scripts/generate-claims-analysis.js
 */

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const clipboardModule = require("clipboardy");
const clipboardy = clipboardModule?.default ?? clipboardModule;
const pdfParse = require("pdf-parse");

const DEFAULT_OUTPUT_PATH = path.join(__dirname, "../lib/mock-similar-papers.ts");
const MAX_SCAN_DEPTH = 3;
const MAX_LISTED_PDFS = 40;
const IGNORED_DIRS = new Set(["node_modules", ".git", ".next", "out", "dist", "build", "tmp", "temp", "public"]);

const CLAIMS_PROMPT_TEMPLATE = `Objective: Produce a rigorous yet concise text-only summary of a scientific paper that clearly states the paper’s claims, the supporting evidence for each claim, and the gaps or limitations.

Context: You will receive raw text extracted from one or more scientific publication PDFs. Work strictly from this text (no external sources). If multiple papers are present, analyse each separately and add a brief cross-paper comparison.

Audience and Tone: Research analysts and domain experts. Tone: neutral, precise, evidence-centred, and concise.

Inputs:

Raw PDF text: [PASTE RAW TEXT HERE]

Optional metadata: [PAPER TITLE], [AUTHORS], [VENUE], [YEAR], [DOI/URL], [DISCIPLINE/DOMAIN], [TARGET AUDIENCE]

Optional scope constraints: [SECTIONS TO FOCUS ON], [MAX CLAIMS], [WORD LIMIT], [INCLUSION/EXCLUSION CRITERIA]

Optional rubric or definitions: [EVIDENCE STRENGTH RUBRIC], [CLAIM TYPES], [KEY OUTCOMES]

Constraints:

Text-only output (no JSON in this step).

Use Australian spelling and DD/MM/YYYY dates.

Base all findings strictly on the provided text; do not infer beyond it or browse externally.

Attribute every claim and evidence item to page/section/figure/table references where available.

Quote snippets ≤30 words; otherwise paraphrase faithfully.

Extract numerical results exactly as written (effect sizes, CIs, p-values, N, timeframes); round only if specified [ROUNDING RULES or 2 s.f.].

Flag OCR artefacts or ambiguities with [UNCLEAR] and state assumptions explicitly.

Prioritise concision and clarity; keep the full summary ≤[WORD LIMIT, e.g., 600–900 words].

Tools/Data:

Provided raw PDF text and optional metadata only.

If headings exist, segment by: Abstract, Introduction, Methods, Results, Discussion, Limitations, Conclusion, References.

Output Format:

Executive Summary (≤10 bullet points or ≤200 words): main claims, headline numbers, and overall evidence strength (High/Moderate/Low).

Key Claims and Evidence (bulleted list):

Claim ID: C1, C2, …

Claim (one sentence).

Evidence summary (design, sample, measures, analysis).

Key numbers (effect size, CI, p, N, timeframe).

Source location (page/section/figure/table).

Strength rating (High/Moderate/Low) and key assumptions/conditions.

Gaps & Limitations (categorised): data gaps, methodological weaknesses, external validity, unresolved confounders, missing comparisons, contradictions—link each to relevant Claim IDs.

Methods Snapshot (3–6 bullets): study design, sample, measures, analysis approach, preregistration/ethics [DETAIL NEEDED if absent].

Risk-of-Bias/Quality Checklist (tick/short notes): sampling, randomisation, blinding, missing data handling, multiplicity, selective reporting.

Open Questions & Next Steps (3–6 bullets): specific, testable follow-ups implied by the paper.

Cross-Paper Comparison (only if multiple papers): 3–5 bullets on points of agreement, divergence, and evidence quality.

Steps or Acceptance Criteria:

Parse and segment the raw text; note missing sections explicitly.

Extract distinct, testable claims; if >[MAX CLAIMS], prioritise the top [MAX CLAIMS] by centrality (presence in abstract/conclusion, frequency, emphasis) and list the remainder briefly.

For each claim, locate and summarise direct supporting evidence with precise source locations and key numbers.

Classify evidence type (e.g., RCT, observational, simulation, qualitative, prior work) and rate strength using a transparent rubric:

High: appropriate design, adequate N, consistent results, clear statistics.

Moderate: some limitations (e.g., small N, partial controls).

Low: anecdotal/speculative or weakly supported.

Identify gaps/limitations and tie them to affected Claim IDs.

Provide a concise methods snapshot and risk-of-bias checklist based only on stated details.

Ensure concision and coherence: no redundant text; all claims have strength ratings and location references or [DETAIL NEEDED] if absent.

Final QA: all required sections present; numbers match the text exactly; all quotes ≤30 words; all claims tie back to the supplied text.
`;

const CLEANUP_PROMPT_HEADER = `You are a cleanup agent. Convert the analyst's claims summary into strict JSON for Evidentia's claims UI.

Output requirements:
- Return a single JSON object with keys: text (string), structured (object), promptNotes (optional string).
- text must reproduce the analyst's formatted summary exactly (including headings and bullet markers). Replace every newline with \n and escape embedded double quotes with \" so the string parses in JSON.
- structured.executiveSummary: array of strings (each one bullet).
- structured.claims: array of objects with keys { id, claim, evidenceSummary, keyNumbers (array of strings), source, strength, assumptions, evidenceType }.
  - strength must be one of "High", "Moderate", "Low", "Unclear".
  - Use empty arrays for missing keyNumbers; use null for unknown scalars.
- structured.gaps: array of objects { category, detail, relatedClaimIds (array of strings) }.
- structured.methodsSnapshot: array of strings.
- structured.riskChecklist: array of objects { item, status, note }. Status must be one of "met", "partial", "missing", "unclear" (lowercase).
- structured.openQuestions: array of strings.
- structured.crossPaperComparison: array of strings (omit when not applicable).
- Output raw JSON only — no markdown fences, comments, trailing prose, or extra keys. Validate the payload with JSON.parse before responding.
- Preserve factual content; do not invent new claims or numbers. When details are missing, use placeholders like "[DETAIL NEEDED]" exactly as written.
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

async function collectCleanedJson(rl) {
  console.log("\nPaste the cleaned JSON (or press ENTER to skip). Type END on a new line when finished.\n");
  const lines = [];
  while (true) {
    const line = await ask(rl, "> ");
    if (line.trim().toUpperCase() === "END") {
      break;
    }
    if (line.trim().length === 0) {
      if (lines.length === 0) {
        return "";
      }
      break;
    }
    lines.push(line);
  }
  return lines.join("\n").trim();
}

async function main() {
  const rl = createInterface();

  const pdfFiles = collectPdfFiles(process.cwd());
  const selected = await selectPdf(rl, pdfFiles);
  if (!selected) {
    rl.close();
    return;
  }

  console.log(`\nExtracting text from: ${path.relative(process.cwd(), selected)}`);
  const extractedText = await extractPdfText(selected);
  if (!extractedText) {
    console.error("No text extracted from PDF. Aborting.");
    rl.close();
    return;
  }

  const prompt = buildClaimsPrompt(extractedText);

  try {
    await clipboardy.write(prompt);
    console.log("\nClaims prompt copied to clipboard. Paste it into your LLM of choice.\n");
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
      await clipboardy.write(CLEANUP_PROMPT_HEADER);
      console.log("\nCleanup prompt copied to clipboard. Paste it after the LLM returns the textual summary.\n");
    } catch (error) {
      console.warn("Failed to copy cleanup prompt. Printing below:\n");
      console.log(`${CLEANUP_PROMPT_HEADER}`);
    }
  }

  const rawJson = await collectCleanedJson(rl);
  rl.close();

  if (!rawJson) {
    console.log("\nNo JSON provided. Exiting without changes.\n");
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(rawJson);
  } catch (error) {
    console.error("\nFailed to parse JSON:", error.message);
    return;
  }

  let claimsPayload;
  try {
    claimsPayload = normaliseClaimsPayload(parsed);
  } catch (error) {
    console.error("\nInvalid claims payload:", error.message);
    return;
  }

  const existing = readExistingLibrary(DEFAULT_OUTPUT_PATH) ?? {};
  const updatedLibrary = {
    ...existing,
    generatedAt: new Date().toISOString(),
    claimsAnalysis: claimsPayload
  };

  writeMockLibrary(DEFAULT_OUTPUT_PATH, updatedLibrary);
  console.log("\nUpdated lib/mock-similar-papers.ts with the new claims analysis.\n");
}

main().catch((error) => {
  console.error("\nUnexpected error:", error);
  process.exit(1);
});
