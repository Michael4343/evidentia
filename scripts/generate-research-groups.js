#!/usr/bin/env node

/**
 * Interactive helper for generating Research Groups narratives.
 *
 * Usage:
 *   node scripts/generate-research-groups.js
 */

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const clipboardModule = require("clipboardy");
const clipboardy = clipboardModule?.default ?? clipboardModule;
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

const CLEANUP_PROMPT_HEADER = `You are a cleanup agent. Convert the analyst's notes into strict JSON for Evidentia's Research Groups UI.

Output requirements:
- Return a single JSON object with keys: papers (array), promptNotes (optional string).
- Each paper object must include: title (string), identifier (string|null), groups (array).
- Each group object must include: name (string), institution (string|null), website (string|null), notes (string|null), researchers (array).
- Each researcher object must include: name (string), email (string|null), role (string|null).
- Use null for unknown scalars. Use "Not provided" only inside notes when text is genuinely missing.
- No markdown, no commentary, no trailing prose. Ensure valid JSON (double quotes only).
- Preserve factual content; do not invent new people or emails.
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

function buildDiscoveryPrompt(library) {
  const sourceTitle = cleanPlainText(
    library?.sourcePaper?.title || library?.sourcePdf?.title || "Unknown title"
  );
  const sourceSummary = cleanPlainText(library?.sourcePaper?.summary || "Not provided");
  const keySignals = Array.isArray(library?.sourcePaper?.keyMethodSignals)
    ? library.sourcePaper.keyMethodSignals.map((signal) => cleanPlainText(signal)).filter(Boolean).slice(0, 5)
    : [];
  const similarPapers = Array.isArray(library?.similarPapers)
    ? library.similarPapers.slice(0, 5)
    : [];

  const lines = [
    "You are Evidentia's research co-pilot. Map the active research groups linked to these papers so our team can reach out to the right labs.",
    "",
    "Source paper:",
    `- Title: ${sourceTitle}`,
    `- Summary: ${sourceSummary}`
  ];

  if (library?.sourcePaper?.doi) {
    lines.push(`- DOI: ${library.sourcePaper.doi}`);
  }

  if (keySignals.length) {
    lines.push("- Method signals:");
    keySignals.forEach((signal) => {
      lines.push(`  - ${signal}`);
    });
  }

  if (similarPapers.length) {
    lines.push("", "Similar papers to cross-reference:");
    similarPapers.forEach((paper, index) => {
      const title = cleanPlainText(paper?.title || `Paper ${index + 1}`);
      const venue = cleanPlainText(paper?.venue || "Venue not reported");
      const year = paper?.year ? `${paper.year}` : "Year not reported";
      const authors = Array.isArray(paper?.authors) && paper.authors.length
        ? cleanPlainText(paper.authors.join(", "))
        : "Authors not reported";
      const whyRelevant = cleanPlainText(paper?.whyRelevant || "No relevance note provided.");
      const doi = paper?.doi ? `DOI: ${paper.doi}` : paper?.url ? `URL: ${paper.url}` : "No identifier provided";

      lines.push(
        `${index + 1}. ${title} — ${venue} (${year})`,
        `   Authors: ${authors}`,
        `   Identifier: ${doi}`,
        `   Method overlap: ${whyRelevant}`
      );

      if (Array.isArray(paper?.overlapHighlights) && paper.overlapHighlights.length) {
        lines.push("   Overlap highlights:");
        paper.overlapHighlights.slice(0, 3).forEach((highlight) => {
          lines.push(`     - ${cleanPlainText(highlight)}`);
        });
      }
    });
  }

  lines.push(
    "",
    "Search Methodology:",
    "1. Extract 3-5 core domain keywords from the source paper's method signals and similar papers' themes.",
    "2. For each paper, run Google Scholar searches:",
    "   - Use 'Since 2020' time filter to find recent work",
    "   - Search: author names + 'lab' OR 'group' to find lab pages",
    "   - Use site:.edu OR site:.ac.uk OR site:.ac.* filters for academic sources",
    "3. Verify each group:",
    "   - Check the group has 2-3+ publications since 2020 matching the domain keywords",
    "   - Confirm an active lab/group webpage exists",
    "   - Verify the PI is currently listed at that institution",
    "",
    "Task:",
    "- For the source paper and each similar paper, identify the active research groups, labs, or centres directly connected to those works.",
    "- Under each paper heading, list relevant groups, then within each group list principal investigators, current graduate students, and postdoctoral researchers when available.",
    "",
    "Finding Researchers & Contact Information:",
    "- Check lab/group pages for current members (PhD students, postdocs, research staff)",
    "- Review recent paper author lists (last 2 years) to identify current lab members",
    "- Search institution directories for academic/institutional emails",
    "- If email is not publicly listed, note 'Check lab website contact form' instead of 'Not provided'",
    "- Prioritize finding at least 2-3 contacts per group with proper institutional emails",
    "",
    "Required notes format (use plain text headings — no JSON yet):",
    "Paper: <Title> (<Identifier>)",
    "Groups:",
    "  - Group: <Group name> (<Institution>)",
    "    Website: <URL or 'Not provided'>",
    "    Summary: <1–2 sentences on why this group matters for the methods>",
    "    Members:",
    "      - Name | Email | Role",
    "      - Name | Email | Role",
    "",
    "Guidelines:",
    "- Only include groups you can verify are currently active with recent publications",
    "- Repeat the group block for each paper that cites or collaborates with that group; if a group spans multiple papers, duplicate it under each relevant paper heading and note the connection in the summary.",
    "- If information genuinely cannot be found after checking lab pages and recent papers, use 'Not provided', never leave blanks.",
    "- Aim for depth over breadth: 3-5 well-researched groups with complete contact info beats 10 groups with missing details."
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

  return {
    name,
    email,
    role: role && role.length > 0 ? role : null
  };
}

function normaliseGroup(entry) {
  if (!entry || typeof entry !== "object") {
    throw new Error("Each group must be an object containing at least a name.");
  }

  const name = cleanPlainText(entry.name || "");
  if (!name) {
    throw new Error("Group name is required.");
  }

  const institution = entry.institution ? cleanPlainText(entry.institution) : null;
  const website = entry.website ? cleanUrlStrict(entry.website) : null;
  const notes = entry.notes ? cleanPlainText(entry.notes) : null;

  const researchers = Array.isArray(entry.researchers)
    ? entry.researchers
        .map((person) => normaliseResearcher(person))
        .filter(Boolean)
    : [];

  return {
    name,
    institution: institution && institution.length > 0 ? institution : null,
    website: website && website.length > 0 ? website : null,
    notes: notes && notes.length > 0 ? notes : null,
    researchers
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
  const groups = Array.isArray(entry.groups) ? entry.groups.map((group) => normaliseGroup(group)) : [];

  return {
    title,
    identifier: identifier && identifier.length > 0 ? identifier : null,
    groups
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
      const groupBlocks = paper.groups.length
        ? paper.groups.map((group) => {
            const groupHeader = [
              `Group: ${group.name}${group.institution ? ` (${group.institution})` : ""}`,
              group.website ? `Website: ${group.website}` : "Website: Not provided",
              group.notes && group.notes.length > 0 ? `Summary: ${group.notes}` : "Summary: Not provided"
            ];

            const researcherRows = group.researchers.length
              ? group.researchers
              : [{ name: "Not provided", email: null, role: null }];

            const tableLines = ["| Name | Email | Role |", "| --- | --- | --- |"];
            researcherRows.forEach((person) => {
              const email = person.email || "Not provided";
              const role = person.role || "Not provided";
              tableLines.push(`| ${person.name} | ${email} | ${role} |`);
            });

            return `${groupHeader.join("\n")}\n${tableLines.join("\n")}`;
          })
        : ["No groups reported"];

      return `${header.join("\n")}\n${groupBlocks.join("\n\n")}`;
    })
    .join("\n\n");
}

async function run() {
  const rl = createInterface();
  const workingDir = process.cwd();

  try {
    console.log("\n=== Research Groups Prototype Helper ===\n");
    console.log(`Working directory: ${workingDir}`);

    const library = readLibrary();
    if (!library.entries.length) {
      console.error("\n❌ No existing mock library found. Run the Similar Papers generator first.");
      return;
    }

    const { entryId } = await promptForEntrySelection({
      ask: (question) => ask(rl, question),
      library,
      allowCreate: false,
      header: "Select the mock entry for research group generation"
    });

    CURRENT_LIBRARY = library;
    CURRENT_ENTRY_ID = entryId;

    let existingLibrary = getEntry(library, entryId);
    if (!existingLibrary) {
      console.error(`\n❌ Entry "${entryId}" not found.`);
      return;
    }
    existingLibrary = JSON.parse(JSON.stringify(existingLibrary));

    const pdfPath = await promptForPdfPath(rl, workingDir);
    console.log(`\nUsing PDF: ${pdfPath}`);

    const discoveryPrompt = buildDiscoveryPrompt(existingLibrary);
    await clipboardy.write(discoveryPrompt);

    console.log("\nDiscovery prompt copied to your clipboard. Paste it into the deep research agent to gather group notes.\n");
    console.log("Preview:");
    console.log(`${discoveryPrompt.slice(0, 240)}${discoveryPrompt.length > 240 ? "…" : ""}`);
    console.log(
      "\nNext steps:\n  1. Paste the prompt into your deep research agent.\n  2. Wait for the notes to finish compiling.\n  3. Press ENTER here when you're ready for the cleanup prompt.\n"
    );

    await ask(rl, "\nPress ENTER once the notes are ready to receive the cleanup prompt: ");

    const cleanupPrompt = buildCleanupPrompt();
    await clipboardy.write(cleanupPrompt);

    console.log("\nCleanup prompt copied to your clipboard. Paste it into the cleanup agent, add the notes beneath the divider, and request JSON.\n");
    console.log("Preview:");
    console.log(`${cleanupPrompt.slice(0, 240)}${cleanupPrompt.length > 240 ? "…" : ""}`);
    console.log(
      "\nNext steps:\n  1. Paste the cleanup prompt into your LLM.\n  2. Add the discovery notes beneath the placeholder line, then run the cleanup.\n  3. Paste the cleaned JSON back here (press ENTER on an empty line when finished).\n"
    );

    const cleanedJsonRaw = await collectCleanedJson(rl);

    if (!cleanedJsonRaw) {
      console.log("No cleaned JSON provided. Mock library left unchanged.");
      return;
    }

    let cleanedPayload;
    try {
      cleanedPayload = JSON.parse(cleanedJsonRaw);
    } catch (error) {
      console.error("\n❌ Failed to parse the Research Groups JSON. Ensure the cleanup agent returns valid JSON only.");
      console.error("Raw snippet preview:");
      console.error(cleanedJsonRaw.slice(0, 200));
      throw new Error(`Failed to parse research groups JSON: ${error instanceof Error ? error.message : String(error)}`);
    }

    const normalised = normaliseResearchGroupsPayload(cleanedPayload);
    const formattedText = formatResearchGroups(normalised.papers);

    const researchGroupsData = {
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
      researchGroups: researchGroupsData
    };

    const removedIds = writeMockLibrary(libraryData);
    if (removedIds.length > 0) {
      console.log(`\nNote: removed entries ${removedIds.join(", ")} to maintain the ${MAX_ENTRIES}-entry limit.`);
    }

    console.log(`\nMock library updated with research groups for entry "${CURRENT_ENTRY_ID}".`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\n❌ ${message}`);
    process.exitCode = 1;
  } finally {
    rl.close();
  }
}

run();
