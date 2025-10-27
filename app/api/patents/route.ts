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

function stripMarkdownFences(payload: string): string {
  return payload.replace(/^```json\s*\n?|\n?```\s*$/g, "").trim();
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

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      console.warn("[patents] Discovery request timed out after 600 seconds");
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
          max_output_tokens: 6_144
        }),
        signal: controller.signal
      });
    } catch (error) {
      clearTimeout(timeoutId);
      const message = error instanceof Error ? error.message : String(error);
      console.error("[patents] Discovery fetch failed", message);
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }

    if (!discoveryResponse.ok) {
      let message = "OpenAI request failed.";
      try {
        const errorPayload = await discoveryResponse.json();
        console.error("[patents] Discovery error payload", errorPayload);
        if (typeof errorPayload?.error === "string") {
          message = errorPayload.error;
        } else if (typeof errorPayload?.message === "string") {
          message = errorPayload.message;
        }
      } catch (parseError) {
        console.warn("[patents] Failed to parse discovery error payload", parseError);
      }
      return NextResponse.json({ error: message }, { status: discoveryResponse.status });
    }

    let discoveryPayload: any;

    try {
      discoveryPayload = await discoveryResponse.json();
    } catch (parseError) {
      console.error("[patents] Failed to parse discovery response", parseError);
      return NextResponse.json({ error: "Failed to read patent discovery response." }, { status: 502 });
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
      console.warn("[patents] Discovery response incomplete", discoveryPayload.incomplete_details);
      if (discoveryText) {
        discoveryText = `${discoveryText}\n\n[Note: Response truncated because the model hit its output limit. Consider rerunning if key details are missing.]`;
      } else {
        return NextResponse.json(
          {
            error:
              discoveryPayload.incomplete_details.reason === "max_output_tokens"
                ? "Patent search hit the output limit before completing. Try again in a moment."
                : `Patent search ended early: ${discoveryPayload.incomplete_details.reason}`
          },
          { status: 502 }
        );
      }
    }

    if (!discoveryText) {
      console.error("[patents] Empty discovery response", discoveryPayload);
      return NextResponse.json({ error: "Model did not return any patent notes." }, { status: 502 });
    }

    const cleanupPrompt = buildCleanupPrompt(discoveryText);

    const controller2 = new AbortController();
    const timeoutId2 = setTimeout(() => {
      console.warn("[patents] Cleanup request timed out after 600 seconds");
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
          max_output_tokens: 8_192
        }),
        signal: controller2.signal
      });
    } catch (error) {
      clearTimeout(timeoutId2);
      const message = error instanceof Error ? error.message : String(error);
      console.error("[patents] Cleanup fetch failed", message);
      throw error;
    } finally {
      clearTimeout(timeoutId2);
    }

    if (!cleanupResponse.ok) {
      let message = "OpenAI cleanup request failed.";
      try {
        const errorPayload = await cleanupResponse.json();
        console.error("[patents] Cleanup error payload", errorPayload);
        if (typeof errorPayload?.error === "string") {
          message = errorPayload.error;
        } else if (typeof errorPayload?.message === "string") {
          message = errorPayload.message;
        }
      } catch (parseError) {
        console.warn("[patents] Failed to parse cleanup error payload", parseError);
      }
      return NextResponse.json({ error: message }, { status: cleanupResponse.status });
    }

    let cleanupPayload: any;

    try {
      cleanupPayload = await cleanupResponse.json();
    } catch (parseError) {
      console.error("[patents] Failed to parse cleanup response", parseError);
      return NextResponse.json({ error: "Failed to read patent cleanup response." }, { status: 502 });
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
      console.error("[patents] Empty cleanup response", cleanupPayload);
      return NextResponse.json({ error: "Model did not return cleanup JSON." }, { status: 502 });
    }

    let structured: PatentStructuredPayload | null = null;
    try {
      const cleaned = stripMarkdownFences(cleanupText);
      const parsed = JSON.parse(cleaned);
      if (parsed && typeof parsed === "object") {
        structured = parsed as PatentStructuredPayload;
      }
    } catch (parseError) {
      console.error("[patents] Failed to parse structured patent JSON", parseError);
      console.error("[patents] Raw cleanup output:", cleanupText);
      // Fall back to returning just the discovery text
      return NextResponse.json({ text: discoveryText, structured: null });
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
