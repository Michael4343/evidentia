import { NextResponse } from "next/server";

export const runtime = "nodejs";

type VerifiedStatus = "Verified" | "Partially Verified" | "Contradicted" | "Insufficient Evidence";
type VerifiedConfidence = "High" | "Moderate" | "Low";

type SimilarPaperEntry = {
  identifier?: string | null;
  title?: string | null;
  authors?: string[] | null;
  year?: number | null;
  whyRelevant?: string | null;
  overlapHighlights?: string[] | null;
};

type SimilarPapersStructured = {
  similarPapers?: SimilarPaperEntry[] | null;
};

type ResearchGroupResearcher = {
  name?: string | null;
  email?: string | null;
  role?: string | null;
};

type ResearchGroupEntry = {
  name?: string | null;
  institution?: string | null;
  website?: string | null;
  notes?: string | null;
  researchers?: ResearchGroupResearcher[] | null;
};

type ResearchGroupsPaper = {
  title?: string | null;
  identifier?: string | null;
  groups?: ResearchGroupEntry[] | null;
};

type ResearchGroupsStructured = {
  papers?: ResearchGroupsPaper[] | null;
};

type ResearcherThesisRecord = {
  name?: string | null;
  email?: string | null;
  group?: string | null;
  latest_publication?: {
    title?: string | null;
    year?: number | null;
    venue?: string | null;
  } | null;
  phd_thesis?: {
    title?: string | null;
    year?: number | null;
    institution?: string | null;
  } | null;
  data_publicly_available?: "yes" | "no" | "unknown" | string | null;
};

type PatentsStructured = {
  patents?: Array<{
    patentNumber?: string | null;
    title?: string | null;
    assignee?: string | null;
    filingDate?: string | null;
    grantDate?: string | null;
    overlapWithPaper?: {
      claimIds?: string[] | null;
      summary?: string | null;
    } | null;
  }> | null;
  promptNotes?: string | null;
};

type ClaimsStructured = {
  claims?: Array<{
    id?: string | null;
    claim?: string | null;
    evidenceSummary?: string | null;
    strength?: string | null;
  }> | null;
  executiveSummary?: string[] | null;
};

type ClaimsPayload = {
  text?: string | null;
  structured?: ClaimsStructured | null;
};

type BodyPayload = {
  paper?: {
    title?: string | null;
    doi?: string | null;
  } | null;
  claims?: ClaimsPayload | null;
  similarPapers?: {
    text?: string | null;
    structured?: SimilarPapersStructured | null;
  } | null;
  researchGroups?: {
    text?: string | null;
    structured?: ResearchGroupsStructured | null;
  } | null;
  theses?: {
    text?: string | null;
    structured?: ResearcherThesisRecord[] | null;
  } | null;
  patents?: {
    text?: string | null;
    structured?: PatentsStructured | null;
  } | null;
};

type VerifiedClaimEvidence = {
  source: string;
  title: string;
  relevance?: string | null;
};

type VerifiedClaimEntry = {
  claimId: string;
  originalClaim: string;
  verificationStatus: VerifiedStatus;
  supportingEvidence: VerifiedClaimEvidence[];
  contradictingEvidence: VerifiedClaimEvidence[];
  verificationSummary?: string | null;
  confidenceLevel: VerifiedConfidence;
};

type VerifiedClaimsStructured = {
  claims: VerifiedClaimEntry[];
  overallAssessment?: string | null;
  promptNotes?: string | null;
};

const EVIDENCE_SOURCE_ALIASES = new Map<string, string>([
  ["similar paper", "Similar Paper"],
  ["similar papers", "Similar Paper"],
  ["paper", "Similar Paper"],
  ["research group", "Research Group"],
  ["research groups", "Research Group"],
  ["group", "Research Group"],
  ["patent", "Patent"],
  ["patents", "Patent"],
  ["thesis", "Thesis"],
  ["phd thesis", "Thesis"],
  ["theses", "Thesis"]
]);

const EVIDENCE_PLACEHOLDER_PATTERN = /^(?:none(?:\s+found)?|no\s+(?:relevant\s+)?(?:evidence|contradictions?)|not\s+(?:provided|reported)|n\/?a)$/i;

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

function cleanPlainText(input: unknown): string {
  if (typeof input !== "string") {
    return "";
  }

  return input
    .replace(/\r\n/g, "\n")
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2013\u2014\u2015\u2212]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ")
    .replace(/[\u200B-\u200F\uFEFF]/g, "")
    .trim();
}

function canonicaliseEvidenceSource(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.replace(/[\[\]]/g, "").trim();
  if (!normalized) {
    return null;
  }
  const alias = EVIDENCE_SOURCE_ALIASES.get(normalized.toLowerCase());
  if (alias) {
    return alias;
  }
  const canonical = normalized.charAt(0).toUpperCase() + normalized.slice(1);
  return canonical;
}

function stripLeadingEvidenceMarker(value: string): string {
  return value.replace(/^(?:[-*\u2022]+|\d+\.)\s*/, "").trim();
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isEvidencePlaceholder(value: string): boolean {
  return EVIDENCE_PLACEHOLDER_PATTERN.test(value.trim());
}

function formatArray(values: unknown, mapper: (value: any, index: number) => string | null): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  const output: string[] = [];
  values.forEach((item, index) => {
    const mapped = mapper(item, index);
    if (mapped && mapped.trim().length > 0) {
      output.push(mapped.trim());
    }
  });
  return output;
}

function formatObjectArray<T>(values: unknown, mapper: (value: any, index: number) => T | null): T[] {
  if (!Array.isArray(values)) {
    return [];
  }
  const output: T[] = [];
  values.forEach((item, index) => {
    const mapped = mapper(item, index);
    if (mapped !== null) {
      output.push(mapped);
    }
  });
  return output;
}

function summariseSimilarPapers(structured?: SimilarPapersStructured | null): string[] {
  if (!structured || !Array.isArray(structured.similarPapers)) {
    return ["SIMILAR PAPERS: None available"];
  }

  const lines: string[] = ["SIMILAR PAPERS:"];
  structured.similarPapers.forEach((paper, index) => {
    if (!paper) {
      return;
    }
    const title = cleanPlainText(paper.title) || "Untitled";
    lines.push(`Paper ${index + 1}: ${title}`);
    if (Array.isArray(paper.authors) && paper.authors.length > 0) {
      lines.push(`  Authors: ${paper.authors.join(", ")}`);
    }
    if (typeof paper.year === "number") {
      lines.push(`  Year: ${paper.year}`);
    }
    const whyRelevant = cleanPlainText(paper.whyRelevant);
    if (whyRelevant) {
      lines.push(`  Relevance: ${whyRelevant}`);
    }
    const highlights = formatArray(paper.overlapHighlights, (item) => (typeof item === "string" ? item : null));
    if (highlights.length > 0) {
      lines.push(`  Key Findings: ${highlights.join("; ")}`);
    }
    lines.push("");
  });

  if (lines.length === 1) {
    return ["SIMILAR PAPERS: None available"];
  }
  return lines;
}

function summariseResearchGroups(structured?: ResearchGroupsStructured | null): string[] {
  if (!structured || !Array.isArray(structured.papers) || structured.papers.length === 0) {
    return ["RESEARCH GROUPS: None available"];
  }

  const lines: string[] = ["RESEARCH GROUPS:"];
  structured.papers.forEach((paper, index) => {
    const title = cleanPlainText(paper?.title) || "Unknown paper";
    lines.push(`Research Context ${index + 1}: ${title}`);
    if (Array.isArray(paper?.groups)) {
      paper!.groups!.forEach((group) => {
        if (!group) {
          return;
        }
        const groupName = cleanPlainText(group.name) || "Unnamed";
        lines.push(`  Group: ${groupName}`);
        const institution = cleanPlainText(group.institution);
        if (institution) {
          lines.push(`    Institution: ${institution}`);
        }
        const notes = cleanPlainText(group.notes);
        if (notes) {
          lines.push(`    Focus: ${notes}`);
        }
      });
    }
    lines.push("");
  });

  return lines;
}

function summariseTheses(records?: ResearcherThesisRecord[] | null): string[] {
  if (!Array.isArray(records) || records.length === 0) {
    return ["PHD THESES: None available"];
  }

  const lines: string[] = ["PHD THESES:"];
  records.forEach((record, index) => {
    if (!record) {
      return;
    }
    const name = cleanPlainText(record.name) || "Unknown";
    lines.push(`Researcher ${index + 1}: ${name}`);
    if (record.phd_thesis) {
      const thesisTitle = cleanPlainText(record.phd_thesis.title) || "Not found";
      lines.push(`  Thesis: ${thesisTitle}`);
      if (typeof record.phd_thesis.year === "number") {
        lines.push(`  Year: ${record.phd_thesis.year}`);
      }
      const thesisInstitution = cleanPlainText(record.phd_thesis.institution);
      if (thesisInstitution) {
        lines.push(`  Institution: ${thesisInstitution}`);
      }
    }
    if (record.latest_publication) {
      const pubTitle = cleanPlainText(record.latest_publication.title);
      if (pubTitle) {
        lines.push(`  Latest Publication: ${pubTitle}`);
      }
    }
    const dataAvailability = cleanPlainText(record.data_publicly_available);
    if (dataAvailability) {
      lines.push(`  Data Available: ${dataAvailability}`);
    }
    lines.push("");
  });

  return lines;
}

function summarisePatents(structured?: PatentsStructured | null): string[] {
  if (!structured || !Array.isArray(structured.patents) || structured.patents.length === 0) {
    return ["RELATED PATENTS: None available"];
  }

  const lines: string[] = ["RELATED PATENTS:"];
  structured.patents.forEach((patent, index) => {
    if (!patent) {
      return;
    }
    const number = cleanPlainText(patent.patentNumber) || "Unknown";
    const title = cleanPlainText(patent.title) || "Untitled";
    lines.push(`Patent ${index + 1}: ${number}`);
    lines.push(`  Title: ${title}`);
    const assignee = cleanPlainText(patent.assignee);
    if (assignee) {
      lines.push(`  Assignee: ${assignee}`);
    }
    const claimIds = Array.isArray(patent.overlapWithPaper?.claimIds)
      ? patent.overlapWithPaper?.claimIds.filter((claim) => typeof claim === "string" && claim.trim().length > 0)
      : [];
    if (claimIds && claimIds.length > 0) {
      lines.push(`  Overlaps with claims: ${claimIds.join(", ")}`);
    }
    const summary = cleanPlainText(patent.overlapWithPaper?.summary);
    if (summary) {
      lines.push(`  Technical Overlap: ${summary}`);
    }
    lines.push("");
  });

  return lines;
}

function buildClaimsSection(claims: ClaimsPayload): string[] {
  const structured = claims.structured;
  const items = Array.isArray(structured?.claims) ? structured!.claims! : [];

  if (items.length === 0) {
    return ["No structured claims were provided. Abort if you cannot proceed."];
  }

  const lines: string[] = [];
  items.forEach((claim) => {
    if (!claim) {
      return;
    }
    const id = cleanPlainText(claim.id) || "Unnamed claim";
    const text = cleanPlainText(claim.claim) || cleanPlainText(claim.evidenceSummary) || "Claim text not provided.";
    lines.push(`${id}: ${text}`);
    const strength = cleanPlainText(claim.strength);
    if (strength) {
      lines.push(`   Original Strength: ${strength}`);
    }
    const evidenceSummary = cleanPlainText(claim.evidenceSummary);
    if (evidenceSummary) {
      lines.push(`   Evidence: ${evidenceSummary}`);
    }
    lines.push("");
  });

  return lines;
}

function buildVerificationPrompt(payload: BodyPayload, claims: ClaimsPayload): string {
  const lines: string[] = [];
  const paperTitle = cleanPlainText(payload.paper?.title) || "Unknown paper";
  const paperDoi = cleanPlainText(payload.paper?.doi);

  lines.push(
    "You are a scientific claim verification analyst.",
    "",
    "Verify Paper Claims Against All Available Evidence",
    "",
    `Paper: ${paperTitle}`
  );

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

  lines.push(...buildClaimsSection(claims));

  lines.push("=== AVAILABLE EVIDENCE ===", "");

  lines.push(...summariseSimilarPapers(payload.similarPapers?.structured));
  lines.push("", ...summariseResearchGroups(payload.researchGroups?.structured));
  lines.push("", ...summariseTheses(payload.theses?.structured));
  lines.push("", ...summarisePatents(payload.patents?.structured));

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
    "- Overall Assessment: Brief paragraph on the paper's overall claim validity"
  );

  const claimsText = cleanPlainText(claims.text);
  if (claimsText) {
    lines.push("", "Claims brief (verbatim for reference):", claimsText);
  }

  return lines.join("\n");
}

function buildCleanupPrompt(analystNotes: string): string {
  const trimmedNotes = analystNotes.trim();
  return [
    CLEANUP_PROMPT_HEADER.trim(),
    "",
    "The analyst notes are provided below. Do not copy them into the JSON—only use them for reference.",
    "--- ANALYST NOTES ---",
    trimmedNotes,
    "---",
    "Return the JSON object now."
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function stripMarkdownFences(payload: string): string {
  return payload.replace(/^```json\s*\n?|\n?```\s*$/g, "").trim();
}

function normaliseEvidence(entry: any): VerifiedClaimEvidence | null {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  let sourceCandidate = cleanPlainText(entry.source);
  let title = cleanPlainText(entry.title);
  let relevanceRaw = cleanPlainText(entry.relevance);

  const bracketMatch = title.match(/^\[(Similar Paper|Research Group|Patent|Thesis)\]\s*/i);
  if (bracketMatch) {
    if (!sourceCandidate) {
      sourceCandidate = bracketMatch[1];
    }
    title = title.slice(bracketMatch[0].length).trim();
  }

  const labelledMatch = title.match(/^(Similar Paper|Research Group|Patent|Thesis)\s*(?:\u2014|\u2013|-|:)\s*/i);
  if (labelledMatch) {
    if (!sourceCandidate) {
      sourceCandidate = labelledMatch[1];
    }
    title = title.slice(labelledMatch[0].length).trim();
  }

  title = stripLeadingEvidenceMarker(title);
  title = collapseWhitespace(title);

  if (!title || isEvidencePlaceholder(title)) {
    return null;
  }

  let source = canonicaliseEvidenceSource(sourceCandidate);
  if (!source) {
    source = canonicaliseEvidenceSource(bracketMatch?.[1]);
  }
  if (!source && labelledMatch?.[1]) {
    source = canonicaliseEvidenceSource(labelledMatch[1]);
  }
  if (!source) {
    source = "Similar Paper";
  }

  if (relevanceRaw) {
    relevanceRaw = collapseWhitespace(relevanceRaw);
  }

  const relevance = relevanceRaw && !isEvidencePlaceholder(relevanceRaw) ? relevanceRaw : "";

  return {
    source,
    title,
    ...(relevance ? { relevance } : {})
  };
}

function normaliseStatus(value: unknown): VerifiedStatus {
  const normalized = cleanPlainText(value);
  const valid: VerifiedStatus[] = ["Verified", "Partially Verified", "Contradicted", "Insufficient Evidence"];
  return valid.includes(normalized as VerifiedStatus) ? (normalized as VerifiedStatus) : "Insufficient Evidence";
}

function normaliseConfidence(value: unknown): VerifiedConfidence {
  const normalized = cleanPlainText(value);
  const valid: VerifiedConfidence[] = ["High", "Moderate", "Low"];
  return valid.includes(normalized as VerifiedConfidence) ? (normalized as VerifiedConfidence) : "Low";
}

function normaliseVerifiedClaim(entry: any): VerifiedClaimEntry | null {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const claimId = cleanPlainText(entry.claimId);
  const originalClaim = cleanPlainText(entry.originalClaim);

  if (!claimId || !originalClaim) {
    return null;
  }

  const supportingEvidence = formatObjectArray<VerifiedClaimEvidence>(entry.supportingEvidence, normaliseEvidence);
  const contradictingEvidence = formatObjectArray<VerifiedClaimEvidence>(entry.contradictingEvidence, normaliseEvidence);
  const verificationSummary = cleanPlainText(entry.verificationSummary);

  return {
    claimId,
    originalClaim,
    verificationStatus: normaliseStatus(entry.verificationStatus),
    supportingEvidence,
    contradictingEvidence,
    ...(verificationSummary ? { verificationSummary } : {}),
    confidenceLevel: normaliseConfidence(entry.confidenceLevel)
  };
}

function normaliseVerifiedClaimsPayload(payload: any): VerifiedClaimsStructured {
  if (!payload || typeof payload !== "object") {
    throw new Error("Cleanup agent response must be a JSON object.");
  }

  if (!Array.isArray(payload.claims)) {
    throw new Error("claims must be an array.");
  }

  const claims = payload.claims
    .map((entry: any) => normaliseVerifiedClaim(entry))
    .filter(Boolean) as VerifiedClaimEntry[];

  if (claims.length === 0) {
    throw new Error("No valid verified claims after normalization.");
  }

  const overallAssessment = cleanPlainText(payload.overallAssessment) || null;
  const promptNotes = cleanPlainText(payload.promptNotes) || null;

  return {
    claims,
    ...(overallAssessment ? { overallAssessment } : {}),
    ...(promptNotes ? { promptNotes } : {})
  };
}

function formatVerifiedClaims(structured: VerifiedClaimsStructured): string {
  const lines: string[] = [];

  if (structured.overallAssessment) {
    lines.push("=== OVERALL ASSESSMENT ===");
    lines.push(structured.overallAssessment);
    lines.push("");
  }

  lines.push("=== VERIFIED CLAIMS ===", "");

  structured.claims.forEach((claim) => {
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

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as BodyPayload | null;

    if (!body || !body.claims || typeof body.claims !== "object") {
      return NextResponse.json({ error: "Claims data is required." }, { status: 400 });
    }

    const claims = body.claims;
    if (!claims.text || typeof claims.text !== "string" || claims.text.trim().length === 0) {
      return NextResponse.json({ error: "Claims text is required." }, { status: 400 });
    }

    if (!claims.structured || typeof claims.structured !== "object") {
      return NextResponse.json({ error: "Structured claims are required." }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error("[verified-claims] OPENAI_API_KEY is not configured.");
      return NextResponse.json({ error: "OpenAI API key is not configured." }, { status: 500 });
    }

    const discoveryPrompt = buildVerificationPrompt(body, claims);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      console.warn("[verified-claims] Discovery request timed out after 600 seconds");
      controller.abort();
    }, 600_000);

    let discoveryResponse: Response;

    try {
      discoveryResponse = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: "gpt-5-mini-2025-08-07",
          reasoning: { effort: "low" },
          input: discoveryPrompt,
          max_output_tokens: 9_216
        }),
        signal: controller.signal
      });
    } catch (error) {
      clearTimeout(timeoutId);
      const message = error instanceof Error ? error.message : String(error);
      console.error("[verified-claims] Discovery fetch failed", message);
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }

    if (!discoveryResponse.ok) {
      let message = "OpenAI request failed.";
      try {
        const errorPayload = await discoveryResponse.json();
        console.error("[verified-claims] Discovery error payload", errorPayload);
        if (typeof errorPayload?.error === "string") {
          message = errorPayload.error;
        } else if (typeof errorPayload?.message === "string") {
          message = errorPayload.message;
        }
      } catch (parseError) {
        console.warn("[verified-claims] Failed to parse discovery error payload", parseError);
      }
      return NextResponse.json({ error: message }, { status: discoveryResponse.status });
    }

    let discoveryPayload: any;
    try {
      discoveryPayload = await discoveryResponse.json();
    } catch (parseError) {
      console.error("[verified-claims] Failed to parse discovery response", parseError);
      return NextResponse.json({ error: "Failed to read verified claims discovery response." }, { status: 502 });
    }

    let discoveryText = typeof discoveryPayload?.output_text === "string" ? discoveryPayload.output_text.trim() : "";
    if (!discoveryText && Array.isArray(discoveryPayload?.output)) {
      discoveryText = discoveryPayload.output
        .filter((item: any) => item && item.type === "message" && Array.isArray(item.content))
        .flatMap((item: any) =>
          item.content
            .filter((part: any) => part?.type === "output_text" && typeof part.text === "string")
            .map((part: any) => part.text)
        )
        .join("\n")
        .trim();
    }

    if (discoveryPayload?.status === "incomplete" && discoveryPayload?.incomplete_details?.reason) {
      console.warn("[verified-claims] Discovery response incomplete", discoveryPayload.incomplete_details);
      if (discoveryText) {
        discoveryText = `${discoveryText}\n\n[Note: Response truncated because the model hit its output limit. Consider rerunning if key details are missing.]`;
      } else {
        return NextResponse.json(
          {
            error:
              discoveryPayload.incomplete_details.reason === "max_output_tokens"
                ? "Verified claims analysis hit the output limit before completing. Try again in a moment."
                : `Verified claims analysis ended early: ${discoveryPayload.incomplete_details.reason}`
          },
          { status: 502 }
        );
      }
    }

    if (!discoveryText) {
      console.error("[verified-claims] Empty discovery response", discoveryPayload);
      return NextResponse.json({ error: "Model did not return any verified claims notes." }, { status: 502 });
    }

    const cleanupPrompt = buildCleanupPrompt(discoveryText);

    const controller2 = new AbortController();
    const timeoutId2 = setTimeout(() => {
      console.warn("[verified-claims] Cleanup request timed out after 600 seconds");
      controller2.abort();
    }, 600_000);

    let cleanupResponse: Response;

    try {
      cleanupResponse = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: "gpt-5-mini-2025-08-07",
          reasoning: { effort: "low" },
          input: cleanupPrompt,
          max_output_tokens: 9_216
        }),
        signal: controller2.signal
      });
    } catch (error) {
      clearTimeout(timeoutId2);
      const message = error instanceof Error ? error.message : String(error);
      console.error("[verified-claims] Cleanup fetch failed", message);
      throw error;
    } finally {
      clearTimeout(timeoutId2);
    }

    if (!cleanupResponse.ok) {
      let message = "OpenAI cleanup request failed.";
      try {
        const errorPayload = await cleanupResponse.json();
        console.error("[verified-claims] Cleanup error payload", errorPayload);
        if (typeof errorPayload?.error === "string") {
          message = errorPayload.error;
        } else if (typeof errorPayload?.message === "string") {
          message = errorPayload.message;
        }
      } catch (parseError) {
        console.warn("[verified-claims] Failed to parse cleanup error payload", parseError);
      }
      return NextResponse.json({ error: message }, { status: cleanupResponse.status });
    }

    let cleanupPayload: any;
    try {
      cleanupPayload = await cleanupResponse.json();
    } catch (parseError) {
      console.error("[verified-claims] Failed to parse cleanup response", parseError);
      return NextResponse.json({ error: "Failed to read verified claims cleanup response." }, { status: 502 });
    }

    let cleanupText = typeof cleanupPayload?.output_text === "string" ? cleanupPayload.output_text.trim() : "";
    if (!cleanupText && Array.isArray(cleanupPayload?.output)) {
      cleanupText = cleanupPayload.output
        .filter((item: any) => item && item.type === "message" && Array.isArray(item.content))
        .flatMap((item: any) =>
          item.content
            .filter((part: any) => part?.type === "output_text" && typeof part.text === "string")
            .map((part: any) => part.text)
        )
        .join("\n")
        .trim();
    }

    if (!cleanupText) {
      console.error("[verified-claims] Empty cleanup response", cleanupPayload);
      return NextResponse.json({ error: "Model did not return verified claims JSON." }, { status: 502 });
    }

    let structured: VerifiedClaimsStructured | null = null;
    try {
      const parsed = JSON.parse(stripMarkdownFences(cleanupText));
      structured = normaliseVerifiedClaimsPayload(parsed);
    } catch (parseError) {
      console.error("[verified-claims] Failed to parse structured verified claims JSON", parseError);
      console.error("[verified-claims] Raw cleanup output:", cleanupText);
      return NextResponse.json({ text: discoveryText, structured: null });
    }

    const formattedText = formatVerifiedClaims(structured);

    return NextResponse.json({
      text: formattedText,
      structured
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    console.error("[verified-claims] Error:", error);
    return NextResponse.json({ error: `Failed to generate verified claims: ${message}` }, { status: 500 });
  }
}
