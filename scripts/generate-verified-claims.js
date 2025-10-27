#!/usr/bin/env node

/**
 * Interactive helper for verifying paper claims against all gathered evidence.
 *
 * Usage:
 *   node scripts/generate-verified-claims.js
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

const CLEANUP_PROMPT_HEADER = `You convert the analyst's verified-claims notes into strict JSON for Evidentia's review UI.

Return exactly one JSON object with these keys:
- "claims": array ordered as in the notes (use [] if the analyst supplied none).
- "overallAssessment": string summarising the entire paper ("" if not provided).
- "promptNotes": optional string with any remaining analyst cautions. Omit the key when nothing meaningful remains.

Each element in "claims" must include:
- "claimId": string such as "C1".
- "originalClaim": the verbatim claim text.
- "verificationStatus": one of "Verified", "Partially Verified", "Contradicted", "Insufficient Evidence".
- "confidenceLevel": one of "High", "Moderate", "Low".
- "supportingEvidence": array of objects with { "source": "Similar Paper" | "Research Group" | "Patent" | "Thesis", "title": string, "relevance": string }. Use [] when nothing is cited.
- "contradictingEvidence": same schema; emit [] when the analyst reported none.
- "verificationSummary": a 2-3 sentence user-facing explanation of the status and reasoning.

Normalise as you parse:
- Preserve analyst wording but trim whitespace and strip markdown or bullet symbols.
- Map bracketed prefixes such as "[Similar Paper]" or "[Patent]" into the "source" field and remove them from titles.
- Drop placeholder strings like "None found" or "No contradictions" and output empty arrays instead.
- Collapse multi-line relevance notes into a single sentence per evidence item.
- Maintain the original claim order from the notes and keep paragraph breaks in "promptNotes" using \n\n.

Respond with raw JSON only (double quotes, no code fences) and never invent evidence or conclusions.`;

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

function buildVerificationPrompt(entry) {
  const claimsAnalysis = entry?.claimsAnalysis;
  const similarPapers = Array.isArray(entry?.similarPapers) ? entry.similarPapers : [];
  const researchGroups = entry?.researchGroups?.structured?.papers || [];
  const researcherTheses = entry?.researcherTheses?.structured?.researchers || [];
  const patents = entry?.patents?.structured?.patents || [];

  if (!claimsAnalysis || !claimsAnalysis.structured || !Array.isArray(claimsAnalysis.structured.claims)) {
    throw new Error("No claims analysis found. Run the claims analysis script first.");
  }

  const claims = claimsAnalysis.structured.claims;
  const paperTitle = entry?.sourcePaper?.title || entry?.sourcePdf?.title || "Unknown paper";
  const paperDoi = entry?.sourcePdf?.doi || entry?.sourcePaper?.doi || "";

  if (claims.length === 0) {
    throw new Error("No claims found in the analysis. Cannot generate verification prompt.");
  }

  const lines = [
    "You are a scientific claim verification analyst.",
    "",
    "Verify Paper Claims Against All Available Evidence",
    "",
    `Paper: ${paperTitle}`,
  ];

  if (paperDoi) {
    lines.push(`DOI: ${paperDoi}`);
  }

  lines.push(
    "",
    "Task: Cross-reference each claim below against ALL available evidence from similar papers, research groups, PhD theses, and patents. Determine verification status, identify supporting and contradicting evidence, and assess confidence level.",
    "",
    "=== CLAIMS TO VERIFY ===",
    ""
  );

  claims.forEach((claim) => {
    lines.push(`${claim.id}: ${claim.claim}`);
    if (claim.evidenceSummary) {
      lines.push(`   Evidence: ${claim.evidenceSummary}`);
    }
    if (claim.strength) {
      lines.push(`   Original Strength: ${claim.strength}`);
    }
    lines.push("");
  });

  lines.push("=== AVAILABLE EVIDENCE ===", "");

  // Similar Papers
  if (similarPapers.length > 0) {
    lines.push("SIMILAR PAPERS:", "");
    similarPapers.forEach((paper, index) => {
      lines.push(`Paper ${index + 1}: ${paper.title || "Untitled"}`);
      if (paper.authors && Array.isArray(paper.authors)) {
        lines.push(`  Authors: ${paper.authors.join(", ")}`);
      }
      if (paper.year) {
        lines.push(`  Year: ${paper.year}`);
      }
      if (paper.whyRelevant) {
        lines.push(`  Relevance: ${paper.whyRelevant}`);
      }
      if (paper.overlapHighlights && Array.isArray(paper.overlapHighlights)) {
        lines.push(`  Key Findings: ${paper.overlapHighlights.join("; ")}`);
      }
      lines.push("");
    });
  } else {
    lines.push("SIMILAR PAPERS: None available", "");
  }

  // Research Groups
  if (researchGroups.length > 0) {
    lines.push("RESEARCH GROUPS:", "");
    researchGroups.forEach((rg, index) => {
      lines.push(`Research Context ${index + 1}: ${rg.title || "Unknown paper"}`);
      if (rg.groups && Array.isArray(rg.groups)) {
        rg.groups.forEach((group) => {
          lines.push(`  Group: ${group.name || "Unnamed"}`);
          if (group.institution) {
            lines.push(`    Institution: ${group.institution}`);
          }
          if (group.notes) {
            lines.push(`    Focus: ${group.notes}`);
          }
        });
      }
      lines.push("");
    });
  } else {
    lines.push("RESEARCH GROUPS: None available", "");
  }

  // Researcher Theses
  if (researcherTheses.length > 0) {
    lines.push("PHD THESES:", "");
    researcherTheses.forEach((researcher, index) => {
      lines.push(`Researcher ${index + 1}: ${researcher.name || "Unknown"}`);
      if (researcher.phd_thesis) {
        const thesis = researcher.phd_thesis;
        lines.push(`  Thesis: ${thesis.title || "Not found"}`);
        if (thesis.year) {
          lines.push(`  Year: ${thesis.year}`);
        }
        if (thesis.institution) {
          lines.push(`  Institution: ${thesis.institution}`);
        }
      }
      if (researcher.latest_publication) {
        const pub = researcher.latest_publication;
        lines.push(`  Latest Publication: ${pub.title || "Not found"}`);
      }
      if (researcher.data_publicly_available) {
        lines.push(`  Data Available: ${researcher.data_publicly_available}`);
      }
      lines.push("");
    });
  } else {
    lines.push("PHD THESES: None available", "");
  }

  // Patents
  if (patents.length > 0) {
    lines.push("RELATED PATENTS:", "");
    patents.forEach((patent, index) => {
      lines.push(`Patent ${index + 1}: ${patent.patentNumber || "Unknown"}`);
      lines.push(`  Title: ${patent.title || "Untitled"}`);
      if (patent.assignee) {
        lines.push(`  Assignee: ${patent.assignee}`);
      }
      if (patent.overlapWithPaper && patent.overlapWithPaper.claimIds) {
        lines.push(`  Overlaps with claims: ${patent.overlapWithPaper.claimIds.join(", ")}`);
      }
      if (patent.overlapWithPaper && patent.overlapWithPaper.summary) {
        lines.push(`  Technical Overlap: ${patent.overlapWithPaper.summary}`);
      }
      lines.push("");
    });
  } else {
    lines.push("RELATED PATENTS: None available", "");
  }

  lines.push(
    "=== VERIFICATION METHODOLOGY ===",
    "",
    "CRITICAL STANCE: Be skeptical and rigorous. Assume claims are UNVERIFIED until proven otherwise.",
    "Default to 'Partially Verified' - most claims should have caveats. 'Verified' status is RARE.",
    "",
    "For each claim (C1, C2, etc.):",
    "",
    "1. INDEPENDENCE CHECK:",
    "   - Evidence from the SAME research group or authors = NOT independent validation",
    "   - Require 3+ INDEPENDENT sources (different groups/institutions) for 'Verified' status",
    "   - Same-group evidence can only support 'Partially Verified' at best",
    "",
    "2. DATA AVAILABILITY CHECK:",
    "   - Is raw data publicly available? (GitHub, Zenodo, institutional repository)",
    "   - Is code/analysis pipeline shared?",
    "   - Can findings be reproduced by an independent researcher?",
    "   - NO public data/code = automatic downgrade from 'Verified' to 'Partially Verified'",
    "",
    "3. STATISTICAL RIGOR CHECK:",
    "   - Adequate sample size (N)?",
    "   - Proper controls and randomization?",
    "   - P-values reported and appropriate?",
    "   - Effect sizes meaningful?",
    "   - Missing any of these = note as limitation",
    "",
    "4. REPLICATION CHECK:",
    "   - Has the finding been replicated by another group?",
    "   - Do similar papers CONFIRM or CONTRADICT?",
    "   - Are methods validated across multiple studies?",
    "   - No independent replication = 'Partially Verified' at best",
    "",
    "5. METHODOLOGICAL SOUNDNESS:",
    "   - Appropriate study design for the claim?",
    "   - Potential confounders addressed?",
    "   - Limitations acknowledged?",
    "   - Look for gaps in reasoning or methodology",
    "",
    "6. CONTRADICTION SEARCH (CRITICAL):",
    "   - Actively look for contradicting evidence",
    "   - Check if similar papers show different results",
    "   - Note any inconsistencies in methods or findings",
    "   - Patents showing prior art = potential contradiction",
    "   - If ANY contradictions found, cannot be 'Verified'",
    "",
    "7. VERIFICATION STATUS ASSIGNMENT (STRICT CRITERIA):",
    "",
    "   ✅ VERIFIED (RARE - only if ALL criteria met):",
    "      • 3+ independent sources confirm the claim",
    "      • NO contradicting evidence",
    "      • Data AND code publicly available",
    "      • Methods replicated by other groups",
    "      • Statistical rigor confirmed (adequate N, controls, p-values)",
    "      • No significant methodological limitations",
    "",
    "   ⚠️  PARTIALLY VERIFIED (MOST COMMON - default for reasonable claims):",
    "      • 1-2 supporting sources (may include same group)",
    "      • Minor contradictions, gaps, or limitations present",
    "      • Limited or no data availability",
    "      • Not independently replicated yet",
    "      • Some methodological concerns",
    "      • Evidence suggests claim is directionally correct but needs more validation",
    "",
    "   ❌ CONTRADICTED:",
    "      • Evidence actively refutes the claim",
    "      • Replication attempts failed",
    "      • Statistical or methodological flaws identified",
    "      • Contradicting papers outnumber supporting ones",
    "",
    "   ❓ INSUFFICIENT EVIDENCE:",
    "      • Less than 1 supporting source",
    "      • No independent validation available",
    "      • Missing key information needed to verify",
    "      • Claim is too vague to verify against available evidence",
    "",
    "8. CONFIDENCE LEVEL ASSIGNMENT:",
    "   - High: Only for 'Verified' claims with overwhelming evidence",
    "   - Moderate: For 'Partially Verified' with reasonable support",
    "   - Low: For 'Partially Verified' with minimal support or 'Insufficient Evidence'",
    "",
    "9. EVIDENCE DOCUMENTATION:",
    "   - List ALL supporting evidence with specific relevance notes",
    "   - List ALL contradicting evidence (actively search for these)",
    "   - Be specific about what each source contributes",
    "",
    "10. VERIFICATION SUMMARY:",
    "    - 2-3 sentences explaining status and reasoning",
    "    - Explicitly state limitations or caveats",
    "    - Note what additional evidence would strengthen verification",
    "",
    "IMPORTANT: Most claims should be 'Partially Verified'. If you mark everything as 'Verified', you are NOT being critical enough.",
    "",
    "=== DELIVERABLE ===",
    "",
    "For each claim, provide:",
    "- Claim ID (C1, C2, etc.)",
    "- Original Claim (verbatim)",
    "- Verification Status (Verified/Partially Verified/Contradicted/Insufficient Evidence)",
    "- Supporting Evidence:",
    "  * Source type (Similar Paper/Patent/Research Group/Thesis)",
    "  * Title/identifier",
    "  * Brief relevance note (how it supports)",
    "- Contradicting Evidence (if any):",
    "  * Source type",
    "  * Title/identifier",
    "  * Brief relevance note (how it contradicts)",
    "- Verification Summary (2-3 sentences explaining status and reasoning)",
    "- Confidence Level (High/Moderate/Low)",
    "",
    "Also provide:",
    "- Overall Assessment: Brief paragraph on the paper's overall claim validity",
    ""
  );

  return lines.join("\n");
}

function buildCleanupPrompt() {
  return [
    CLEANUP_PROMPT_HEADER.trim(),
    "",
    "Do not repeat the analyst notes; they remain in the message above this divider.",
    "---",
    "[Analyst notes stay above this divider]",
    "---",
    "Return the JSON object now."
  ].join("\n");
}

function normalizeEvidence(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const source = typeof entry.source === "string" ? cleanPlainText(entry.source) : "";
  const title = typeof entry.title === "string" ? cleanPlainText(entry.title) : "";
  const relevance = typeof entry.relevance === "string" ? cleanPlainText(entry.relevance) : "";

  if (!source || !title) {
    return null;
  }

  return { source, title, relevance };
}

function normalizeVerificationStatus(value) {
  if (typeof value !== "string") {
    return "Insufficient Evidence";
  }
  const normalized = value.trim();
  const valid = ["Verified", "Partially Verified", "Contradicted", "Insufficient Evidence"];
  return valid.includes(normalized) ? normalized : "Insufficient Evidence";
}

function normalizeConfidenceLevel(value) {
  if (typeof value !== "string") {
    return "Low";
  }
  const normalized = value.trim();
  const valid = ["High", "Moderate", "Low"];
  return valid.includes(normalized) ? normalized : "Low";
}

function normalizeVerifiedClaim(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const claimId = typeof entry.claimId === "string" ? entry.claimId.trim() : "";
  const originalClaim = typeof entry.originalClaim === "string" ? cleanPlainText(entry.originalClaim) : "";

  if (!claimId || !originalClaim) {
    return null;
  }

  const verificationStatus = normalizeVerificationStatus(entry.verificationStatus);
  const confidenceLevel = normalizeConfidenceLevel(entry.confidenceLevel);
  const verificationSummary = typeof entry.verificationSummary === "string"
    ? cleanPlainText(entry.verificationSummary)
    : "";

  const supportingEvidence = Array.isArray(entry.supportingEvidence)
    ? entry.supportingEvidence.map(normalizeEvidence).filter(Boolean)
    : [];

  const contradictingEvidence = Array.isArray(entry.contradictingEvidence)
    ? entry.contradictingEvidence.map(normalizeEvidence).filter(Boolean)
    : [];

  return {
    claimId,
    originalClaim,
    verificationStatus,
    supportingEvidence,
    contradictingEvidence,
    verificationSummary,
    confidenceLevel
  };
}

function normalizeVerifiedClaimsPayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Cleanup agent response must be a JSON object.");
  }

  if (!Array.isArray(payload.claims)) {
    throw new Error("claims must be an array.");
  }

  const claims = payload.claims
    .map((entry) => normalizeVerifiedClaim(entry))
    .filter(Boolean);

  if (claims.length === 0) {
    throw new Error("No valid verified claims after normalization.");
  }

  const overallAssessment = typeof payload.overallAssessment === "string"
    ? cleanPlainText(payload.overallAssessment)
    : "";

  const promptNotes = typeof payload.promptNotes === "string"
    ? cleanPlainText(payload.promptNotes)
    : "";

  return {
    claims,
    overallAssessment,
    promptNotes
  };
}

function formatVerifiedClaims(verifiedClaims) {
  const lines = [];

  if (verifiedClaims.overallAssessment) {
    lines.push("=== OVERALL ASSESSMENT ===");
    lines.push(verifiedClaims.overallAssessment);
    lines.push("");
  }

  lines.push("=== VERIFIED CLAIMS ===");
  lines.push("");

  verifiedClaims.claims.forEach((claim) => {
    lines.push(`Claim: ${claim.claimId}`);
    lines.push(`Original: ${claim.originalClaim}`);
    lines.push(`Status: ${claim.verificationStatus}`);
    lines.push(`Confidence: ${claim.confidenceLevel}`);
    lines.push("");

    if (claim.supportingEvidence.length > 0) {
      lines.push("Supporting Evidence:");
      claim.supportingEvidence.forEach((evidence) => {
        lines.push(`  - [${evidence.source}] ${evidence.title}`);
        if (evidence.relevance) {
          lines.push(`    ${evidence.relevance}`);
        }
      });
      lines.push("");
    }

    if (claim.contradictingEvidence.length > 0) {
      lines.push("Contradicting Evidence:");
      claim.contradictingEvidence.forEach((evidence) => {
        lines.push(`  - [${evidence.source}] ${evidence.title}`);
        if (evidence.relevance) {
          lines.push(`    ${evidence.relevance}`);
        }
      });
      lines.push("");
    }

    if (claim.verificationSummary) {
      lines.push(`Summary: ${claim.verificationSummary}`);
    }

    lines.push("");
  });

  return lines.join("\n");
}

async function runVerifiedClaims(options = {}) {
  const rl = createInterface();
  const workingDir = process.cwd();
  const {
    entryId: presetEntryId = null
  } = options;

  try {
    console.log("\n=== Verified Claims Prompt Helper ===\n");
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
        header: "Select the mock entry for claim verification"
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
        `\n❌ Claims analysis data missing for entry "${entryId}". Run the claims analysis generator first.`
      );
      return;
    }

    const verificationPrompt = buildVerificationPrompt(entry);
    try {
      await copyPromptToClipboard(verificationPrompt, {
        label: "Verification prompt",
        previewLength: 300
      });
    } catch (error) {
      console.warn("Failed to copy verification prompt. Printing below:\n");
      console.log(verificationPrompt);
    }

    console.log("\nPaste it into your research agent to verify claims.\n");
    console.log(
      "\nNext steps:\n  1. Paste the prompt into your research agent and let it complete.\n  2. Collect the verification notes.\n  3. Press ENTER here when you're ready for the cleanup prompt.\n"
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
      "\nNext steps:\n  1. Paste the cleanup prompt into your LLM.\n  2. Add the verification notes beneath the placeholder line, then run the cleanup.\n  3. Paste the cleaned JSON back here (press ENTER on an empty line when finished).\n"
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
      console.error("\n❌ Failed to parse the verified claims JSON. Ensure the cleanup agent returns valid JSON only.");
      console.error("Raw snippet preview:");
      console.error(cleanedJsonRaw.slice(0, 200));
      throw new Error(`Failed to parse verified claims JSON: ${error instanceof Error ? error.message : String(error)}`);
    }

    const normalised = normalizeVerifiedClaimsPayload(cleanedPayload);
    const formattedText = formatVerifiedClaims(normalised);

    const verifiedClaimsData = {
      text: formattedText,
      structured: {
        claims: normalised.claims,
        overallAssessment: normalised.overallAssessment,
        promptNotes: normalised.promptNotes
      }
    };

    entry.verifiedClaims = verifiedClaimsData;
    entry.generatedAt = entry.generatedAt ?? new Date().toISOString();

    const previousIds = library.entries.map((item) => item.id);
    upsertEntry(library, entry);
    writeLibrary(path.basename(__filename), library);

    const removedIds = previousIds.filter((id) => !library.entries.some((item) => item.id === id));
    if (removedIds.length > 0) {
      console.log(`\nNote: removed entries ${removedIds.join(", ")} to maintain the ${MAX_ENTRIES}-entry limit.`);
    }

    console.log(`\nMock library updated with verified claims for entry "${entryId}".`);
    console.log(`\nVerified ${normalised.claims.length} claim(s).`);
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
  runVerifiedClaims
};

if (require.main === module) {
  runVerifiedClaims().catch(() => {
    process.exitCode = 1;
  });
}
