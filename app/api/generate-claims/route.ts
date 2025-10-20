import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_TEXT_LENGTH = 30_000;

interface PaperPayload {
  title?: string | null;
  doi?: string | null;
  authors?: string | null;
}

const CLAIMS_PROMPT_TEMPLATE = `Objective: Produce a rigorous yet concise text-only summary of a scientific paper that clearly states the paper's claims, the supporting evidence for each claim, and the gaps or limitations.

Context: You will receive raw text extracted from one or more scientific publication PDFs. Work strictly from this text (no external sources). If multiple papers are present, analyse each separately and add a brief cross-paper comparison.

Audience and Tone: Research analysts and domain experts. Tone: neutral, precise, evidence-centred, and concise.

Inputs:

Raw PDF text: [PASTE RAW TEXT HERE]

Optional metadata: [PAPER TITLE], [AUTHORS], [VENUE], [YEAR], [DOI/URL], [DISCIPLINE/DOMAIN], [TARGET AUDIENCE]

Optional scope constraints: [SECTIONS TO FOCUS ON], [MAX CLAIMS], [WORD LIMIT], [INCLUSION/EXCLUSION CRITERIA]

Optional rubric or definitions: [EVIDENCE STRENGTH RUBRIC], [CLAIM TYPES], [KEY OUTCOMES]

Constraints:

Text-only output (no JSON in this step).

Use Australian spelling and DD/MM/YYYY dates.

Base all findings strictly on the provided text; do not infer beyond it or browse externally.

Attribute every claim and evidence item to page/section/figure/table references where available.

Quote snippets ≤30 words; otherwise paraphrase faithfully.

Extract numerical results exactly as written (effect sizes, CIs, p-values, N, timeframes); round only if specified [ROUNDING RULES or 2 s.f.].

Flag OCR artefacts or ambiguities with [UNCLEAR] and state assumptions explicitly.

Prioritise concision and clarity; keep the full summary ≤[WORD LIMIT, e.g., 600–900 words].

Tools/Data:

Provided raw PDF text and optional metadata only.

If headings exist, segment by: Abstract, Introduction, Methods, Results, Discussion, Limitations, Conclusion, References.

Output Format:

Executive Summary (≤10 bullet points or ≤200 words): main claims, headline numbers, and overall evidence strength (High/Moderate/Low).

Key Claims and Evidence (bulleted list):

Claim ID: C1, C2, …

Claim (one sentence).

Evidence summary (design, sample, measures, analysis).

Key numbers (effect size, CI, p, N, timeframe).

Source location (page/section/figure/table).

Strength rating (High/Moderate/Low) and key assumptions/conditions.

Gaps & Limitations (categorised): data gaps, methodological weaknesses, external validity, unresolved confounders, missing comparisons, contradictions—link each to relevant Claim IDs.

Methods Snapshot (3–6 bullets): study design, sample, measures, analysis approach, preregistration/ethics [DETAIL NEEDED if absent].

Risk-of-Bias/Quality Checklist (tick/short notes): sampling, randomisation, blinding, missing data handling, multiplicity, selective reporting.

Open Questions & Next Steps (3–6 bullets): specific, testable follow-ups implied by the paper.

Cross-Paper Comparison (only if multiple papers): 3–5 bullets on points of agreement, divergence, and evidence quality.

Steps or Acceptance Criteria:

Parse and segment the raw text; note missing sections explicitly.

Extract distinct, testable claims; if >[MAX CLAIMS], prioritise the top [MAX CLAIMS] by centrality (presence in abstract/conclusion, frequency, emphasis) and list the remainder briefly.

For each claim, locate and summarise direct supporting evidence with precise source locations and key numbers.

Classify evidence type (e.g., RCT, observational, simulation, qualitative, prior work) and rate strength using a transparent rubric:

High: appropriate design, adequate N, consistent results, clear statistics.

Moderate: some limitations (e.g., small N, partial controls).

Low: anecdotal/speculative or weakly supported.

Identify gaps/limitations and tie them to affected Claim IDs.

Provide a concise methods snapshot and risk-of-bias checklist based only on stated details.

Ensure concision and coherence: no redundant text; all claims have strength ratings and location references or [DETAIL NEEDED] if absent.

Final QA: all required sections present; numbers match the text exactly; all quotes ≤30 words; all claims tie back to the supplied text.`;

const CLEANUP_PROMPT_HEADER = `You are a cleanup agent. Convert the analyst's claims summary into strict JSON for Evidentia's claims UI.

Output requirements:
- Return a single JSON object with keys: text (string), structured (object), promptNotes (optional string).
- text must reproduce the analyst's formatted summary exactly (including headings and bullet markers). Replace every newline with \\n and escape embedded double quotes with \\" so the string parses in JSON.
- structured.executiveSummary: array of strings (each one bullet).
- structured.claims: array of objects with keys { id, claim, evidenceSummary, keyNumbers (array of strings), source, strength, assumptions, evidenceType }.
  - strength must be one of "High", "Moderate", "Low", "Unclear".
  - Use empty arrays for missing keyNumbers; use null for unknown scalars.
- structured.gaps: array of objects { category, detail, relatedClaimIds (array of strings) }.
- structured.methodsSnapshot: array of strings.
- structured.riskChecklist: array of objects { item, status, note }. Status must be one of "met", "partial", "missing", "unclear" (lowercase).
- structured.openQuestions: array of strings.
- structured.crossPaperComparison: array of strings (omit when not applicable).
- Output raw JSON only — no markdown fences, comments, trailing prose, or extra keys. Validate the payload with JSON.parse before responding.
- Preserve factual content; do not invent new claims or numbers. When details are missing, use placeholders like "[DETAIL NEEDED]" exactly as written.`;

function buildClaimsPrompt(text: string, paper?: PaperPayload): string {
  const title = paper?.title && paper.title.trim().length > 0 ? paper.title.trim() : "Unknown title";
  const doiOrId = paper?.doi && paper.doi.trim() ? paper.doi.trim() : "Not provided";
  const authors = paper?.authors && paper.authors.trim() ? paper.authors.trim() : "Not provided";

  const metadata = `
Optional metadata:
- Paper Title: ${title}
- Authors: ${authors}
- DOI: ${doiOrId}`;

  return CLAIMS_PROMPT_TEMPLATE.replace("[PASTE RAW TEXT HERE]", text) + "\n" + metadata;
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
