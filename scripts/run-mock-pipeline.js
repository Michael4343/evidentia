#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const {
  createInterface,
  closeInterface,
  ask
} = require("./mock-cli-utils");
const {
  readLibrary,
  ensureUniqueEntryId,
  slugify
} = require("./mock-library-utils");
const { runClaimsAnalysis } = require("./generate-claims-analysis");
const { runSimilarPapers } = require("./generate-similar-papers");
const { runResearchGroups } = require("./generate-research-groups");
const { runResearcherTheses } = require("./generate-researcher-theses");
const { runPatents } = require("./generate-patents");
const { runVerifiedClaims } = require("./generate-verified-claims");
const { runResearcherThesesDeepDive } = require("./researcher-theses-deep-dive");

const REPO_ROOT = path.join(__dirname, "..");
const MAX_LISTED_PDFS = 40;
const MAX_SCAN_DEPTH = 3;
const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "out",
  "dist",
  "build",
  "tmp",
  "temp",
  "public"
]);

const PIPELINE_STAGES = [
  {
    id: "claims",
    label: "Claims analysis",
    run: runClaimsAnalysis,
    usesPdf: true
  },
  {
    id: "similar",
    label: "Similar papers",
    run: runSimilarPapers,
    usesPdf: true
  },
  {
    id: "research-groups",
    label: "Research groups",
    run: runResearchGroups,
    usesPdf: true
  },
  {
    id: "researcher-theses",
    label: "Researcher theses",
    run: runResearcherTheses
  },
  {
    id: "patents",
    label: "Patents",
    run: runPatents
  },
  {
    id: "verified-claims",
    label: "Verified claims",
    run: runVerifiedClaims
  }
];

const OPTIONAL_STAGE = {
  id: "thesis-deep-dive",
  label: "Researcher thesis deep dive",
  run: runResearcherThesesDeepDive
};

function normaliseNumberInput(value, fallback) {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }
  return parsed;
}

async function promptYesNo(rl, question, defaultValue = false) {
  const suffix = defaultValue ? "[Y/n]" : "[y/N]";
  while (true) {
    const answer = await ask(rl, `${question} ${suffix} `);
    const trimmed = answer.trim().toLowerCase();
    if (!trimmed) {
      return defaultValue;
    }
    if (["y", "yes"].includes(trimmed)) {
      return true;
    }
    if (["n", "no"].includes(trimmed)) {
      return false;
    }
    console.log("Please answer with 'y' or 'n'.");
  }
}

function printStageList(stages) {
  console.log("Pipeline stages:");
  stages.forEach((stage, index) => {
    console.log(`  ${index + 1}. ${stage.label}`);
  });
}

function findPdfFiles(rootDir, depth = 0, results = []) {
  if (depth > MAX_SCAN_DEPTH || results.length >= MAX_LISTED_PDFS) {
    return results;
  }

  let entries = [];
  try {
    entries = fs.readdirSync(rootDir, { withFileTypes: true });
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

    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        findPdfFiles(fullPath, depth + 1, results);
      }
      continue;
    }

    if (entry.isFile() && entry.name.toLowerCase().endsWith(".pdf")) {
      results.push({
        relative: path.relative(REPO_ROOT, fullPath) || entry.name,
        absolute: fullPath
      });
    }
  }

  return results;
}

async function promptForPdfPath(rl) {
  const workingDir = process.cwd();
  const pdfFiles = findPdfFiles(workingDir);

  if (pdfFiles.length > 0) {
    console.log(`\nFound ${pdfFiles.length} PDF${pdfFiles.length === 1 ? "" : "s"} within ${path.basename(workingDir) || "."}:`);
    pdfFiles.slice(0, MAX_LISTED_PDFS).forEach((file, index) => {
      console.log(`  [${index + 1}] ${file.relative}`);
    });
    console.log("  [0] Enter a custom path");

    while (true) {
      const answer = await ask(rl, "Select a PDF by number: ");
      const trimmed = answer.trim();
      if (!trimmed) {
        continue;
      }
      if (/^\d+$/.test(trimmed)) {
        const number = Number.parseInt(trimmed, 10);
        if (number === 0) {
          break;
        }
        if (number >= 1 && number <= pdfFiles.length) {
          return pdfFiles[number - 1].absolute;
        }
      }
      console.log("Invalid selection. Try again.");
    }
  }

  while (true) {
    const manual = await ask(rl, "Enter the path to a PDF: ");
    const resolved = path.resolve(workingDir, manual.trim());
    if (fs.existsSync(resolved) && resolved.toLowerCase().endsWith(".pdf")) {
      return resolved;
    }
    console.log("Could not find that PDF. Please try again.");
  }
}

function resolveEntryIdForPdf(library, pdfPath) {
  const entries = Array.isArray(library?.entries) ? library.entries : [];
  const normalisedPdf = path.normalize(pdfPath);

  const matchByPath = entries.find((entry) => {
    const storedPath = entry?.sourcePdf?.path;
    if (typeof storedPath !== "string" || !storedPath.trim()) {
      return false;
    }
    const absoluteStored = path.normalize(path.join(REPO_ROOT, storedPath));
    return absoluteStored === normalisedPdf;
  });
  if (matchByPath) {
    return { entryId: matchByPath.id, isNew: false };
  }

  const fileName = path.basename(pdfPath).toLowerCase();
  const matchByOriginal = entries.find((entry) => {
    const original = entry?.sourcePdf?.originalFileName;
    return typeof original === "string" && original.toLowerCase() === fileName;
  });
  if (matchByOriginal) {
    return { entryId: matchByOriginal.id, isNew: false };
  }

  const baseSlug = slugify(path.basename(pdfPath, path.extname(pdfPath)));
  const entryId = ensureUniqueEntryId(library, baseSlug);
  return { entryId, isNew: true };
}

async function runPipeline() {
  const rl = createInterface();
  try {
    console.log("\n=== Mock Data Pipeline ===\n");

    const pdfPath = await promptForPdfPath(rl);
    console.log(`\nUsing PDF: ${pdfPath}`);

    const library = readLibrary();
    const { entryId, isNew } = resolveEntryIdForPdf(library, pdfPath);
    if (isNew) {
      console.log(`\nCreating a new mock entry for ${path.basename(pdfPath)} (id: ${entryId}).`);
    } else {
      console.log(`\nUpdating existing mock entry "${entryId}".`);
    }

    const stages = [...PIPELINE_STAGES];
    const includeDeepDive = await promptYesNo(rl, "Include the thesis deep-dive stage?", false);
    if (includeDeepDive) {
      stages.push(OPTIONAL_STAGE);
    }

    printStageList(stages);
    const startAnswer = await ask(
      rl,
      "\nEnter the number of the stage to start at (press ENTER to run from the beginning, 0 to cancel): "
    );
    const startIndexRaw = normaliseNumberInput(startAnswer, 1);
    if (startIndexRaw === 0) {
      console.log("\nPipeline cancelled.\n");
      return;
    }

    const startIndex = Math.max(1, Math.min(stages.length, startIndexRaw));

    const context = {
      entryId,
      pdfPath
    };

    for (let index = startIndex - 1; index < stages.length; index += 1) {
      const stage = stages[index];
      console.log(`\n→ Stage ${index + 1}/${stages.length}: ${stage.label}\n`);

      const options = {};
      options.entryId = context.entryId;
      if (stage.usesPdf) {
        options.pdfPath = context.pdfPath;
      }

      try {
        const result = await stage.run(options);
        if (!result || result.status !== "completed") {
          console.log(
            `\nStopping: ${stage.label} did not complete successfully (status: ${result?.status ?? "unknown"}).`
          );
          return;
        }
        if (result.entryId) {
          context.entryId = result.entryId;
        }
        if (result.pdfPath) {
          context.pdfPath = path.resolve(result.pdfPath);
        }
      } catch (error) {
        console.error(`\nStage \"${stage.label}\" failed:`, error instanceof Error ? error.message : error);
        throw error;
      }
    }

    console.log("\n✅ Pipeline completed. Your landing page mocks are up to date.\n");
  } finally {
    closeInterface(rl);
  }
}

if (require.main === module) {
  runPipeline().catch(() => {
    process.exitCode = 1;
  });
}

module.exports = {
  runPipeline
};
