import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_TEXT_LENGTH = 20_000;

interface PaperPayload {
  title?: string | null;
  doi?: string | null;
  scraped_url?: string | null;
  url?: string | null;
  authors?: Array<string | { name?: string | null }> | string | null;
  abstract?: string | null;
}

interface ClaimsPayload {
  text?: string;
  structured?: ClaimsStructured;
}

interface ClaimsStructured {
  executiveSummary?: string[] | readonly string[];
  claims?: ClaimItem[] | readonly ClaimItem[];
  gaps?: GapItem[] | readonly GapItem[];
  methodsSnapshot?: string[] | readonly string[];
  riskChecklist?: RiskItem[] | readonly RiskItem[];
  openQuestions?: string[] | readonly string[];
}

interface ClaimItem {
  readonly id?: string;
  readonly claim?: string;
  readonly evidenceSummary?: string | null;
  readonly keyNumbers?: string[] | readonly string[];
  readonly source?: string | null;
  readonly strength?: string;
  readonly assumptions?: string | null;
  readonly evidenceType?: string | null;
}

interface GapItem {
  readonly category?: string;
  readonly detail?: string;
  readonly relatedClaimIds?: string[] | readonly string[];
}

interface RiskItem {
  readonly item?: string;
  readonly status?: string;
  readonly note?: string | null;
}

interface DerivedSignals {
  summaryLines: string[];
  methodSignals: string[];
  searchQueries: string[];
  claimsOverview: string[];
  gapHighlights: string[];
  methodsSnapshot: string[];
  riskItems: string[];
  openQuestions: string[];
}

const CLEANUP_PROMPT_HEADER = `You are a cleanup agent. Convert the analyst's notes into strict JSON for Evidentia's Similar Papers UI.

Output requirements:
- Return a single JSON object with keys: sourcePaper, similarPapers, promptNotes (optional).
- sourcePaper fields:
  - summary: string (keep concise, two sentences max)
  - keyMethodSignals: array of 3-5 short strings (no numbering)
  - searchQueries: array of 3-5 search phrases
  - methodMatrix: object with keys (sampleModel, materialsSetup, equipmentSetup, procedureSteps, controls, outputsMetrics, qualityChecks, outcomeSummary). Extract these from the source paper's claims brief and methods snapshot. Use "Not reported" when information is missing.
- similarPapers: array of 3-5 objects. Each object must include:
  identifier (string), title (string), doi (string|null), url (string|null),
  authors (array of strings), year (number|null), venue (string|null),
  clusterLabel ("Sample and model" | "Field deployments" | "Insight primers"),
  whyRelevant (string), overlapHighlights (array of exactly 3 short strings),
  methodMatrix (object with keys: sampleModel, materialsSetup, equipmentSetup, procedureSteps, controls, outputsMetrics, qualityChecks, outcomeSummary),
  gapsOrUncertainties (string|null).
- Use "Not reported" inside methodMatrix when information is missing. Use null for unknown scalars.
- No markdown, no commentary, no trailing prose. Ensure valid JSON (double quotes only).
- Preserve factual content; do not invent new details.
- Output raw JSON only — no markdown fences, comments, trailing prose, or extra keys.`;

function cleanPlainText(input: string): string {
  if (typeof input !== "string") {
    return "";
  }
  return input.replace(/\r\n/g, "\n").trim();
}

function limitList(items: any, limit: number): string[] {
  if (!Array.isArray(items)) {
    return [];
  }
  return items
    .map((item) => (typeof item === "string" ? cleanPlainText(item) : ""))
    .filter((item) => item && item.trim().length > 0)
    .slice(0, limit);
}

function generateSearchPhrase(text: string): string {
  if (typeof text !== "string") {
    return "";
  }
  const cleaned = cleanPlainText(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    return "";
  }

  const tokens = cleaned.split(" ").filter((token) => token.length > 3);
  const unique: string[] = [];
  for (const token of tokens) {
    if (!unique.includes(token)) {
      unique.push(token);
    }
    if (unique.length >= 5) {
      break;
    }
  }

  return unique.join(" ");
}

function deriveSignalsFromClaims(structured: ClaimsStructured): DerivedSignals {
  const empty: DerivedSignals = {
    summaryLines: [],
    methodSignals: [],
    searchQueries: [],
    claimsOverview: [],
    gapHighlights: [],
    methodsSnapshot: [],
    riskItems: [],
    openQuestions: []
  };

  if (!structured || typeof structured !== "object") {
    return empty;
  }

  const summaryLines = limitList(structured.executiveSummary, 3);

  const claimsArray = Array.isArray(structured.claims)
    ? structured.claims.filter((claim): claim is ClaimItem => claim != null && typeof claim === "object")
    : [];

  const methodSignals = claimsArray
    .slice(0, 4)
    .map((claim) => {
      const id = typeof claim.id === "string" && claim.id.trim().length > 0 ? claim.id.trim() : "Claim";
      const evidence = cleanPlainText(
        (typeof claim.evidenceSummary === "string" ? claim.evidenceSummary : null) ||
        (typeof claim.claim === "string" ? claim.claim : null) ||
        ""
      );
      return `${id}: ${evidence}`;
    })
    .filter((entry) => entry && entry.trim().length > 0);

  const claimsOverview = claimsArray
    .slice(0, 6)
    .map((claim) => {
      const id = typeof claim.id === "string" && claim.id.trim().length > 0 ? claim.id.trim() : "Claim";
      const strength = typeof claim.strength === "string" && claim.strength.trim().length > 0 ? ` [${claim.strength.trim()}]` : "";
      const text = cleanPlainText(
        (typeof claim.claim === "string" ? claim.claim : null) ||
        (typeof claim.evidenceSummary === "string" ? claim.evidenceSummary : null) ||
        ""
      );
      return `${id}${strength}: ${text}`;
    })
    .filter((entry) => entry && entry.trim().length > 0);

  const searchQueries: string[] = [];
  for (const claim of claimsArray) {
    if (searchQueries.length >= 5) {
      break;
    }
    const claimText = (typeof claim.claim === "string" ? claim.claim : null) ||
      (typeof claim.evidenceSummary === "string" ? claim.evidenceSummary : null) ||
      "";
    const phrase = generateSearchPhrase(claimText);
    if (phrase && !searchQueries.includes(phrase)) {
      searchQueries.push(phrase);
    }
  }

  const filteredQueries = searchQueries.filter((entry) => entry && entry.trim().length > 0);

  const gapsArray = Array.isArray(structured.gaps)
    ? structured.gaps.filter((gap): gap is GapItem => gap != null && typeof gap === "object")
    : [];

  const gapHighlights = gapsArray
    .slice(0, 4)
    .map((gap) => {
      const category = cleanPlainText(
        (typeof gap.category === "string" ? gap.category : null) || "Gap"
      );
      const detail = cleanPlainText(
        (typeof gap.detail === "string" ? gap.detail : null) || "Detail not provided"
      );
      const claims = Array.isArray(gap.relatedClaimIds) && gap.relatedClaimIds.length > 0
        ? ` (claims: ${gap.relatedClaimIds.join(", ")})`
        : "";
      return `${category}: ${detail}${claims}`;
    })
    .filter((entry) => entry && entry.trim().length > 0);

  const methodsSnapshot = limitList(structured.methodsSnapshot, 4);

  const riskItems = Array.isArray(structured.riskChecklist)
    ? structured.riskChecklist
        .filter((item): item is RiskItem => item != null && typeof item === "object")
        .slice(0, 4)
        .map((item) => {
          const label = cleanPlainText(
            (typeof item.item === "string" ? item.item : null) || "Assessment"
          );
          const status = typeof item.status === "string" && item.status.trim().length > 0 ? item.status.trim() : "unclear";
          const note = cleanPlainText(
            (typeof item.note === "string" ? item.note : null) || ""
          );
          return `${label} — ${status}${note ? ` (${note})` : ""}`;
        })
        .filter((entry) => entry && entry.trim().length > 0)
    : [];

  const openQuestions = limitList(structured.openQuestions, 5);

  return {
    summaryLines,
    methodSignals,
    searchQueries: filteredQueries,
    claimsOverview,
    gapHighlights,
    methodsSnapshot,
    riskItems,
    openQuestions
  };
}

function buildClaimsReferenceAddon(derived: DerivedSignals): string {
  const sections: string[] = [];

  if (derived.claimsOverview.length) {
    sections.push("Claims brief references:");
    derived.claimsOverview.forEach((line) => {
      sections.push(`- ${line}`);
    });
  }

  if (derived.gapHighlights.length) {
    sections.push("", "Gaps & limitations to address:");
    derived.gapHighlights.forEach((line) => {
      sections.push(`- ${line}`);
    });
  }

  if (derived.methodsSnapshot.length) {
    sections.push("", "Methods snapshot cues:");
    derived.methodsSnapshot.forEach((line) => {
      sections.push(`- ${line}`);
    });
  }

  if (derived.riskItems.length) {
    sections.push("", "Risk / quality notes:");
    derived.riskItems.forEach((line) => {
      sections.push(`- ${line}`);
    });
  }

  if (derived.openQuestions.length) {
    sections.push("", "Open questions to pursue:");
    derived.openQuestions.forEach((line) => {
      sections.push(`- ${line}`);
    });
  }

  return sections.join("\n");
}

function normaliseAuthorName(author: unknown): string | null {
  if (!author) {
    return null;
  }

  if (typeof author === "string") {
    const cleaned = author.trim();
    if (!cleaned) {
      return null;
    }
    return cleaned;
  }

  if (typeof author === "object" && author !== null) {
    const maybeName =
      "name" in author && typeof (author as { name?: unknown }).name === "string"
        ? (author as { name?: string }).name
        : null;
    if (maybeName && maybeName.trim().length > 0) {
      return maybeName.trim();
    }
  }

  return null;
}

function formatAuthors(authors: PaperPayload["authors"]): string {
  if (!authors) {
    return "Not provided";
  }

  if (typeof authors === "string") {
    const raw = authors.trim();
    if (!raw) {
      return "Not provided";
    }

    const split = raw.split(/[,;|]/).map((entry) => entry.trim()).filter(Boolean);
    if (split.length === 0) {
      return raw;
    }
    return split.join(", ");
  }

  if (Array.isArray(authors)) {
    const names = authors
      .map((entry) => normaliseAuthorName(entry))
      .filter((name): name is string => Boolean(name));

    if (names.length === 0) {
      return "Not provided";
    }

    return names.join(", ");
  }

  return "Not provided";
}

function buildDiscoveryPrompt(paper: PaperPayload, claimsDerived: DerivedSignals): string {
  const title = paper.title && paper.title.trim().length > 0 ? paper.title.trim() : "Unknown title";
  const doiOrId =
    (paper.doi && paper.doi.trim()) ||
    (paper.scraped_url && paper.scraped_url.trim()) ||
    (paper.url && paper.url.trim()) ||
    "Not provided";
  const authors = formatAuthors(paper.authors);

  const summaryLines = claimsDerived.summaryLines.length > 0
    ? claimsDerived.summaryLines
    : [cleanPlainText(
        (typeof paper.abstract === "string" ? paper.abstract : null) ||
        "Summary not provided in claims brief."
      )];

  const methodSignals = claimsDerived.methodSignals.length > 0
    ? claimsDerived.methodSignals
    : ["No method signals extracted from claims brief. Focus on method-level overlap."];

  const searchQueriesRaw = claimsDerived.searchQueries.length > 0
    ? claimsDerived.searchQueries
    : [generateSearchPhrase(`${title}`), "similar research methods"];

  const searchQueries = Array.from(
    new Set(
      searchQueriesRaw
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter((entry) => entry.length > 0)
    )
  );

  const lines = [
    "You are powering Evidentia's Similar Papers feature. Collect the research notes we need before a cleanup agent converts them to JSON.",
    "You do not have a live user in the loop. Do not ask clarifying questions or offer option menus—decide and move straight to the notes.",
    "You are provided with a structured claims brief (executive summary, claims, gaps, methods, risk, next steps). Use it as the authoritative context—do not re-open the PDF.",
    "Focus on the methods, evidence strength, gaps, and open questions surfaced in that brief when selecting comparison papers.",
    "When you reference the brief, note the section (e.g., Key Claims C1/C2, Gaps, Methods Snapshot) so downstream systems can trace provenance.",
    "Use the exact headings and bullet structure below for your output. Keep language plain and concrete.",
    "",
    "Source Paper (claims brief synthesis):",
    `- Title: ${title}`,
    `- Identifier: ${doiOrId}`,
    `- Authors: ${authors}`,
    "- Summary:",
  ];

  summaryLines.slice(0, 3).forEach((entry) => {
    lines.push(`  - ${entry}`);
  });

  lines.push("- Key method signals:");
  methodSignals.slice(0, 5).forEach((entry) => {
    lines.push(`  - ${entry}`);
  });

  lines.push("- Search queries:");
  searchQueries.slice(0, 5).forEach((entry) => {
    lines.push(`  - ${entry}`);
  });

  lines.push(
    "",
    "Similar Papers (3-5 entries):",
    "For each entry use this template (start each paper with its number):",
    "1. Identifier: <DOI or stable URL>",
    "   Title: <paper title>",
    "   Authors: <comma-separated names>",
    "   Year: <year or 'Not reported'>",
    "   Venue: <journal/conference or 'Not reported'>",
    "   Cluster: <Sample and model | Field deployments | Insight primers>",
    "   Why relevant: <2 sentences focusing on method overlap>",
    "   Overlap highlights:",
    "   - <short fragment 1>",
    "   - <short fragment 2>",
    "   - <short fragment 3>",
    "   Method matrix:",
    "   - Sample / model: <text>",
    "   - Materials: <text>",
    "   - Equipment: <text>",
    "   - Procedure: <text>",
    "   - Controls: <text>",
    "   - Outputs / metrics: <text>",
    "   - Quality checks: <text>",
    "   - Outcome summary: <text>",
    "   Gaps or uncertainties: <note if something is missing or risky>",
    "",
    "Guidelines:",
    "- Anchor recommendations to the claims brief: pull method cues, evidence strength, and gaps directly from the provided sections.",
    "- Pick papers with executable method overlap (instrumentation, controls, sample handling).",
    "- Where possible, map each similar paper back to the brief: cite which claim/gap/next-step it supports or extends.",
    "- If information is missing, write 'Not reported' inside the relevant bullet.",
    "- Keep each method matrix bullet to ~12-18 words.",
    "- Stay under 1,000 tokens total.",
    "",
    "Respond using these headings exactly. No JSON yet."
  );

  return lines.join("\n");
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

function buildCleanupPrompt(discoveryNotes: string): string {
  return `${CLEANUP_PROMPT_HEADER}\n\nAnalyst's similar papers notes:\n\n${discoveryNotes}`;
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);

    if (!body || typeof body.text !== "string" || body.text.trim().length === 0) {
      return NextResponse.json({ error: "Missing extracted text." }, { status: 400 });
    }

    // REQUIRE claims data
    if (!body.claims || typeof body.claims !== "object") {
      return NextResponse.json(
        {
          error: "Claims analysis is required for similar papers generation. Please wait for claims to complete first."
        },
        { status: 400 }
      );
    }

    const claims = body.claims as ClaimsPayload;

    if (!claims.text || typeof claims.text !== "string" || claims.text.trim().length === 0) {
      return NextResponse.json(
        {
          error: "Claims text is required. The claims analysis may have failed."
        },
        { status: 400 }
      );
    }

    if (!claims.structured || typeof claims.structured !== "object") {
      return NextResponse.json(
        {
          error: "Claims structured data is required. The claims analysis may have failed."
        },
        { status: 400 }
      );
    }

    const paper: PaperPayload =
      body.paper && typeof body.paper === "object" && body.paper
        ? {
            title: typeof body.paper.title === "string" ? body.paper.title : null,
            doi: typeof body.paper.doi === "string" ? body.paper.doi : null,
            scraped_url: typeof body.paper.scraped_url === "string" ? body.paper.scraped_url : null,
            url: typeof body.paper.url === "string" ? body.paper.url : null,
            authors:
              Array.isArray(body.paper.authors) || typeof body.paper.authors === "string"
                ? body.paper.authors
                : null,
            abstract: typeof body.paper.abstract === "string" ? body.paper.abstract : null
          }
        : {};

    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      console.error("[similar-papers] OPENAI_API_KEY is not configured.");
      return NextResponse.json({ error: "OpenAI API key is not configured." }, { status: 500 });
    }

    // Derive signals from claims
    const derivedSignals = deriveSignalsFromClaims(claims.structured);
    const basePrompt = buildDiscoveryPrompt(paper, derivedSignals);
    const referenceAddon = buildClaimsReferenceAddon(derivedSignals);
    const claimsSummaryText = claims.text.trim();

    const assembledPrompt = [
      basePrompt.trim(),
      "",
      referenceAddon.trim(),
      "",
      "Claims brief (verbatim for reference):",
      claimsSummaryText
    ].join("\n");

    console.log("[similar-papers] Starting discovery phase with OpenAI API...", {
      promptLength: assembledPrompt.length,
      model: "gpt-5-mini-2025-08-07"
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      console.log("[similar-papers] Discovery request timed out after 600 seconds");
      controller.abort();
    }, 600_000);

    let response: Response;

    try {
      console.log("[similar-papers] Sending discovery request to OpenAI...");
      response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        // The model asked for confirmation before running web search, which stalls the pipeline.
        // Keep the request self-contained until we have a supervised search flow again.
        body: JSON.stringify({
          model: "gpt-5-mini-2025-08-07",
          reasoning: { effort: "low" },
          input: assembledPrompt,
          max_output_tokens: 6_144
        }),
        signal: controller.signal
      });
      console.log("[similar-papers] Discovery request completed", {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok
      });
    } catch (fetchError) {
      clearTimeout(timeoutId);
      const errorMessage = fetchError instanceof Error ? fetchError.message : String(fetchError);
      console.error("[similar-papers] Discovery fetch failed with network error:", errorMessage);
      throw fetchError;
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      let message = "OpenAI request failed.";
      try {
        const errorPayload = await response.json();
        console.error("[similar-papers] OpenAI error payload", errorPayload);
        if (typeof errorPayload?.error === "string") {
          message = errorPayload.error;
        } else if (typeof errorPayload?.message === "string") {
          message = errorPayload.message;
        }
      } catch (parseError) {
        console.warn("[similar-papers] Failed to parse OpenAI error payload", parseError);
      }
      return NextResponse.json({ error: message }, { status: response.status });
    }

    let payload: any;

    try {
      payload = await response.json();
    } catch (parseError) {
      console.error("[similar-papers] Failed to parse JSON response", parseError);
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
      console.warn("[similar-papers] Model response incomplete", payload.incomplete_details);
      if (outputText) {
        outputText = `${outputText}\n\n[Note: Response truncated because the model hit its output limit. Consider rerunning if key details are missing.]`;
      } else {
        return NextResponse.json(
          {
            error:
              payload.incomplete_details.reason === "max_output_tokens"
                ? "Similar paper search hit the output limit before completing. Try again in a moment."
                : `Similar paper search ended early: ${payload.incomplete_details.reason}`
          },
          { status: 502 }
        );
      }
    }

    if (!outputText) {
      console.error("[similar-papers] Empty response payload", payload);
      return NextResponse.json({ error: "Model did not return any text." }, { status: 502 });
    }

    // Step 2: Convert the discovery notes to structured JSON
    const cleanupPrompt = buildCleanupPrompt(outputText);

    console.log("[similar-papers] Starting cleanup phase with OpenAI API...", {
      discoveryTextLength: outputText.length,
      model: "gpt-5-mini-2025-08-07"
    });

    const controller2 = new AbortController();
    const timeoutId2 = setTimeout(() => {
      console.log("[similar-papers] Cleanup request timed out after 600 seconds");
      controller2.abort();
    }, 600_000);

    let response2: Response;

    try {
      console.log("[similar-papers] Sending cleanup request to OpenAI...");
      response2 = await fetch("https://api.openai.com/v1/responses", {
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
      console.log("[similar-papers] Cleanup request completed", {
        status: response2.status,
        statusText: response2.statusText,
        ok: response2.ok
      });
    } catch (fetchError) {
      clearTimeout(timeoutId2);
      const errorMessage = fetchError instanceof Error ? fetchError.message : String(fetchError);
      console.error("[similar-papers] Cleanup fetch failed with network error:", errorMessage);
      throw fetchError;
    } finally {
      clearTimeout(timeoutId2);
    }

    if (!response2.ok) {
      let message = "OpenAI cleanup request failed.";
      try {
        const errorPayload = await response2.json();
        console.error("[similar-papers] OpenAI cleanup error payload", errorPayload);
        if (typeof errorPayload?.error === "string") {
          message = errorPayload.error;
        } else if (typeof errorPayload?.message === "string") {
          message = errorPayload.message;
        }
      } catch (parseError) {
        console.warn("[similar-papers] Failed to parse OpenAI cleanup error payload", parseError);
      }
      return NextResponse.json({ error: message }, { status: response2.status });
    }

    let payload2: any;

    try {
      payload2 = await response2.json();
    } catch (parseError) {
      console.error("[similar-papers] Failed to parse JSON cleanup response", parseError);
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
      console.error("[similar-papers] Empty cleanup response payload", payload2);
      return NextResponse.json({ error: "Model did not return cleanup JSON." }, { status: 502 });
    }

    // Try to parse the cleanup output as JSON
    let structuredSimilarPapers: any;
    try {
      // Remove markdown code fences if present
      const cleanedOutput = cleanupOutputText.replace(/^```json\s*\n?|\n?```\s*$/g, "").trim();
      structuredSimilarPapers = JSON.parse(cleanedOutput);
    } catch (parseError) {
      console.error("[similar-papers] Failed to parse structured similar papers JSON", parseError);
      console.error("[similar-papers] Raw cleanup output:", cleanupOutputText);
      // Fall back to returning just the text analysis
      return NextResponse.json({ text: outputText, structured: null });
    }

    console.log("[similar-papers] Successfully completed both discovery and cleanup phases", {
      hasText: Boolean(outputText),
      hasStructured: Boolean(structuredSimilarPapers),
      structuredPapersCount: structuredSimilarPapers?.similarPapers?.length ?? 0
    });

    return NextResponse.json({
      text: outputText,
      structured: structuredSimilarPapers
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    const stack = error instanceof Error ? error.stack : undefined;
    console.error("[similar-papers] Unhandled error:", {
      message,
      stack,
      errorType: error?.constructor?.name
    });
    return NextResponse.json({ error: `Failed to gather similar papers: ${message}` }, { status: 500 });
  }
}
