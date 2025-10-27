#!/usr/bin/env node

/**
 * Interactive helper for assembling patent search prompts.
 *
 * Usage:
 *   node scripts/generate-patents.js
 */

const fs = require("fs");
const path = require("path");
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
  copyPromptToClipboard,
  collectJsonInput
} = require("./mock-cli-utils");

const CLEANUP_PROMPT_HEADER = `You are a cleanup agent. Convert the analyst's patent search notes into strict JSON for Evidentia's patent UI.

Context: You should receive notes for 3-5 patents that validate the paper's claims through substantive technical overlap.

Output requirements:
- Return a single JSON object with keys: patents (array of 3-5 items), promptNotes (optional string).
- Each patent object must include: patentNumber (string), title (string), assignee (string|null), filingDate (string|null), grantDate (string|null), abstract (string|null), overlapWithPaper (object with claimIds array and summary string), url (string).
- Use null for unknown scalars. Use empty arrays for missing claimIds arrays only.
- CRITICAL: Every patent MUST have a url field with a Google Patents link. Construct it as: https://patents.google.com/patent/{PATENT_NUMBER}
  Examples:
  * US7729863B2 → https://patents.google.com/patent/US7729863B2
  * WO2022272120A1 → https://patents.google.com/patent/WO2022272120A1
  * EP3438287B1 → https://patents.google.com/patent/EP3438287B1
- Dates should be in YYYY-MM-DD format when available.
- overlapWithPaper.claimIds should reference the paper claim IDs (e.g., ["C1", "C3"]). This array shows which claims are validated by this patent.
- overlapWithPaper.summary MUST be a detailed 2-3 sentence explanation of HOW the patent's technical claims map to specific methods/techniques in the paper. Be specific about the technical overlap—this is validation evidence.
- No markdown, commentary, or trailing prose. Valid JSON only (double quotes).
- Preserve factual content from the notes; do not invent new patents.
- Output raw JSON only — no markdown fences, comments, trailing prose, or extra keys.`;

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

function buildPatentDiscoveryPrompt(entry) {
  const claimsAnalysis = entry?.claimsAnalysis;

  if (!claimsAnalysis || !claimsAnalysis.structured || !Array.isArray(claimsAnalysis.structured.claims)) {
    throw new Error(
      "No claims analysis found in mock library. Run the claims analysis script first."
    );
  }

  const claims = claimsAnalysis.structured.claims;
  const paperTitle = entry?.sourcePaper?.title || entry?.sourcePdf?.title || "Unknown paper";
  const paperDoi = entry?.sourcePdf?.doi || entry?.sourcePaper?.doi || "";

  if (claims.length === 0) {
    throw new Error("No claims found in the analysis. Cannot generate patent search prompt.");
  }

  const lines = [
    "Objective: Identify 3-5 patents that validate the paper's claims through substantive technical overlap.",
    "",
    "Context: You have a claims brief from a scientific paper. Search patent databases to find granted patents and published applications that cover similar technical approaches. Focus on validation evidence—patents that demonstrate the paper's methods have been independently developed and claimed in the patent literature.",
    "",
    "Inputs:",
    "",
    `Paper: ${paperTitle}`,
  ];

  if (paperDoi) {
    lines.push(`DOI: ${paperDoi}`);
  }

  lines.push(
    "",
    "Claims from the paper:",
    ""
  );

  claims.forEach((claim) => {
    lines.push(`${claim.id}: ${claim.claim}`);
    if (claim.evidenceSummary) {
      lines.push(`   Evidence: ${claim.evidenceSummary}`);
    }
    if (claim.evidenceType) {
      lines.push(`   Type: ${claim.evidenceType}`);
    }
    lines.push("");
  });

  lines.push(
    "Constraints:",
    "",
    "- Return 3-5 patents with the strongest technical overlap (quality over quantity).",
    "- Include both granted patents and published applications.",
    "- Bias toward recent filings (last 10 years) when relevance is comparable.",
    "- Focus on substantive technical overlap, not just keyword matches.",
    "- For each patent, explain HOW the patent claims map to specific paper methods (be specific about the technical elements that overlap).",
    "",
    "Output Format:",
    "",
    "For each patent provide:",
    "- Patent number (e.g., US1234567B2, WO2020123456A1)",
    "- Title",
    "- Assignee (company/institution)",
    "- Filing date and grant date (if granted)",
    "- Brief abstract (1-2 sentences)",
    "- Which paper claims this patent relates to (e.g., C1, C3)",
    "- Technical overlap summary: 2-3 sentences explaining HOW the patent's technical claims map to specific methods/techniques in the paper. Be specific about algorithms, materials, apparatus, or applications that overlap.",
    "- URL to patent document (Google Patents link)",
    "",
    "Steps:",
    "",
    "1. Extract specific technical elements from each paper claim: algorithms, compositions, materials, apparatus, methods, or applications.",
    "2. Search patent databases (Google Patents, USPTO, EPO, WIPO) using these technical elements.",
    "3. For each candidate patent, read the claims section and identify which patent claims cover similar technical approaches.",
    "4. Map patent claim language to the paper's technical elements and note the overlap.",
    "5. Select the 3-5 patents with the most substantive technical overlap to the paper's claims.",
    "6. For each selected patent, write a 2-3 sentence technical summary explaining the specific overlap.",
    "7. If fewer than 3 patents have substantive overlap, return what you find and note which claims lack patent coverage.",
    ""
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

function normalizePatent(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const patentNumber = cleanPlainText(entry.patentNumber || "");
  if (!patentNumber) {
    return null;
  }

  const title = cleanPlainText(entry.title || "");
  const assignee = entry.assignee ? cleanPlainText(entry.assignee) : null;
  const filingDate = typeof entry.filingDate === "string" ? entry.filingDate.trim() : null;
  const grantDate = typeof entry.grantDate === "string" ? entry.grantDate.trim() : null;
  const abstract = entry.abstract ? cleanPlainText(entry.abstract) : null;
  const url = typeof entry.url === "string" && entry.url.trim().startsWith("http") ? entry.url.trim() : null;

  const overlapWithPaper = entry.overlapWithPaper && typeof entry.overlapWithPaper === "object"
    ? {
        claimIds: Array.isArray(entry.overlapWithPaper.claimIds)
          ? entry.overlapWithPaper.claimIds.filter((id) => typeof id === "string" && id.trim().length > 0)
          : [],
        summary: entry.overlapWithPaper.summary ? cleanPlainText(entry.overlapWithPaper.summary) : ""
      }
    : { claimIds: [], summary: "" };

  return {
    patentNumber,
    title: title || "Untitled patent",
    assignee,
    filingDate,
    grantDate,
    abstract,
    overlapWithPaper,
    url
  };
}

function normalizePatentsPayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Cleanup agent response must be a JSON object.");
  }

  if (!Array.isArray(payload.patents)) {
    throw new Error("patents must be an array.");
  }

  const patents = payload.patents
    .map((entry) => normalizePatent(entry))
    .filter(Boolean);

  const promptNotes = typeof payload.promptNotes === "string" ? cleanPlainText(payload.promptNotes) : "";

  return {
    patents,
    promptNotes
  };
}

function formatPatents(patents) {
  return patents
    .map((patent) => {
      const lines = [
        `Patent: ${patent.patentNumber}`,
        `Title: ${patent.title}`,
        `Assignee: ${patent.assignee || "Not provided"}`,
        `Filing Date: ${patent.filingDate || "Not provided"}`,
        `Grant Date: ${patent.grantDate || "Not provided"}`,
      ];

      if (patent.abstract) {
        lines.push(`Abstract: ${patent.abstract}`);
      }

      if (patent.overlapWithPaper.claimIds.length > 0) {
        lines.push(`Overlaps with paper claims: ${patent.overlapWithPaper.claimIds.join(", ")}`);
      }

      if (patent.overlapWithPaper.summary) {
        lines.push(`Technical overlap: ${patent.overlapWithPaper.summary}`);
      }

      if (patent.url) {
        lines.push(`URL: ${patent.url}`);
      }

      return lines.join("\n");
    })
    .join("\n\n");
}

async function runPatents(options = {}) {
  const rl = createInterface();
  const workingDir = process.cwd();
  const {
    entryId: presetEntryId = null
  } = options;

  try {
    console.log("\n=== Patent Search Prompt Helper ===\n");
    console.log(`Working directory: ${workingDir}`);

    const library = readLibrary();
    if (!library.entries.length) {
      console.error("\n❌ No mock entries available. Run the claims analysis generator first.");
      return { entryId: null, status: "skipped" };
    }

    let entryId = presetEntryId;
    if (!entryId) {
      const selection = await promptForEntrySelection({
        ask: (question) => ask(rl, question),
        library,
        allowCreate: false,
        header: "Select the mock entry for patent generation"
      });
      entryId = selection.entryId;
    }

    let entry = getEntry(library, entryId);
    if (!entry) {
      console.error(`\n❌ Entry "${entryId}" not found.`);
      return { entryId, status: "skipped" };
    }

    entry = JSON.parse(JSON.stringify(entry));

    if (!entry.claimsAnalysis) {
      console.error(
        `\n❌ Claims analysis data missing for entry "${entryId}". Run the claims analysis generator before searching for patents.`
      );
      return { entryId, status: "skipped" };
    }

    const discoveryPrompt = buildPatentDiscoveryPrompt(entry);
    try {
      await copyPromptToClipboard(discoveryPrompt, {
        label: "Discovery prompt"
      });
    } catch (error) {
      console.warn("Failed to copy discovery prompt. Printing below:\n");
      console.log(discoveryPrompt);
    }

    console.log("\nPaste it into your research agent to gather patent notes.\n");
    console.log(
      "\nNext steps:\n  1. Paste the prompt into your research agent and let it complete.\n  2. Collect the patent notes.\n  3. Press ENTER here when you're ready for the cleanup prompt.\n"
    );

    await ask(rl, "\nPress ENTER once the notes are ready to receive the cleanup prompt: ");

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
      return { entryId, status: "skipped" };
    }

    let cleanedPayload;
    try {
      cleanedPayload = JSON.parse(cleanedJsonRaw);
    } catch (error) {
      console.error("\n❌ Failed to parse the patents JSON. Ensure the cleanup agent returns valid JSON only.");
      console.error("Raw snippet preview:");
      console.error(cleanedJsonRaw.slice(0, 200));
      throw new Error(`Failed to parse patents JSON: ${error instanceof Error ? error.message : String(error)}`);
    }

    const normalised = normalizePatentsPayload(cleanedPayload);
    const formattedText = formatPatents(normalised.patents);

    const patentsData = {
      text: formattedText,
      structured: {
        patents: normalised.patents,
        promptNotes: normalised.promptNotes
      }
    };

    entry.patents = patentsData;
    entry.generatedAt = entry.generatedAt ?? new Date().toISOString();

    const previousIds = library.entries.map((item) => item.id);
    upsertEntry(library, entry);
    writeLibrary(path.basename(__filename), library);

    const removedIds = previousIds.filter((id) => !library.entries.some((item) => item.id === id));
    if (removedIds.length > 0) {
      console.log(`\nNote: removed entries ${removedIds.join(", ")} to maintain the ${MAX_ENTRIES}-entry limit.`);
    }

    console.log(`\nMock library updated with patents for entry "${entryId}".`);
    console.log(`\nFound ${normalised.patents.length} patent(s).`);
    return { entryId, status: "completed" };
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
  runPatents
};

if (require.main === module) {
  runPatents().catch(() => {
    process.exitCode = 1;
  });
}
