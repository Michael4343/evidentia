import { NextResponse } from "next/server";

export const runtime = "nodejs";

interface PaperPayload {
  title?: string | null;
  doi?: string | null;
  authors?: Array<string | { name?: string | null }> | string | null;
  abstract?: string | null;
}

interface SimilarPaperEntry {
  title: string;
  authors?: string[];
  doi?: string | null;
  url?: string | null;
  venue?: string | null;
  year?: number | null;
}

interface SimilarPapersPayload {
  text?: string;
  structured?: {
    similarPapers?: SimilarPaperEntry[];
  };
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

const DISCOVERY_PROMPT_TEMPLATE = `Objective: For EACH paper below, gather comprehensive contact information for the FIRST 3 AUTHORS listed on that paper.

Context: You're building a collaboration pipeline for research analysts. For each paper, identify the first 3 authors (or all authors if fewer than 3) and find their complete contact details. You have web search tools enabled—use them immediately.

Papers to analyze:
[PAPERS_SECTION]

Task:

For each paper:
1. Take the FIRST 3 AUTHORS from the author list (or all if fewer than 3)
2. For each author, use web search to gather comprehensive contact information:
   - Full name (as listed on the paper)
   - Institutional email (search university directories, lab pages)
   - Current role/position (PI, Professor, Postdoc, PhD Student, etc.)
   - ORCID identifier (search orcid.org by author name)
   - Academic profiles (Google Scholar, LinkedIn, personal website)

Search methodology:

1. Search each author's name on ORCID.org to find their unique identifier
2. Search Google Scholar for author's academic profile
3. Search LinkedIn for professional profile
4. Search university/institution directories for institutional email
5. Check if author has a personal website or lab page
6. Determine current role/position from recent affiliations

Output Format:

Paper 1: <Paper Title> (<Identifier or 'Source'>)

Author 1: <Full Name>
  Email: <institutional.email@university.edu or 'Not found'>
  Role: <Current Position or 'Not found'>
  ORCID: <0000-0000-0000-0000 or 'Not found'>
  Profiles:
    - Google Scholar: <URL or 'Not found'>
    - LinkedIn: <URL or 'Not found'>
    - Website: <URL or 'Not found'>

Author 2: <Full Name>
  Email: <email or 'Not found'>
  Role: <role or 'Not found'>
  ORCID: <ID or 'Not found'>
  Profiles:
    - Google Scholar: <URL or 'Not found'>
    - LinkedIn: <URL or 'Not found'>

Author 3: <Full Name>
  Email: <email or 'Not found'>
  Role: <role or 'Not found'>
  ORCID: <ID or 'Not found'>
  Profiles:
    - Google Scholar: <URL or 'Not found'>

[If paper has <3 authors, include only those available]

Paper 2: <Next Paper Title> (<Identifier>)

Author 1: ...
Author 2: ...
Author 3: ...

[Repeat for all papers in this batch]

Important:
- Execute all searches automatically without asking for permission
- Use 'Not found' when information genuinely can't be located after thorough search
- ORCID format: 0000-0000-0000-0000 (16 digits with hyphens)
- Only include profiles that are publicly accessible
- For each paper, include the first 3 authors (or all if <3)
- Prioritize institutional emails over personal emails

Begin web search and research immediately.`;

const CLEANUP_PROMPT_HEADER = `You are a cleanup agent. Convert the analyst's notes into strict JSON for Evidentia's Author Contacts UI.

Output requirements:
- Return a single JSON object with keys: papers (array), promptNotes (optional string).
- Each paper object must include: title (string), identifier (string|null), authors (array of up to 3 objects).
- Each author object must include: name (string), email (string|null), role (string|null), orcid (string|null), profiles (array).
- Each profile object must include: platform (string), url (string).
- Use null for unknown scalars.
- For ORCID: use format "0000-0000-0000-0000" or null if not found. Do not use "Not found" - use null instead.
- For profiles: only include profiles that have actual URLs. Common platforms: "Google Scholar", "LinkedIn", "Personal Website", "ResearchGate", "Twitter".
- No markdown, no commentary, no trailing prose. Ensure valid JSON (double quotes only).
- Preserve factual content; do not invent new people or emails.
- Each paper should have up to 3 authors (the first 3 from the author list, or fewer if the paper has <3 authors).
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

function extractAuthors(authorsField: any): string {
  if (Array.isArray(authorsField)) {
    const authorNames = authorsField
      .slice(0, 3)
      .map((author, idx) => {
        const name = typeof author === 'string' ? author : (author?.name || 'Unknown');
        return `     ${idx + 1}. ${cleanPlainText(name)}`;
      })
      .join('\n');
    return authorNames || '     Authors not specified';
  }
  if (typeof authorsField === 'string') {
    return `     ${cleanPlainText(authorsField)}`;
  }
  return '     Authors not specified';
}

interface PaperBatchItem {
  title: string;
  identifier: string;
  authors: string;
  summary?: string;
  methodSignals?: string;
  isSource: boolean;
}

function buildPaperSection(papers: PaperBatchItem[], startIndex: number): string {
  const lines: string[] = [];

  papers.forEach((paper, idx) => {
    const paperNum = startIndex + idx;
    const label = paper.isSource ? "SOURCE PAPER" : `SIMILAR PAPER ${paperNum - 1}`;

    lines.push(`${paperNum}. ${label}:`);
    lines.push(`   Title: ${paper.title}`);
    lines.push(`   Identifier: ${paper.identifier}`);
    lines.push(`   Authors (in order):`);
    lines.push(paper.authors);

    if (paper.summary) {
      lines.push(`   Summary: ${paper.summary}`);
    }

    if (paper.methodSignals) {
      lines.push(paper.methodSignals);
    }

    lines.push("");
  });

  return lines.join("\n");
}

function buildBatchDiscoveryPrompt(papers: PaperBatchItem[], startIndex: number): string {
  const papersSection = buildPaperSection(papers, startIndex);
  return DISCOVERY_PROMPT_TEMPLATE.replace("[PAPERS_SECTION]", papersSection);
}

function preparePaperBatches(
  paper: PaperPayload,
  claims: ClaimsPayload,
  similarPapers: SimilarPapersPayload
): PaperBatchItem[] {
  const allPapers: PaperBatchItem[] = [];

  // Prepare source paper
  const title = paper.title && paper.title.trim().length > 0 ? paper.title.trim() : "Unknown title";
  const doiLine = paper.doi && paper.doi.trim() ? paper.doi.trim() : "Not provided";
  const authorsSection = extractAuthors(paper.authors);

  const summaryLines = claims.structured?.executiveSummary
    ? limitList(claims.structured.executiveSummary, 3)
    : [cleanPlainText(paper.abstract || "Summary not provided in claims brief.")];
  const summary = summaryLines.join(" ");

  const methodSignals = claims.structured?.methodsSnapshot
    ? limitList(claims.structured.methodsSnapshot, 5)
    : [];
  const methodSignalsSection = methodSignals.length
    ? `   Method signals:\n${methodSignals.map(s => `     - ${s}`).join("\n")}`
    : "";

  allPapers.push({
    title,
    identifier: doiLine,
    authors: authorsSection,
    summary,
    methodSignals: methodSignalsSection || undefined,
    isSource: true
  });

  // Prepare similar papers (limit to 5)
  const similarPapersArray = (similarPapers.structured?.similarPapers || []).slice(0, 5);

  similarPapersArray.forEach((similarPaper) => {
    const paperTitle = cleanPlainText(similarPaper.title || "Unknown title");
    const authors = Array.isArray(similarPaper.authors) && similarPaper.authors.length > 0
      ? similarPaper.authors.map((author, idx) => `     ${idx + 1}. ${cleanPlainText(author)}`).join('\n')
      : "     Authors not reported";

    const identifier = similarPaper.doi
      ? `DOI: ${similarPaper.doi}`
      : similarPaper.url
        ? `URL: ${similarPaper.url}`
        : "No identifier";

    allPapers.push({
      title: paperTitle,
      identifier,
      authors,
      isSource: false
    });
  });

  return allPapers;
}

function buildCleanupPrompt(discoveryNotes: string): string {
  return `${CLEANUP_PROMPT_HEADER}\n\nAnalyst's author contacts notes:\n\n${discoveryNotes}`;
}

async function fetchBatchDiscovery(
  prompt: string,
  apiKey: string,
  batchNumber: number,
  totalBatches: number
): Promise<string> {
  console.log(`[research-groups] Starting batch ${batchNumber}/${totalBatches} discovery`);

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
        tools: [{ type: "web_search", search_context_size: "medium" }],
        tool_choice: "auto",
        input: prompt,
        max_output_tokens: 16_384
      }),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    let message = `Batch ${batchNumber} OpenAI request failed.`;
    try {
      const errorPayload = await response.json();
      console.error(`[research-groups] Batch ${batchNumber} OpenAI error payload`, errorPayload);
      if (typeof errorPayload?.error === "string") {
        message = errorPayload.error;
      } else if (typeof errorPayload?.message === "string") {
        message = errorPayload.message;
      }
    } catch (parseError) {
      console.warn(`[research-groups] Batch ${batchNumber} failed to parse error payload`, parseError);
    }
    throw new Error(message);
  }

  let payload: any;

  try {
    payload = await response.json();
  } catch (parseError) {
    console.error(`[research-groups] Batch ${batchNumber} failed to parse JSON response`, parseError);
    throw new Error(`Batch ${batchNumber}: Failed to read model response.`);
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
    console.warn(`[research-groups] Batch ${batchNumber} response incomplete`, payload.incomplete_details);
    if (outputText) {
      outputText = `${outputText}\n\n[Note: Batch ${batchNumber} response truncated because the model hit its output limit.]`;
    } else {
      throw new Error(
        payload.incomplete_details.reason === "max_output_tokens"
          ? `Batch ${batchNumber} hit the output limit before completing.`
          : `Batch ${batchNumber} ended early: ${payload.incomplete_details.reason}`
      );
    }
  }

  if (!outputText) {
    console.error(`[research-groups] Batch ${batchNumber} empty response payload`, payload);
    throw new Error(`Batch ${batchNumber}: Model did not return any text.`);
  }

  console.log(`[research-groups] Batch ${batchNumber}/${totalBatches} completed successfully`);

  return outputText;
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
          error: "Claims analysis is required for research groups generation. Please wait for claims to complete first."
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

    // REQUIRE similar papers data
    if (
      !body.similarPapers ||
      typeof body.similarPapers !== "object" ||
      Array.isArray(body.similarPapers) ||
      (!body.similarPapers.text && !body.similarPapers.structured)
    ) {
      return NextResponse.json(
        {
          error: "Similar papers analysis is required for research groups generation. Please wait for similar papers to complete first."
        },
        { status: 400 }
      );
    }

    const similarPapersPayload: SimilarPapersPayload = {
      text: typeof body.similarPapers.text === "string" ? body.similarPapers.text : "",
      structured: body.similarPapers.structured
    };

    const paper: PaperPayload =
      body.paper && typeof body.paper === "object" && body.paper
        ? {
            title: typeof body.paper.title === "string" ? body.paper.title : null,
            doi: typeof body.paper.doi === "string" ? body.paper.doi : null,
            authors:
              Array.isArray(body.paper.authors) || typeof body.paper.authors === "string"
                ? body.paper.authors
                : null,
            abstract: typeof body.paper.abstract === "string" ? body.paper.abstract : null
          }
        : {};

    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      console.error("[research-groups] OPENAI_API_KEY is not configured.");
      return NextResponse.json({ error: "OpenAI API key is not configured." }, { status: 500 });
    }

    // Step 1: Prepare all papers for batching
    const allPapers = preparePaperBatches(paper, claims, similarPapersPayload);
    const BATCH_SIZE = 2;

    // Split papers into batches of 2
    const batches: PaperBatchItem[][] = [];
    for (let i = 0; i < allPapers.length; i += BATCH_SIZE) {
      batches.push(allPapers.slice(i, i + BATCH_SIZE));
    }

    console.log(`[research-groups] Processing ${allPapers.length} papers in ${batches.length} batches`, {
      totalPapers: allPapers.length,
      batchCount: batches.length,
      batchSize: BATCH_SIZE
    });

    // Step 2: Process each batch sequentially
    const batchResults: string[] = [];

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const batchNumber = i + 1;
      const startIndex = i * BATCH_SIZE + 1; // Paper numbering starts at 1

      try {
        const batchPrompt = buildBatchDiscoveryPrompt(batch, startIndex);
        const batchOutput = await fetchBatchDiscovery(batchPrompt, apiKey, batchNumber, batches.length);
        batchResults.push(batchOutput);
      } catch (error) {
        const message = error instanceof Error ? error.message : `Batch ${batchNumber} failed`;
        console.error(`[research-groups] Batch ${batchNumber} error:`, error);
        return NextResponse.json({ error: message }, { status: 502 });
      }
    }

    // Step 3: Combine all batch results
    const outputText = batchResults.join("\n\n---\n\n");

    console.log(`[research-groups] All ${batches.length} batches completed successfully`, {
      totalBatches: batches.length,
      combinedOutputLength: outputText.length
    });

    // Step 4: Convert the combined discovery notes to structured JSON
    const cleanupPrompt = buildCleanupPrompt(outputText);

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
          max_output_tokens: 16_384
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
        console.error("[research-groups] OpenAI cleanup error payload", errorPayload);
        if (typeof errorPayload?.error === "string") {
          message = errorPayload.error;
        } else if (typeof errorPayload?.message === "string") {
          message = errorPayload.message;
        }
      } catch (parseError) {
        console.warn("[research-groups] Failed to parse OpenAI cleanup error payload", parseError);
      }
      return NextResponse.json({ error: message }, { status: response2.status });
    }

    let payload2: any;

    try {
      payload2 = await response2.json();
    } catch (parseError) {
      console.error("[research-groups] Failed to parse JSON cleanup response", parseError);
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
      console.error("[research-groups] Empty cleanup response payload", payload2);
      return NextResponse.json({ error: "Model did not return cleanup JSON." }, { status: 502 });
    }

    // Try to parse the cleanup output as JSON
    let structuredGroups: any;
    try {
      // Remove markdown code fences if present
      const cleanedOutput = cleanupOutputText.replace(/^```json\s*\n?|\n?```\s*$/g, "").trim();
      structuredGroups = JSON.parse(cleanedOutput);
    } catch (parseError) {
      console.error("[research-groups] Failed to parse structured research groups JSON", parseError);
      console.error("[research-groups] Raw cleanup output:", cleanupOutputText);
      // Fall back to returning just the text analysis
      return NextResponse.json({ text: outputText, structured: null });
    }

    // Log success metrics
    const papersProcessed = structuredGroups?.papers?.length ?? 0;
    const totalAuthors = structuredGroups?.papers?.reduce((sum: number, paper: any) =>
      sum + (Array.isArray(paper.authors) ? paper.authors.length : 0), 0) ?? 0;

    console.log("[research-groups] Successfully completed both discovery and cleanup phases", {
      hasText: Boolean(outputText),
      hasStructured: Boolean(structuredGroups),
      papersProcessed,
      totalAuthors,
      avgAuthorsPerPaper: papersProcessed > 0 ? (totalAuthors / papersProcessed).toFixed(2) : 0
    });

    return NextResponse.json({
      text: outputText,
      structured: structuredGroups
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    console.error("[research-groups] Error:", error);
    return NextResponse.json({ error: `Failed to generate research groups: ${message}` }, { status: 500 });
  }
}
