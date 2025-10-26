#!/usr/bin/env node

/**
 * Interactive helper for generating Research Groups narratives.
 *
 * Usage:
 *   node scripts/generate-research-groups.js
 */

const fs = require("fs");
const path = require("path");
const { cleanUrlStrict } = require("../lib/clean-url-strict.js");
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
const REPO_ROOT = path.join(__dirname, "..");

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

async function promptYesNo(rl, question, { defaultValue = true } = {}) {
  const suffix = defaultValue ? "[Y/n]" : "[y/N]";
  while (true) {
    const answer = await ask(rl, `${question} ${suffix} `);
    const trimmed = answer.trim().toLowerCase();
    if (!trimmed) {
      return defaultValue;
    }
    if (trimmed === "y" || trimmed === "yes") {
      return true;
    }
    if (trimmed === "n" || trimmed === "no") {
      return false;
    }
    console.log("Please answer with 'y' or 'n'.");
  }
}

const CLEANUP_PROMPT_HEADER = `You are a cleanup agent. Convert the analyst's notes into strict JSON for Evidentia's Author Contacts UI.

Output requirements:
- Return a single JSON object with keys: papers (array), promptNotes (optional string).
- Each paper object must include: title (string), identifier (string|null), authors (array of up to 3 objects).
- Each author object must include: name (string), email (string|null), role (string|null), orcid (string|null), profiles (array).
- Each profile object must include: platform (string), url (string).
- Use null for unknown scalars.
- For ORCID: use format "0000-0000-0000-0000" or null if not found. Do not use "Not found" - use null instead.
- For profiles: only include profiles that have actual URLs. Common platforms: "Google Scholar", "LinkedIn", "Personal Website", "ResearchGate", "Twitter".
- No markdown, no commentary, no trailing prose. Ensure valid JSON (double quotes only).
- Preserve factual content; do not invent new people or emails.
- Each paper should have up to 3 authors (the first 3 from the author list, or fewer if the paper has <3 authors).
Before responding, you must paste the analyst notes after these instructions so you can structure them. Use them verbatim; do not add new facts.
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

  value = value.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, (match, label, url) => `${label} (${url})`);
  value = value.replace(/\[(\d+|[a-zA-Z]+)\]/g, " $1");

  value = value
    .split("\n")
    .map((line) => line.trim())
    .filter((line, index, lines) => line.length > 0 || (index > 0 && lines[index - 1].length > 0))
    .join("\n");

  return value.trim();
}


function cleanEmail(input) {
  if (typeof input !== "string") {
    return input;
  }

  let value = input.trim();
  if (!value) {
    return "";
  }

  // Extract from markdown mailto link: [email](mailto:email)
  const mailtoMatch = value.match(/\[([^\]]+)\]\(mailto:([^)]+)\)/);
  if (mailtoMatch) {
    return mailtoMatch[1].trim().toLowerCase();
  }

  // Extract from plain mailto: mailto:email
  const plainMailtoMatch = value.match(/mailto:([^\s)]+)/);
  if (plainMailtoMatch) {
    return plainMailtoMatch[1].trim().toLowerCase();
  }

  // Extract from markdown link without mailto: [email](email)
  const markdownMatch = value.match(/\[([^\]]+)\]\([^)]+\)/);
  if (markdownMatch) {
    const extracted = markdownMatch[1].trim();
    if (extracted.includes("@")) {
      return extracted.toLowerCase();
    }
  }

  // Clean up any remaining markdown brackets and quotes
  value = value.replace(/["')\]\[]+$/g, "").replace(/^["'(\[]+/g, "");

  return value.trim().toLowerCase();
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

function buildDiscoveryPrompt(library) {
  const sourceTitle = cleanPlainText(
    library?.sourcePaper?.title || library?.sourcePdf?.title || "Unknown title"
  );
  const sourceDoi = library?.sourcePaper?.doi || null;
  const sourceAuthors = Array.isArray(library?.sourcePaper?.authors) && library.sourcePaper.authors.length
    ? library.sourcePaper.authors.map((author) => cleanPlainText(author))
    : [];
  const similarPapers = Array.isArray(library?.similarPapers)
    ? library.similarPapers.slice(0, 5)
    : [];

  const lines = [
    "Objective: For EACH paper below (source + similar papers), gather comprehensive contact information for the FIRST 3 AUTHORS listed on that paper.",
    "",
    "Context: You're building a collaboration pipeline for research analysts. For each paper, identify the first 3 authors (or all authors if fewer than 3) and find their complete contact details.",
    "",
    "Audience: Research analysts building collaboration pipelines.",
    "",
    "Papers to analyze:",
    ""
  ];

  // Add source paper
  lines.push("1. SOURCE PAPER:");
  lines.push(`   Title: ${sourceTitle}`);
  if (sourceDoi) {
    lines.push(`   DOI: ${sourceDoi}`);
  }
  if (sourceAuthors.length) {
    lines.push("   Authors (in order):");
    sourceAuthors.forEach((author, idx) => {
      lines.push(`     ${idx + 1}. ${author}`);
    });
  } else {
    lines.push("   Authors: Not specified");
  }
  lines.push("");

  // Add similar papers
  if (similarPapers.length) {
    similarPapers.forEach((paper, index) => {
      const title = cleanPlainText(paper?.title || `Paper ${index + 1}`);
      const venue = cleanPlainText(paper?.venue || "Venue not reported");
      const year = paper?.year ? `${paper.year}` : "Year not reported";
      const authors = Array.isArray(paper?.authors) && paper.authors.length
        ? paper.authors.map((author) => cleanPlainText(author))
        : [];
      const doi = paper?.doi ? `DOI: ${paper.doi}` : paper?.url ? `URL: ${paper.url}` : "No identifier";

      lines.push(`${index + 2}. SIMILAR PAPER ${index + 1}:`);
      lines.push(`   Title: ${title}`);
      lines.push(`   Venue: ${venue} (${year})`);
      lines.push(`   Identifier: ${doi}`);
      if (authors.length) {
        lines.push("   Authors (in order):");
        authors.forEach((author, idx) => {
          lines.push(`     ${idx + 1}. ${author}`);
        });
      } else {
        lines.push("   Authors: Not reported");
      }
      lines.push("");
    });
  }

  lines.push(
    "Task:",
    "",
    "For each paper:",
    "1. Take the FIRST 3 AUTHORS from the author list (or all if fewer than 3)",
    "2. For each author, gather comprehensive contact information:",
    "   - Full name (as listed on the paper)",
    "   - Institutional email (search university directories, lab pages)",
    "   - Current role/position (PI, Professor, Postdoc, PhD Student, etc.)",
    "   - ORCID identifier (search orcid.org by author name)",
    "   - Academic profiles (Google Scholar, LinkedIn, personal website)",
    "",
    "Search methodology:",
    "",
    "1. Search each author's name on ORCID.org to find their unique identifier",
    "2. Search Google Scholar for author's academic profile",
    "3. Search LinkedIn for professional profile",
    "4. Search university/institution directories for institutional email",
    "5. Check if author has a personal website or lab page",
    "6. Determine current role/position from recent affiliations",
    "",
    "Output Format:",
    "",
    "Paper 1: <Source Paper Title> (<Identifier or 'Source'>)",
    "",
    "Author 1: <Full Name>",
    "  Email: <institutional.email@university.edu or 'Not found'>",
    "  Role: <Current Position or 'Not found'>",
    "  ORCID: <0000-0000-0000-0000 or 'Not found'>",
    "  Profiles:",
    "    - Google Scholar: <URL or 'Not found'>",
    "    - LinkedIn: <URL or 'Not found'>",
    "    - Website: <URL or 'Not found'>",
    "",
    "Author 2: <Full Name>",
    "  Email: <email or 'Not found'>",
    "  Role: <role or 'Not found'>",
    "  ORCID: <ID or 'Not found'>",
    "  Profiles:",
    "    - Google Scholar: <URL or 'Not found'>",
    "    - LinkedIn: <URL or 'Not found'>",
    "",
    "Author 3: <Full Name>",
    "  Email: <email or 'Not found'>",
    "  Role: <role or 'Not found'>",
    "  ORCID: <ID or 'Not found'>",
    "  Profiles:",
    "    - Google Scholar: <URL or 'Not found'>",
    "",
    "[If paper has <3 authors, include only those available]",
    "",
    "Paper 2: <Similar Paper 1 Title> (<Identifier>)",
    "",
    "Author 1: ...",
    "Author 2: ...",
    "Author 3: ...",
    "",
    "[Repeat for all papers]",
    "",
    "Important:",
    "- Execute all searches automatically without asking",
    "- Use 'Not found' when information genuinely can't be located after thorough search",
    "- ORCID format: 0000-0000-0000-0000 (16 digits with hyphens)",
    "- Only include profiles that are publicly accessible",
    "- For each paper, include the first 3 authors (or all if <3)",
    "- Prioritize institutional emails over personal emails"
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

async function collectCleanedJson(rl) {
  return collectJsonInput(rl, { promptLabel: "cleaned JSON" });
}

function normaliseResearcher(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const name = cleanPlainText(entry.name || "");
  if (!name) {
    return null;
  }

  const emailRaw = typeof entry.email === "string" ? cleanEmail(entry.email) : "";
  const email = emailRaw && emailRaw.length > 0 ? emailRaw : null;
  const role = entry.role ? cleanPlainText(entry.role) : null;

  // Handle ORCID
  const orcid = entry.orcid && typeof entry.orcid === "string"
    ? cleanPlainText(entry.orcid)
    : null;

  // Handle profiles array
  const profiles = Array.isArray(entry.profiles)
    ? entry.profiles
        .filter((profile) => profile && typeof profile === "object")
        .map((profile) => {
          const platform = profile.platform ? cleanPlainText(profile.platform) : null;
          const url = profile.url ? cleanUrlStrict(profile.url) : null;

          if (!platform || !url) {
            return null;
          }

          return { platform, url };
        })
        .filter(Boolean)
    : [];

  return {
    name,
    email,
    role: role && role.length > 0 ? role : null,
    orcid: orcid && orcid.length > 0 ? orcid : null,
    profiles
  };
}

function normalisePaper(entry) {
  if (!entry || typeof entry !== "object") {
    throw new Error("Each paper entry must be an object.");
  }

  const title = cleanPlainText(entry.title || "");
  if (!title) {
    throw new Error("Paper title is required.");
  }

  const identifier = entry.identifier ? cleanPlainText(entry.identifier) : null;
  const authors = Array.isArray(entry.authors)
    ? entry.authors
        .map((author) => normaliseResearcher(author))
        .filter(Boolean)
    : [];

  return {
    title,
    identifier: identifier && identifier.length > 0 ? identifier : null,
    authors
  };
}

function normaliseResearchGroupsPayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Cleanup agent response must be a JSON object.");
  }

  if (!Array.isArray(payload.papers) || payload.papers.length === 0) {
    throw new Error("papers must be a non-empty array.");
  }

  const papers = payload.papers.map((paper) => normalisePaper(paper));
  const promptNotes = typeof payload.promptNotes === "string" ? cleanPlainText(payload.promptNotes) : "";

  return {
    papers,
    promptNotes
  };
}

function formatResearchGroups(papers) {
  return papers
    .map((paper) => {
      const header = [`Paper: ${paper.title}${paper.identifier ? ` (${paper.identifier})` : ""}`];

      if (!paper.authors || paper.authors.length === 0) {
        return `${header.join("\n")}\nNo author contacts found`;
      }

      const tableLines = ["| Name | Email | Role | ORCID |", "| --- | --- | --- | --- |"];
      paper.authors.forEach((author) => {
        const email = author.email || "Not found";
        const role = author.role || "Not found";
        const orcid = author.orcid || "Not found";
        tableLines.push(`| ${author.name} | ${email} | ${role} | ${orcid} |`);
      });

      return `${header.join("\n")}\n${tableLines.join("\n")}`;
    })
    .join("\n\n");
}

async function runResearchGroups(options = {}) {
  const rl = createInterface();
  const workingDir = process.cwd();
  const {
    entryId: presetEntryId = null,
    pdfPath: presetPdfPath = null
  } = options;

  try {
    console.log("\n=== Author Contacts Generator ===\n");
    console.log(`Working directory: ${workingDir}`);

    const library = readLibrary();
    if (!library.entries.length) {
      console.error("\n❌ No existing mock library found. Run the Similar Papers generator first.");
      return { entryId: null, pdfPath: null, status: "skipped" };
    }

    let entryId = presetEntryId;
    if (!entryId) {
      const selection = await promptForEntrySelection({
        ask: (question) => ask(rl, question),
        library,
        allowCreate: false,
        header: "Select the mock entry for author contacts generation"
      });
      entryId = selection.entryId;
    }

    CURRENT_LIBRARY = library;
    CURRENT_ENTRY_ID = entryId;

    let existingLibrary = getEntry(library, entryId);
    if (!existingLibrary) {
      console.error(`\n❌ Entry "${entryId}" not found.`);
      return { entryId, pdfPath: null, status: "skipped" };
    }
    existingLibrary = JSON.parse(JSON.stringify(existingLibrary));

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
      const storedPath = existingLibrary?.sourcePdf?.path;
      if (typeof storedPath === "string" && storedPath.trim().length > 0) {
        const candidate = path.resolve(REPO_ROOT, storedPath);
        if (fs.existsSync(candidate)) {
          const relativeCandidate = path.relative(process.cwd(), candidate);
          const useStored = await promptYesNo(rl, `Use the PDF saved with this mock (${relativeCandidate})?`, {
            defaultValue: true
          });
          if (useStored) {
            pdfPath = candidate;
          }
        }
      }
    }

    if (!pdfPath) {
      pdfPath = await promptForPdfPath(rl, workingDir);
      if (!pdfPath) {
        console.log("\nNo PDF selected.\n");
        return { entryId, pdfPath: null, status: "skipped" };
      }
    }

    console.log(`\nUsing PDF: ${pdfPath}`);

    // Step 1: Discovery + Contact Gathering - Find first 3 authors per paper and get their details
    const discoveryPrompt = buildDiscoveryPrompt(existingLibrary);
    try {
      await copyPromptToClipboard(discoveryPrompt, {
        label: "Discovery + Contact Gathering prompt (Step 1/2)"
      });
    } catch (error) {
      console.warn("Failed to copy discovery prompt. Printing below:\n");
      console.log(discoveryPrompt);
    }

    console.log("\n=== STEP 1: Find First 3 Authors + Gather Contacts ===\n");
    console.log("The discovery prompt has been copied to your clipboard.\n");
    console.log(
      "Next steps:\n  1. Paste the prompt into your deep research agent.\n  2. Wait for the agent to find the first 3 authors for each paper and gather their contact details.\n  3. Press ENTER here when you're ready for the cleanup prompt.\n"
    );

    await ask(rl, "\nPress ENTER once you have all author contact details: ");

    // Step 2: Cleanup - Convert to structured JSON
    const cleanupPrompt = buildCleanupPrompt();
    try {
      await copyPromptToClipboard(cleanupPrompt, {
        label: "Cleanup prompt (Step 2/2)"
      });
    } catch (error) {
      console.warn("Failed to copy cleanup prompt. Printing below:\n");
      console.log(cleanupPrompt);
    }

    console.log("\n=== STEP 2: Cleanup - Convert to JSON ===\n");
    console.log("The cleanup prompt has been copied to your clipboard.\n");
    console.log(
      "Next steps:\n  1. Paste the cleanup prompt into your LLM.\n  2. Copy all notes from Step 1 and paste them below the cleanup prompt.\n  3. Request JSON output.\n  4. Paste the cleaned JSON back here (press ENTER on an empty line when finished).\n"
    );

    const cleanedJsonRaw = await collectCleanedJson(rl);

    if (!cleanedJsonRaw) {
      console.log("No cleaned JSON provided. Mock library left unchanged.");
      return { entryId: CURRENT_ENTRY_ID, pdfPath, status: "skipped" };
    }

    let cleanedPayload;
    try {
      cleanedPayload = JSON.parse(cleanedJsonRaw);
    } catch (error) {
      console.error("\n❌ Failed to parse the Author Contacts JSON. Ensure the cleanup agent returns valid JSON only.");
      console.error("Raw snippet preview:");
      console.error(cleanedJsonRaw.slice(0, 200));
      throw new Error(`Failed to parse author contacts JSON: ${error instanceof Error ? error.message : String(error)}`);
    }

    const normalised = normaliseResearchGroupsPayload(cleanedPayload);
    const formattedText = formatResearchGroups(normalised.papers);

    const authorContactsData = {
      maxChars: formattedText.length,
      truncated: false,
      text: formattedText,
      structured: {
        papers: normalised.papers,
        promptNotes: normalised.promptNotes
      }
    };

    const relativePdfPath = path.relative(REPO_ROOT, pdfPath);
    const publicPdfPath = copyPdfToPublic(pdfPath, CURRENT_ENTRY_ID);

    const libraryData = {
      ...existingLibrary,
      generatedAt: existingLibrary.generatedAt ?? new Date().toISOString(),
      sourcePdf: {
        ...(existingLibrary.sourcePdf ?? {}),
        path: relativePdfPath,
        publicPath: publicPdfPath
      },
      authorContacts: authorContactsData
    };

    const removedIds = writeMockLibrary(libraryData);
    if (removedIds.length > 0) {
      console.log(`\nNote: removed entries ${removedIds.join(", ")} to maintain the ${MAX_ENTRIES}-entry limit.`);
    }

    console.log(`\nMock library updated with author contacts for entry "${CURRENT_ENTRY_ID}".`);
    return { entryId: CURRENT_ENTRY_ID, pdfPath, status: "completed" };
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
  runResearchGroups
};

if (require.main === module) {
  runResearchGroups().catch(() => {
    process.exitCode = 1;
  });
}
