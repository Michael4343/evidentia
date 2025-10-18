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

function buildResearchPrompt(paper) {
  const title = paper.title && paper.title.trim().length > 0 ? paper.title.trim() : "Unknown title";
  const doiOrId =
    (paper.doi && paper.doi.trim()) ||
    (paper.scraped_url && paper.scraped_url.trim()) ||
    (paper.url && paper.url.trim()) ||
    "Not provided";
  const authors = formatAuthors(paper.authors);
  const abstractLine =
    paper.abstract && paper.abstract.trim().length > 0
      ? `- Optional: Abstract: ${paper.abstract.trim()}`
      : "- Optional: Abstract: not provided";

  return [
    "You are building a Similar Papers crosswalk for Evidentia. Focus entirely on method-level overlap and actionable signals that help a founder understand how related teams ran comparable work. Use concise, plain English.",
    "",
    "Inputs",
    `- Title: ${title}`,
    `- DOI or ID: ${doiOrId}`,
    `- Authors: ${authors}`,
    abstractLine,
    "",
    "Deliverables",
    "- Summarise the source paper's methods (2-3 sentences) so a teammate can brief founders quickly.",
    "- Surface 5-10 high-signal similar papers. Method overlap beats topical similarity.",
    "",
    "Search playbook",
    "- Derive neutral method terms from the PDF (sample model, preparation steps, equipment classes, control style, readout type, QC practices).",
    "- Generate 4-6 diversified search queries mixing those terms with synonyms (e.g., \"aggregates micro-CT stable isotope probing\").",
    "- Prioritise papers that:",
    '  - Describe materials, equipment, controls, readouts, and QC steps clearly',
    '  - Provide supplementary protocols, data, or code',
    '  - Are accessible via arXiv, publisher OA versions, or lab websites',
    "- Keep language plain; avoid jargon unless it is unavoidable (then explain it).",
    "",
    "For each selected paper (5-10 total):",
    "- identifier: DOI, Semantic Scholar ID, or other stable handle.",
    "- whyRelevant: 2-3 sentences explaining the method overlap and what a founder should copy or avoid.",
    "- Include 3-4 concise bullet fragments naming concrete overlaps (e.g., 'Micro-CT pore segmentation', '13C glucose SIP').",
    "- methodMatrix: fill every field; if a point is missing, return 'not reported'.",
    "- clusterLabel: choose “Sample and model”, “Field deployments”, or “Insight primers” and explain the reasoning in whyRelevant.",
    "",
    "Answer with a concise narrative that a cleanup agent can later structure into JSON. Do not format as JSON yourself.",
    "Highlight the key method signals for the source paper (3-5 bullet points).",
    "For each similar paper (5-10 total) write 2-3 sentences explaining the method overlap, note the cluster label rationale, list 3 short overlap bullets, and quote any concrete gaps or uncertainties.",
    "Stay within ~1,800 tokens overall; be specific but efficient.",
    "",
    "Return the narrative summary now."
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
  const banner = `// Auto-generated by scripts/generate-similar-papers.js on ${new Date().toISOString()}\n`;
  const warning = "// Do not edit by hand. Re-run the script with updated inputs.";
  const fileContents = `${banner}${warning}\n\nexport const MOCK_SIMILAR_PAPERS_LIBRARY = ${JSON.stringify(libraryData, null, 2)} as const;\n`;
  fs.writeFileSync(outputPath, fileContents, "utf-8");
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
  console.log("\nPaste the agent JSON now. Type END on a new line when finished.");
  console.log("Press ENTER immediately to skip when you don't have output yet.\n");

  const lines = [];
  while (true) {
    const line = await ask(rl, "> ");
    if (lines.length === 0 && !line.trim()) {
      return "";
    }
    if (line.trim().toUpperCase() === "END") {
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

  const basePrompt = buildResearchPrompt(paper);
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

    const { prompt, context } = await buildPromptFromPdf(pdfPath);

    await clipboardy.write(prompt);

    console.log("\nPrompt copied to your clipboard. Paste it into the deep research agent to run the Similar Papers pass.\n");
    if (context.truncated) {
      console.log(`Note: extracted text was clipped to ${MAX_INPUT_CHARS.toLocaleString()} characters to match the API limit.`);
    }
    console.log("Preview:");
    console.log(`${prompt.slice(0, 240)}${prompt.length > 240 ? "…" : ""}`);
    console.log("\nNext steps:\n  1. Paste the copied prompt into your deep research agent.\n  2. Wait for the JSON response.\n  3. Paste the JSON back here (type END to finish).\n");

    const agentRaw = await collectAgentJson(rl);
    if (!agentRaw) {
      console.log("No agent JSON provided. Landing page mock left unchanged.");
      return;
    }

    let agentPayload;
    try {
      agentPayload = JSON.parse(agentRaw);
    } catch (error) {
      throw new Error(`Failed to parse agent JSON: ${error.message}`);
    }

    const cleanPayload = sanitiseAgentPayload(agentPayload);

    const sourcePaperData = { ...cleanPayload.sourcePaper };
    if (Array.isArray(sourcePaperData?.keyMethods) || sourcePaperData?.keyMethods === null) {
      delete sourcePaperData.keyMethods;
    }

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
        promptNotes: cleanPayload.promptNotes
      },
      sourcePaper: sourcePaperData,
      similarPapers: cleanPayload.similarPapers
    };

    writeMockLibrary(path.resolve(workingDir, DEFAULT_OUTPUT_PATH), libraryData);

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
