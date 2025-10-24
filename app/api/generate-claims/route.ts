import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_TEXT_LENGTH = 30_000;

interface PaperPayload {
  title?: string | null;
  doi?: string | null;
  authors?: string | null;
}

const CLAIMS_PROMPT_TEMPLATE = `Objective: Generate a rigorous, concise, text-only claims analysis of a single scientific paper, clearly stating its top 3 claims, supporting evidence, and gaps or limitations.

Context: You will receive raw text extracted from one scientific PDF. Work strictly from this text (no external sources). Focus on identifying and evaluating the paper's top 3 claims. Keep behaviour tightly scoped: prioritise producing the answer efficiently, proceed under reasonable assumptions without asking for clarification, and stop once acceptance criteria are met.

Audience and Tone: Research analysts and domain experts; tone is neutral, precise, evidence-centred, and concise.

Inputs:

Raw PDF text: [PASTE RAW TEXT HERE]

Constraints:

Text-only output (no JSON). Use Australian spelling and DD/MM/YYYY dates.

Base all findings strictly on the provided text; no external browsing or inference.

Attribute every claim and evidence item to page/section/figure/table references where available.

Extract numerical results exactly as written (effect sizes, CIs, p-values, N, timeframes).

Flag OCR artefacts or ambiguities with [UNCLEAR]; state assumptions explicitly.

Calibrate model behaviour: low verbosity, high reasoning; avoid unnecessary exploration and terminate once all acceptance criteria are satisfied.

Output Format:

Executive Summary: main findings, headline numbers, overall evidence strength (High/Moderate/Low).

Top 3 Claims and Evidence (C1–C3 only), each with:

One-sentence claim.

Evidence summary (design, sample, measures, analysis).

Key numbers (effect size, CI, p, N, timeframe).

Source location (page/section/figure/table).

Strength rating (High/Moderate/Low/Unclear) and key assumptions/conditions.

Gaps & Limitations: identify weaknesses and link each to C1–C3.

Methods Snapshot: brief overview of study design and approach.

Risk-of-Bias/Quality Checklist: brief assessment.

Open Questions & Next Steps: specific, testable follow-ups.

Steps or Acceptance Criteria:

Parse and segment the raw text; note missing sections explicitly.

Identify all distinct claims; rank by centrality (presence in abstract/conclusion, frequency, emphasis); select the top 3 only.

For C1–C3, summarise direct supporting evidence with precise locations and key numbers; classify evidence type (e.g., RCT, observational, simulation, qualitative, prior work).

Rate strength: High (appropriate design, adequate N, consistent results, clear statistics); Moderate (some limitations); Low (weak support/speculative); Unclear (insufficient detail).

Identify gaps/limitations tied to C1–C3.

Provide a concise methods snapshot and risk-of-bias checklist based only on stated details.

QA: all sections present; numbers match text exactly; each of C1–C3 has strength ratings and location references or [DETAIL NEEDED]; stop once checks pass.
`;

const CLEANUP_PROMPT_HEADER = `Objective: Convert the single-paper claims summary into strict JSON for Evidentia's claims UI (expects up to 3 claims: C1–C3).

Context: Input is the text output from the analysis step. Deterministic ETL process; preserve content exactly, validate schema, avoid extra keys or prose.

Schema Requirements:

Return a single JSON object with keys: text (string), structured (object), promptNotes (optional string).

text: Reproduce the analyst's formatted summary exactly (including headings and bullet markers). Replace every newline with \\n and escape embedded double quotes with \\".

structured.executiveSummary: array of strings.

structured.claims (max 3 items): array of objects { id, claim, evidenceSummary, keyNumbers (array of strings), source, strength, assumptions, evidenceType }. strength ∈ {"High","Moderate","Low","Unclear"}. Use [] for missing keyNumbers; use null for unknown scalars.

structured.gaps: array of objects { category, detail, relatedClaimIds (array of strings limited to ["C1","C2","C3"]) }.

structured.methodsSnapshot: array of strings.

structured.riskChecklist: array of objects { item, status, note }, where status ∈ {"met","partial","missing","unclear"} (lowercase).

structured.openQuestions: array of strings.

Output raw JSON only — no markdown fences, comments, or trailing prose. Must be valid under JSON.parse.

Preserve factual content; do not invent claims or numbers. Use "[DETAIL NEEDED]" exactly when details are missing.

Keep verbosity low; terminate once validation succeeds.

Validation Steps:

1. Ingest the analyst summary string exactly as provided.
2. Produce text by escaping embedded double quotes and replacing each newline with \\n, preserving all characters.
3. Parse the summary into structured fields (executiveSummary, claims [C1–C3 only], gaps, methodsSnapshot, riskChecklist, openQuestions).
4. For each claim (max 3), populate all fields; use [] for missing arrays and null for unknown scalars.
5. Populate riskChecklist statuses with only {"met","partial","missing","unclear"}.
6. Emit a single JSON object with exactly the allowed keys.
7. Validate with JSON.parse; if invalid, fix escaping/typing and re-validate; stop when valid.
`;

function buildClaimsPrompt(text: string, paper?: PaperPayload): string {
  let prompt = CLAIMS_PROMPT_TEMPLATE.replace("[PASTE RAW TEXT HERE]", text);

  // Add paper metadata if available
  if (paper) {
    const metadata: string[] = [];
    if (paper.title && paper.title.trim()) {
      metadata.push(`Title: ${paper.title.trim()}`);
    }
    if (paper.authors && paper.authors.trim()) {
      metadata.push(`Authors: ${paper.authors.trim()}`);
    }
    if (paper.doi && paper.doi.trim()) {
      metadata.push(`DOI: ${paper.doi.trim()}`);
    }

    if (metadata.length > 0) {
      prompt += "\n\nPaper metadata:\n" + metadata.join("\n");
    }
  }

  return prompt;
}

function truncateText(text: string, limit: number) {
  if (text.length <= limit) {
    return { text, truncated: false };
  }
  return {
    text: `${text.slice(0, limit)}\n\n[Truncated input to ${limit} characters for the request]`,
    truncated: true
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);

    if (!body || typeof body.text !== "string" || body.text.trim().length === 0) {
      return NextResponse.json({ error: "Missing extracted text." }, { status: 400 });
    }

    const paper: PaperPayload =
      body.paper && typeof body.paper === "object" && body.paper
        ? {
            title: typeof body.paper.title === "string" ? body.paper.title : null,
            doi: typeof body.paper.doi === "string" ? body.paper.doi : null,
            authors: typeof body.paper.authors === "string" ? body.paper.authors : null
          }
        : {};

    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      console.error("[generate-claims] OPENAI_API_KEY is not configured.");
      return NextResponse.json({ error: "OpenAI API key is not configured." }, { status: 500 });
    }

    const cleanedText = body.text.trim();
    const { text: truncatedText, truncated } = truncateText(cleanedText, MAX_TEXT_LENGTH);

    const claimsPrompt = buildClaimsPrompt(truncatedText, paper);

    // Step 1: Generate the textual claims analysis
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 600_000);

    let response: Response;

    try {
      response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: "gpt-5-mini",
          reasoning: { effort: "low" },
          input: claimsPrompt,
          max_output_tokens: 8_192
        }),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      let message = "OpenAI request failed.";
      try {
        const errorPayload = await response.json();
        console.error("[generate-claims] OpenAI error payload", errorPayload);
        if (typeof errorPayload?.error === "string") {
          message = errorPayload.error;
        } else if (typeof errorPayload?.message === "string") {
          message = errorPayload.message;
        }
      } catch (parseError) {
        console.warn("[generate-claims] Failed to parse OpenAI error payload", parseError);
      }
      return NextResponse.json({ error: message }, { status: response.status });
    }

    let payload: any;

    try {
      payload = await response.json();
    } catch (parseError) {
      console.error("[generate-claims] Failed to parse JSON response", parseError);
      return NextResponse.json({ error: "Failed to read model response." }, { status: 502 });
    }

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
      console.warn("[generate-claims] Model response incomplete", payload.incomplete_details);
      if (outputText) {
        outputText = `${outputText}\n\n[Note: Response truncated because the model hit its output limit. Consider rerunning if key details are missing.]`;
      } else {
        return NextResponse.json(
          {
            error:
              payload.incomplete_details.reason === "max_output_tokens"
                ? "Claims generation hit the output limit before completing. Try again in a moment."
                : `Claims generation ended early: ${payload.incomplete_details.reason}`
          },
          { status: 502 }
        );
      }
    }

    if (!outputText) {
      console.error("[generate-claims] Empty response payload", payload);
      return NextResponse.json({ error: "Model did not return any text." }, { status: 502 });
    }

    // Step 2: Convert the textual analysis to structured JSON
    const cleanupPrompt = `${CLEANUP_PROMPT_HEADER}\n\nAnalyst's claims summary:\n\n${outputText}`;

    const controller2 = new AbortController();
    const timeoutId2 = setTimeout(() => controller2.abort(), 600_000);

    let response2: Response;

    try {
      response2 = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: "gpt-5-mini",
          reasoning: { effort: "low" },
          input: cleanupPrompt,
          max_output_tokens: 8_192
        }),
        signal: controller2.signal
      });
    } finally {
      clearTimeout(timeoutId2);
    }

    if (!response2.ok) {
      let message = "OpenAI cleanup request failed.";
      try {
        const errorPayload = await response2.json();
        console.error("[generate-claims] OpenAI cleanup error payload", errorPayload);
        if (typeof errorPayload?.error === "string") {
          message = errorPayload.error;
        } else if (typeof errorPayload?.message === "string") {
          message = errorPayload.message;
        }
      } catch (parseError) {
        console.warn("[generate-claims] Failed to parse OpenAI cleanup error payload", parseError);
      }
      return NextResponse.json({ error: message }, { status: response2.status });
    }

    let payload2: any;

    try {
      payload2 = await response2.json();
    } catch (parseError) {
      console.error("[generate-claims] Failed to parse JSON cleanup response", parseError);
      return NextResponse.json({ error: "Failed to read model cleanup response." }, { status: 502 });
    }

    let cleanupOutputText = typeof payload2?.output_text === "string" ? payload2.output_text.trim() : "";

    if (!cleanupOutputText && Array.isArray(payload2?.output)) {
      cleanupOutputText = payload2.output
        .filter((item: any) => item && item.type === "message" && Array.isArray(item.content))
        .flatMap((item: any) =>
          item.content
            .filter((part: any) => part?.type === "output_text" && typeof part.text === "string")
            .map((part: any) => part.text)
        )
        .join("\n")
        .trim();
    }

    if (!cleanupOutputText) {
      console.error("[generate-claims] Empty cleanup response payload", payload2);
      return NextResponse.json({ error: "Model did not return cleanup JSON." }, { status: 502 });
    }

    // Try to parse the cleanup output as JSON
    let structuredClaims: any;
    try {
      // Remove markdown code fences if present
      const cleanedOutput = cleanupOutputText.replace(/^```json\s*\n?|\n?```\s*$/g, "").trim();
      structuredClaims = JSON.parse(cleanedOutput);
    } catch (parseError) {
      console.error("[generate-claims] Failed to parse structured claims JSON", parseError);
      console.error("[generate-claims] Raw cleanup output:", cleanupOutputText);
      // Fall back to returning just the text analysis
      return NextResponse.json({ text: outputText, structured: null });
    }

    return NextResponse.json({
      text: structuredClaims.text || outputText,
      structured: structuredClaims.structured || null
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    console.error("[generate-claims] Error:", error);
    return NextResponse.json({ error: `Failed to generate claims: ${message}` }, { status: 500 });
  }
}
