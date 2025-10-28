import { NextResponse } from "next/server";

export const runtime = "nodejs";

interface ClaimsPayload {
  text?: string | null;
  structured?: ClaimsStructured | null;
}

interface ClaimsStructured {
  claims?: Array<ClaimItem | null> | null;
  executiveSummary?: string[] | null;
  methodsSnapshot?: string[] | null;
}

interface ClaimItem {
  id?: string | null;
  claim?: string | null;
  evidenceSummary?: string | null;
  evidenceType?: string | null;
  strength?: string | null;
}

interface PaperPayload {
  title?: string | null;
  doi?: string | null;
  authors?: Array<string | { name?: string | null }> | string | null;
  abstract?: string | null;
}

interface PatentStructuredEntry {
  patentNumber?: string | null;
  title?: string | null;
  assignee?: string | null;
  filingDate?: string | null;
  grantDate?: string | null;
  abstract?: string | null;
  url?: string | null;
  overlapWithPaper?: {
    claimIds?: string[] | null;
    summary?: string | null;
  } | null;
}

interface PatentStructuredPayload {
  patents?: PatentStructuredEntry[];
  promptNotes?: string | null;
}

function cleanPlainText(input: unknown): string {
  if (typeof input !== "string") {
    return "";
  }
  return input.replace(/\r\n/g, "\n").trim();
}

function limitList(items: unknown, limit: number): string[] {
  if (!Array.isArray(items)) {
    return [];
  }
  return items
    .map((item) => (typeof item === "string" ? cleanPlainText(item) : ""))
    .filter((item) => item.length > 0)
    .slice(0, limit);
}

function toClaimLine(claim: ClaimItem, index: number): string {
  const id = typeof claim.id === "string" && claim.id.trim().length > 0 ? claim.id.trim() : `C${index + 1}`;
  const claimText = cleanPlainText(claim.claim || claim.evidenceSummary || "Claim text not provided.");
  const evidenceType = cleanPlainText(claim.evidenceType);
  const strength = cleanPlainText(claim.strength);

  const segments = [`${id}: ${claimText}`];
  if (evidenceType) {
    segments.push(`Evidence type: ${evidenceType}`);
  }
  if (strength) {
    segments.push(`Strength: ${strength}`);
  }

  return segments.join("\n");
}

function buildPatentDiscoveryPrompt(paper: PaperPayload, claims: ClaimsPayload): string {
  const lines: string[] = [];

  lines.push(
    "Objective: Identify 3-5 patents that validate the paper's claims through substantive technical overlap.",
    "",
    "Context: You have a claims brief from a scientific paper. Search patent databases to find granted patents and published applications that cover similar technical approaches. Focus on validation evidence—patents that demonstrate the paper's methods have been independently developed and claimed in the patent literature.",
    "",
    "Inputs:",
    ""
  );

  const title = cleanPlainText(paper.title) || "Unknown paper";
  lines.push(`Paper: ${title}`);

  const doi = cleanPlainText(paper.doi);
  if (doi) {
    lines.push(`DOI: ${doi}`);
  }

  const abstract = cleanPlainText(paper.abstract);
  if (abstract) {
    const truncated = abstract.length > 1_200 ? `${abstract.slice(0, 1_200)}…` : abstract;
    lines.push("", "Abstract:");
    lines.push(truncated, "");
  }

  const methodHighlights = limitList(claims.structured?.methodsSnapshot ?? null, 5);
  if (methodHighlights.length > 0) {
    lines.push("Method snapshot (claims brief cues):");
    methodHighlights.forEach((entry) => {
      lines.push(`- ${entry}`);
    });
    lines.push("");
  }

  const summaryLines = limitList(claims.structured?.executiveSummary ?? null, 3);
  if (summaryLines.length > 0) {
    lines.push("Claims brief summary cues:");
    summaryLines.forEach((entry) => {
      lines.push(`- ${entry}`);
    });
    lines.push("");
  }

  lines.push("Claims from the paper:", "");

  const claimItems = Array.isArray(claims.structured?.claims)
    ? claims.structured?.claims.filter((entry): entry is ClaimItem => Boolean(entry && typeof entry === "object"))
    : [];

  if (claimItems.length === 0) {
    lines.push("No structured claims were provided. Abort if you cannot proceed.");
  } else {
    claimItems.slice(0, 12).forEach((claim, index) => {
      lines.push(toClaimLine(claim, index), "");
    });
  }

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
    "7. If fewer than 3 patents have substantive overlap, return what you find and note which claims lack patent coverage."
  );

  const claimsText = cleanPlainText(claims.text);
  if (claimsText) {
    lines.push("", "Claims brief (verbatim for reference):", claimsText);
  }

  return lines.join("\n").trim();
}

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

function buildCleanupPrompt(discoveryNotes: string): string {
  return `${CLEANUP_PROMPT_HEADER}\n\nAnalyst's patent research notes:\n\n${discoveryNotes}`;
}

/**
 * Execute a single OpenAI API call with timeout and error handling
 */
async function callOpenAI(
  prompt: string,
  options: {
    apiKey: string;
    timeout?: number;
    maxTokens?: number;
    useWebSearch?: boolean;
  }
): Promise<string> {
  const { apiKey, timeout = 600_000, maxTokens = 8_192, useWebSearch = false } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const requestBody: any = {
      model: "gpt-5-mini-2025-08-07",
      reasoning: { effort: "low" },
      input: prompt,
      max_output_tokens: maxTokens
    };

    if (useWebSearch) {
      requestBody.tools = [{ type: "web_search", search_context_size: "medium" }];
      requestBody.tool_choice = "auto";
    }

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });

    if (!response.ok) {
      let message = "OpenAI request failed.";
      try {
        const errorPayload = await response.json();
        if (typeof errorPayload?.error === "string") {
          message = errorPayload.error;
        } else if (typeof errorPayload?.message === "string") {
          message = errorPayload.message;
        }
      } catch {
        // Ignore parse errors
      }
      throw new Error(message);
    }

    const payload = await response.json();
    let outputText = typeof payload?.output_text === "string" ? payload.output_text.trim() : "";

    if (!outputText && Array.isArray(payload?.output)) {
      outputText = payload.output
        .filter((item: any) => item && item.type === "message" && Array.isArray(item.content))
        .flatMap((item: any) =>
          item.content
            .filter((part: any) => part?.type === "output_text" && typeof part.text === "string")
            .map((part: any) => part.text)
        )
        .join("\n")
        .trim();
    }

    if (payload?.status === "incomplete" && payload?.incomplete_details?.reason) {
      if (outputText) {
        outputText = `${outputText}\n\n[Note: Response truncated because the model hit its output limit.]`;
      } else {
        throw new Error(
          payload.incomplete_details.reason === "max_output_tokens"
            ? "Request hit the output limit before completing."
            : `Request ended early: ${payload.incomplete_details.reason}`
        );
      }
    }

    if (!outputText) {
      throw new Error("Model did not return any text.");
    }

    return outputText;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Request timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function stripMarkdownFences(payload: string): string {
  return payload.replace(/^```json\s*\n?|\n?```\s*$/g, "").trim();
}

function sanitizeJsonString(input: string): string {
  return input
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")   // curly single quotes → ASCII '
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')   // curly double quotes → ASCII "
    .replace(/[\u2013\u2014\u2015\u2212]/g, "-")   // em-dash, en-dash → ASCII -
    .replace(/\u2026/g, "...")                     // ellipsis → ...
    .replace(/\u00A0/g, " ")                       // non-breaking space → space
    .replace(/[\u200B-\u200F\uFEFF]/g, "")         // zero-width spaces → remove
    .trim();
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);

    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    if (!body.claims || typeof body.claims !== "object") {
      return NextResponse.json({ error: "Claims data is required." }, { status: 400 });
    }

    const claims = body.claims as ClaimsPayload;

    if (!claims.text || typeof claims.text !== "string" || claims.text.trim().length === 0) {
      return NextResponse.json({ error: "Claims text is required." }, { status: 400 });
    }

    if (!claims.structured || typeof claims.structured !== "object") {
      return NextResponse.json({ error: "Structured claims are required." }, { status: 400 });
    }

    const paper: PaperPayload =
      body.paper && typeof body.paper === "object"
        ? {
            title: typeof body.paper.title === "string" ? body.paper.title : null,
            doi: typeof body.paper.doi === "string" ? body.paper.doi : null,
            authors: Array.isArray(body.paper.authors) || typeof body.paper.authors === "string"
              ? body.paper.authors
              : null,
            abstract: typeof body.paper.abstract === "string" ? body.paper.abstract : null
          }
        : {};

    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      console.error("[patents] OPENAI_API_KEY is not configured.");
      return NextResponse.json({ error: "OpenAI API key is not configured." }, { status: 500 });
    }

    const discoveryPrompt = buildPatentDiscoveryPrompt(paper, claims);

    let discoveryText: string;
    try {
      discoveryText = await callOpenAI(discoveryPrompt, {
        apiKey,
        timeout: 600_000,
        maxTokens: 6_144,
        useWebSearch: true
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Discovery request failed.";
      console.error("[patents] Discovery failed:", error);
      return NextResponse.json({ error: `Patent discovery failed: ${message}` }, { status: 502 });
    }

    const cleanupPrompt = buildCleanupPrompt(discoveryText);

    let cleanupText: string;
    try {
      cleanupText = await callOpenAI(cleanupPrompt, {
        apiKey,
        timeout: 600_000,
        maxTokens: 16_384,
        useWebSearch: false
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Cleanup request failed.";
      console.error("[patents] Cleanup failed:", error);
      return NextResponse.json({ error: `Patent cleanup failed: ${message}` }, { status: 502 });
    }

    console.log("[patents] Cleanup raw length", cleanupText.length);
    console.log("[patents] Cleanup preview", cleanupText.slice(0, 1200));

    let structured: PatentStructuredPayload | null = null;
    try {
      const cleaned = stripMarkdownFences(cleanupText);
      const sanitized = sanitizeJsonString(cleaned);
      const parsed = JSON.parse(sanitized);
      if (parsed && typeof parsed === "object") {
        structured = parsed as PatentStructuredPayload;
      }
    } catch (parseError) {
      console.error("[patents] Failed to parse structured patent JSON", parseError);
      console.error("[patents] Raw cleanup output:", cleanupText);
      // Return error instead of silent fallback
      return NextResponse.json(
        { error: "Failed to parse patent results. The JSON response was malformed or truncated." },
        { status: 502 }
      );
    }

    return NextResponse.json({
      text: discoveryText,
      structured
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    console.error("[patents] Error:", error);
    return NextResponse.json({ error: `Failed to generate patents: ${message}` }, { status: 500 });
  }
}
