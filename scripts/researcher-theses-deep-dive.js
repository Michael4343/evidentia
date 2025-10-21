#!/usr/bin/env node

/**
 * Helper for running deep thesis discovery on a single research group.
 *
 * Usage:
 *   node scripts/researcher-theses-deep-dive.js
 */

const fs = require("fs");
const path = require("path");
const { cleanUrlStrict } = require("../lib/clean-url-strict.js");
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
    .map((line) => line.trim())
    .filter((line, index, lines) => line.length > 0 || (index > 0 && lines[index - 1].length > 0))
    .join("\n");

  return value.trim();
}

function getResearchGroupPapers(library) {
  const structured = library?.researchGroups?.structured;
  if (!structured || !Array.isArray(structured.papers)) {
    return [];
  }
  return structured.papers.filter((paper) => Array.isArray(paper?.groups) && paper.groups.length > 0);
}

function normaliseKey(value) {
  if (typeof value !== "string") {
    return "";
  }
  return cleanPlainText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function getExistingThesisRecords(library, groupName) {
  const records = Array.isArray(library?.researcherTheses?.structured?.researchers)
    ? library.researcherTheses.structured.researchers
    : [];
  const targetKey = normaliseKey(groupName);
  if (!targetKey) {
    return [];
  }

  return records.filter((record) => normaliseKey(record.group) === targetKey);
}

function normaliseString(value) {
  if (typeof value !== "string") {
    return null;
  }
  const cleaned = cleanPlainText(value);
  return cleaned.length > 0 ? cleaned : null;
}

function normaliseYear(value) {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === "string") {
    const cleaned = value.trim();
    if (!cleaned) {
      return null;
    }
    const parsed = Number.parseInt(cleaned, 10);
    if (Number.isInteger(parsed)) {
      return parsed;
    }
  }
  return null;
}

function normaliseUrl(value) {
  if (typeof value !== "string") {
    return null;
  }
  const cleaned = cleanUrlStrict(value);
  return cleaned && cleaned.length > 0 ? cleaned : null;
}

function normaliseDataAccess(value) {
  if (typeof value !== "string") {
    return "unknown";
  }
  const normalised = value.trim().toLowerCase();
  if (normalised === "public" || normalised === "restricted" || normalised === "unknown") {
    return normalised;
  }
  return "unknown";
}

function normaliseStringArray(arr) {
  if (!Array.isArray(arr)) {
    return [];
  }
  return arr
    .map((item) => normaliseString(item))
    .filter((value) => typeof value === "string" && value.length > 0);
}

function normaliseThesisEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const thesis = {
    thesis_title: normaliseString(entry.thesis_title ?? entry.title ?? null),
    author: normaliseString(entry.author ?? entry.thesis_author ?? null),
    year: normaliseYear(entry.year),
    research_group: normaliseString(entry.research_group ?? entry.group ?? null),
    principal_investigator: normaliseString(entry.principal_investigator ?? entry.pi ?? entry.supervisor ?? null),
    thesis_url: normaliseUrl(entry.thesis_url ?? entry.direct_thesis_link ?? null),
    data_url: normaliseUrl(entry.data_url ?? entry.direct_data_link ?? null),
    data_synopsis: normaliseString(entry.data_synopsis ?? entry.data_summary ?? entry.data_note ?? null),
    data_access: normaliseDataAccess(entry.data_access),
    notes: normaliseString(entry.notes)
  };

  const hasCoreDetail =
    thesis.thesis_title || thesis.author || thesis.thesis_url || thesis.data_url || thesis.data_synopsis;

  if (!hasCoreDetail) {
    return null;
  }

  return thesis;
}

function normaliseDeepDivePayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Cleanup agent response must be a JSON object.");
  }

  const thesesRaw = Array.isArray(payload.theses) ? payload.theses : [];
  const theses = thesesRaw.map((entry) => normaliseThesisEntry(entry)).filter(Boolean);

  const structured = {
    theses,
    sources_checked: normaliseStringArray(payload.sources_checked ?? payload.sourcesChecked),
    follow_up: normaliseStringArray(payload.follow_up ?? payload.followUp),
    promptNotes: normaliseString(payload.promptNotes ?? payload.prompt_notes ?? null)
  };

  return structured;
}

function formatDeepDiveText(structured) {
  const lines = [];

  if (structured.theses.length > 0) {
    structured.theses.forEach((entry, index) => {
      lines.push(`Thesis ${index + 1}`);
      lines.push(`  Title: ${entry.thesis_title || "Not provided"}`);
      lines.push(`  Author: ${entry.author || "Not provided"}`);
      if (entry.year !== null) {
        lines.push(`  Year: ${entry.year}`);
      }
      lines.push(`  Research group: ${entry.research_group || "Not provided"}`);
      lines.push(`  PI: ${entry.principal_investigator || "Not provided"}`);
      lines.push(`  Thesis URL: ${entry.thesis_url || "Not provided"}`);
      lines.push(`  Data URL: ${entry.data_url || "Not provided"}`);
      lines.push(`  Data access: ${entry.data_access}`);
      lines.push(`  Data synopsis: ${entry.data_synopsis || "Not provided"}`);
      if (entry.notes) {
        lines.push(`  Notes: ${entry.notes}`);
      }
      lines.push("");
    });
  } else {
    lines.push("No theses confirmed in this deep dive.");
  }

  if (structured.sources_checked.length > 0) {
    lines.push("Sources checked:");
    structured.sources_checked.forEach((source) => {
      lines.push(`- ${source}`);
    });
    lines.push("");
  }

  if (structured.follow_up.length > 0) {
    lines.push("Follow-up items:");
    structured.follow_up.forEach((item) => {
      lines.push(`- ${item}`);
    });
    lines.push("");
  }

  if (structured.promptNotes) {
    lines.push("Prompt notes:");
    lines.push(structured.promptNotes);
  }

  return lines.join("\n").trim();
}

function buildExistingRecordsSection(records) {
  if (!records.length) {
    return [];
  }

  const lines = [
    "",
    "Existing thesis signals (use as starting clues, verify everything):"
  ];

  records.forEach((record) => {
    const bits = [];
    const name = cleanPlainText(record?.name || "");
    const thesis = record?.phd_thesis || {};
    const thesisTitle = cleanPlainText(thesis?.title || "");
    const thesisYear = typeof thesis?.year === "number" ? thesis.year : null;
    const thesisInstitution = cleanPlainText(thesis?.institution || "");
    const thesisUrl = cleanPlainText(thesis?.url || "");
    const availability = cleanPlainText(record?.data_publicly_available || "unknown");

    if (name) {
      bits.push(name);
    }
    if (thesisYear) {
      bits.push(`(${thesisYear})`);
    }
    if (thesisTitle) {
      bits.push(`"${thesisTitle}"`);
    }
    if (thesisInstitution) {
      bits.push(thesisInstitution);
    }

    const summary = bits.filter(Boolean).join(" — ");
    const lineParts = [`- ${summary || "Researcher thesis record"}`];

    if (thesisUrl) {
      lineParts.push(`  Thesis link: ${thesisUrl}`);
    }
    lineParts.push(`  Reported data availability: ${availability || "unknown"}`);

    lines.push(lineParts.join("\n"));
  });

  lines.push("- Treat availability flags as hints only; confirm actual dataset access in this pass.");

  return lines;
}

function buildDiscoveryPrompt({ paper, group, existingRecords }) {
  const lines = [];
  lines.push("You are a deep research analyst specialising in academic theses and open datasets.");
  lines.push("");
  lines.push("Target paper:");
  lines.push(`- Title: ${cleanPlainText(paper.title)}`);
  if (paper.identifier) {
    lines.push(`- Identifier: ${cleanPlainText(paper.identifier)}`);
  }
  if (typeof paper.year === "number") {
    lines.push(`- Publication year: ${paper.year}`);
  }

  lines.push("");
  lines.push("Focus research group:");
  lines.push(
    `- Name: ${cleanPlainText(group.name)}${group.institution ? ` — ${cleanPlainText(group.institution)}` : ""}`
  );
  if (group.website) {
    lines.push(`- Website: ${cleanPlainText(group.website)}`);
  }
  if (group.notes) {
    lines.push(`- Focus: ${cleanPlainText(group.notes)}`);
  }

  if (Array.isArray(group.researchers) && group.researchers.length > 0) {
    lines.push("- Known contacts:");
    group.researchers.forEach((person) => {
      const name = cleanPlainText(person?.name || "");
      const role = cleanPlainText(person?.role || "");
      const email = cleanPlainText(person?.email || "");
      const details = [name];
      if (role) {
        details.push(role);
      }
      if (email) {
        details.push(email);
      }
      lines.push(`  • ${details.filter(Boolean).join(" — ") || "Unnamed contact"}`);
    });
  }

  lines.push(...buildExistingRecordsSection(existingRecords));

  lines.push("", "Research goal:");
  lines.push(
    `- Surface PhD theses supervised by the PI or senior leads of ${cleanPlainText(
      group.name
    )} that release reusable datasets relevant to the paper's topic. Confirm public access and capture direct dataset links.`
  );

  lines.push("", "Execution (work end-to-end for this single group):");
  lines.push(
    "1. Identify the current principal investigator(s) and senior supervisors tied to this group. Confirm spelling and any alternate names used in repositories."
  );
  lines.push(
    "2. Search the university or departmental thesis repository using the PI as advisor/supervisor. Expand to national theses portals when the institutional site is thin."
  );
  lines.push(
    "3. For each candidate thesis (bias toward the last 10-12 years), open the PDF and locate the Data Availability Statement or equivalent sections (Abstract, Methods, Appendices)."
  );
  lines.push(
    "4. Extract every concrete repository link (GitHub, Zenodo, Figshare, Dryad, institutional repositories, NCBI GEO/SRA, etc.). Follow the link, confirm it is publicly accessible, and note licence/README clues about usability."
  );
  lines.push(
    "5. If no dataset is available, document the reason (embargo, upon-request, missing statement). Explain any dead ends so another analyst knows what to try next."
  );

  lines.push("", "Output (per thesis, no prose outside this structure):");
  lines.push("Thesis Title & Author:");
  lines.push("Research Group / PI:");
  lines.push("Direct Thesis Link:");
  lines.push("Direct Data Link & Synopsis:");

  lines.push("");
  lines.push("After listing all confirmed theses, add a short bullet list of key repositories searched and any follow-up items.");
  lines.push("Flag anything that needs escalation (paywalled, non-English portals, etc.).");

  return lines.join("\n");
}

function buildCleanupPrompt({ paper, group }) {
  const lines = [];
  lines.push("You are a cleanup agent. Structure the analyst's deep-dive notes into JSON for Evidentia's PhD thesis UI.");
  lines.push("");
  lines.push("Context summary (do not repeat in the output):");
  lines.push(`- Paper: ${cleanPlainText(paper.title)}`);
  if (paper.identifier) {
    lines.push(`- Identifier: ${cleanPlainText(paper.identifier)}`);
  }
  lines.push(`- Focus group: ${cleanPlainText(group.name)}${group.institution ? ` — ${cleanPlainText(group.institution)}` : ""}`);
  lines.push("");
  lines.push("Output requirements:");
  lines.push("- Return a single JSON object with keys: theses (array), sources_checked (optional array of strings), follow_up (optional array of strings), promptNotes (optional string).");
  lines.push("- Each thesis object must include: thesis_title (string|null), author (string|null), year (number|null), research_group (string|null), principal_investigator (string|null), thesis_url (string|null), data_url (string|null), data_synopsis (string|null), data_access (\"public\" | \"restricted\" | \"unknown\"), notes (string|null).");
  lines.push("- Use null for unknown scalars. Use arrays only for sources_checked and follow_up.");
  lines.push("- Extract URLs in plain https:// form. Strip markdown or narrative phrasing.");
  lines.push("- Preserve factual content from the notes; do not invent new theses or datasets.");
  lines.push("- No markdown or commentary outside the JSON object. Output valid JSON (double quotes).");
  lines.push("");
  lines.push("Return only the JSON object.");

  return lines.join("\n");
}

async function selectFromList(rl, items, formatter) {
  if (!items.length) {
    return null;
  }

  const lines = items.map((item, index) => `  [${index + 1}] ${formatter(item, index)}`).join("\n");
  console.log(lines);

  while (true) {
    const raw = await ask(rl, "\nSelect an option (number, or press ENTER to cancel): ");
    const trimmed = raw.trim();
    if (!trimmed) {
      return null;
    }
    const choice = Number.parseInt(trimmed, 10);
    if (Number.isInteger(choice) && choice >= 1 && choice <= items.length) {
      return items[choice - 1];
    }
    console.log("Invalid selection. Please enter a number from the list.");
  }
}

async function runResearcherThesesDeepDive(options = {}) {
  const rl = createInterface();
  const workingDir = process.cwd();
  const {
    entryId: presetEntryId = null
  } = options;

  try {
    console.log("\n=== Researcher Thesis Deep Dive Helper ===\n");
    console.log(`Working directory: ${workingDir}`);

    const library = readLibrary();
    if (!library.entries.length) {
      console.error("\n❌ No existing mock library found. Run the Similar Papers generator first.");
      return;
    }

    let entryId = presetEntryId;
    if (!entryId) {
      const selection = await promptForEntrySelection({
        ask: (question) => ask(rl, question),
        library,
        allowCreate: false,
        header: "Select the mock entry for thesis deep-dive"
      });
      entryId = selection.entryId;
    }

    CURRENT_LIBRARY = library;
    CURRENT_ENTRY_ID = entryId;

    let existingLibrary = getEntry(library, entryId);
    if (!existingLibrary) {
      console.error(`\n❌ Entry "${entryId}" not found.`);
      return { entryId, status: "skipped" };
    }
    existingLibrary = JSON.parse(JSON.stringify(existingLibrary));

    const papers = getResearchGroupPapers(existingLibrary);
    if (!papers.length) {
      console.error("\n❌ No research group data found. Run the research groups helper before deep diving.");
      return { entryId: CURRENT_ENTRY_ID, status: "skipped" };
    }

    console.log("Available papers:\n");
    const selectedPaper = await selectFromList(rl, papers, (paper) => {
      const meta = [paper.title];
      if (paper.identifier) {
        meta.push(paper.identifier);
      }
      meta.push(`${paper.groups.length} groups`);
      return meta.filter(Boolean).join(" · ");
    });

    if (!selectedPaper) {
      console.log("No paper selected. Exiting.");
      return { entryId: CURRENT_ENTRY_ID, status: "skipped" };
    }

    console.log(`\nSelected paper: ${selectedPaper.title}\n`);

    const groups = selectedPaper.groups;
    const selectedGroup = await selectFromList(rl, groups, (group) => {
      const meta = [group.name];
      if (group.institution) {
        meta.push(group.institution);
      }
      return meta.filter(Boolean).join(" — ");
    });

    if (!selectedGroup) {
      console.log("No group selected. Exiting.");
      return { entryId: CURRENT_ENTRY_ID, status: "skipped" };
    }

    console.log(`\nSelected group: ${selectedGroup.name}`);

    const existingRecords = getExistingThesisRecords(existingLibrary, selectedGroup.name);
    const discoveryPrompt = buildDiscoveryPrompt({
      paper: selectedPaper,
      group: selectedGroup,
      existingRecords
    });

    try {
      await copyPromptToClipboard(discoveryPrompt, {
        label: "Discovery prompt",
        previewLength: 320
      });
    } catch (error) {
      console.warn("Failed to copy discovery prompt. Printing below:\n");
      console.log(discoveryPrompt);
    }

    console.log("\nPaste it into the deep research agent.\n");

    console.log(
      "\nNext steps:\n  1. Run the discovery prompt and gather detailed notes.\n  2. Return here for the cleanup prompt once the raw findings are ready.\n"
    );

    await ask(rl, "Press ENTER when you're ready for the cleanup prompt: ");

    const cleanupPrompt = buildCleanupPrompt({ paper: selectedPaper, group: selectedGroup });
    try {
      await copyPromptToClipboard(cleanupPrompt, {
        label: "Cleanup prompt",
        previewLength: 320
      });
    } catch (error) {
      console.warn("Failed to copy cleanup prompt. Printing below:\n");
      console.log(cleanupPrompt);
    }

    console.log(
      "\nCleanup prompt ready. Paste it alongside the discovery notes to obtain structured JSON.\n"
    );
    console.log(
      "\nNext steps:\n  1. Run the cleanup prompt with the discovery transcript.\n  2. Paste the returned JSON below (press ENTER on an empty line when finished).\n"
    );

    const jsonInput = await collectJsonInput(rl);

    if (!jsonInput) {
      console.log("No JSON provided. Deep dive results were not saved.");
      return { entryId: CURRENT_ENTRY_ID, status: "skipped" };
    }

    let payload;
    try {
      payload = JSON.parse(jsonInput);
    } catch (error) {
      console.error("\n❌ Failed to parse the cleanup JSON. Ensure the agent returns valid JSON only.");
      console.error("Raw snippet preview:");
      console.error(jsonInput.slice(0, 200));
      throw new Error(`Failed to parse cleanup JSON: ${error instanceof Error ? error.message : String(error)}`);
    }

    const structured = normaliseDeepDivePayload(payload);
    const text = formatDeepDiveText(structured);

    const deepDiveEntry = {
      generatedAt: new Date().toISOString(),
      paper: {
        title: cleanPlainText(selectedPaper.title),
        identifier: selectedPaper.identifier ? cleanPlainText(selectedPaper.identifier) : null,
        year: typeof selectedPaper.year === "number" ? selectedPaper.year : null
      },
      group: {
        name: cleanPlainText(selectedGroup.name),
        institution: selectedGroup.institution ? cleanPlainText(selectedGroup.institution) : null,
        website: selectedGroup.website ? cleanPlainText(selectedGroup.website) : null
      },
      text,
      structured
    };

    const existingResearcherTheses = existingLibrary.researcherTheses || {};
    const currentDeepDiveEntries = Array.isArray(existingResearcherTheses?.deepDives?.entries)
      ? existingResearcherTheses.deepDives.entries.slice()
      : [];
    currentDeepDiveEntries.push(deepDiveEntry);

    const nextResearcherTheses = {
      ...existingResearcherTheses,
      deepDives: {
        entries: currentDeepDiveEntries
      }
    };

    const nextLibrary = {
      ...existingLibrary,
      generatedAt: existingLibrary.generatedAt ?? new Date().toISOString(),
      researcherTheses: nextResearcherTheses
    };

    const removedIds = writeMockLibrary(nextLibrary);

    if (removedIds.length > 0) {
      console.log(`\nNote: removed entries ${removedIds.join(", ")} to maintain the ${MAX_ENTRIES}-entry limit.`);
    }

    console.log(`\nDeep dive saved for entry "${CURRENT_ENTRY_ID}".`);

    if (structured.theses.length === 0) {
      console.log("No theses were captured in this run, but follow-up notes were stored for reference.");
    } else {
      console.log(`Captured ${structured.theses.length} thesis record${structured.theses.length > 1 ? "s" : ""}.`);
    }

    return { entryId: CURRENT_ENTRY_ID, status: "completed" };
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
  runResearcherThesesDeepDive
};

if (require.main === module) {
  runResearcherThesesDeepDive().catch(() => {
    process.exitCode = 1;
  });
}
