import { NextResponse } from "next/server";

export const runtime = "nodejs";

interface PaperPayload {
  title?: string | null;
  doi?: string | null;
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

const DISCOVERY_PROMPT_TEMPLATE = `You are Evidentia's research co-pilot. Map the active research groups linked to these papers so our team can reach out to the right labs.

Source paper:
- Title: [SOURCE_TITLE]
- Summary: [SOURCE_SUMMARY]
[SOURCE_DOI]
[METHOD_SIGNALS]

Similar papers to cross-reference:
[SIMILAR_PAPERS]

Search Methodology:
1. Extract 3-5 core domain keywords from the source paper's method signals and similar papers' themes.
2. For each paper, run Google Scholar searches:
   - Use 'Since 2020' time filter to find recent work
   - Search: author names + 'lab' OR 'group' to find lab pages
   - Use site:.edu OR site:.ac.uk OR site:.ac.* filters for academic sources
3. Verify each group:
   - Check the group has 2-3+ publications since 2020 matching the domain keywords
   - Confirm an active lab/group webpage exists
   - Verify the PI is currently listed at that institution

Task:
- For the source paper and each similar paper, identify the active research groups, labs, or centres directly connected to those works.
- Under each paper heading, list relevant groups, then within each group list principal investigators, current graduate students, and postdoctoral researchers when available.

Finding Researchers & Contact Information:
- Check lab/group pages for current members (PhD students, postdocs, research staff)
- Review recent paper author lists (last 2 years) to identify current lab members
- Search institution directories for academic/institutional emails
- If email is not publicly listed, note 'Check lab website contact form' instead of 'Not provided'
- Prioritize finding at least 2-3 contacts per group with proper institutional emails

Required notes format (use plain text headings — no JSON yet):
Paper: <Title> (<Identifier>)
Groups:
  - Group: <Group name> (<Institution>)
    Website: <URL or 'Not provided'>
    Summary: <1–2 sentences on why this group matters for the methods>
    Members:
      - Name | Email | Role
      - Name | Email | Role

Guidelines:
- Only include groups you can verify are currently active with recent publications
- Repeat the group block for each paper that cites or collaborates with that group; if a group spans multiple papers, duplicate it under each relevant paper heading and note the connection in the summary.
- If information genuinely cannot be found after checking lab pages and recent papers, use 'Not provided', never leave blanks.
- Aim for depth over breadth: 3-5 well-researched groups with complete contact info beats 10 groups with missing details.`;

const CLEANUP_PROMPT_HEADER = `You are a cleanup agent. Convert the analyst's notes into strict JSON for Evidentia's Research Groups UI.

Output requirements:
- Return a single JSON object with keys: papers (array), promptNotes (optional string).
- Each paper object must include: title (string), identifier (string|null), groups (array).
- Each group object must include: name (string), institution (string|null), website (string|null), notes (string|null), researchers (array).
- Each researcher object must include: name (string), email (string|null), role (string|null).
- Use null for unknown scalars. Use "Not provided" only inside notes when text is genuinely missing.
- No markdown, no commentary, no trailing prose. Ensure valid JSON (double quotes only).
- Preserve factual content; do not invent new people or emails.
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

function buildDiscoveryPrompt(
  paper: PaperPayload,
  claims: ClaimsPayload,
  similarPapersText: string
): string {
  const title = paper.title && paper.title.trim().length > 0 ? paper.title.trim() : "Unknown title";
  const doiLine = paper.doi && paper.doi.trim() ? `- DOI: ${paper.doi.trim()}` : "";

  // Extract summary from claims
  const summaryLines = claims.structured?.executiveSummary
    ? limitList(claims.structured.executiveSummary, 3)
    : [cleanPlainText(paper.abstract || "Summary not provided in claims brief.")];

  const summary = summaryLines.join(" ");

  // Extract method signals from claims
  const methodSignals = claims.structured?.methodsSnapshot
    ? limitList(claims.structured.methodsSnapshot, 5)
    : [];

  const methodSignalsSection = methodSignals.length
    ? `- Method signals:\n${methodSignals.map(s => `  - ${s}`).join("\n")}`
    : "";

  // Include similar papers text directly
  const similarPapersSection = similarPapersText.trim();

  let prompt = DISCOVERY_PROMPT_TEMPLATE
    .replace("[SOURCE_TITLE]", title)
    .replace("[SOURCE_SUMMARY]", summary)
    .replace("[SOURCE_DOI]", doiLine)
    .replace("[METHOD_SIGNALS]", methodSignalsSection)
    .replace("[SIMILAR_PAPERS]", similarPapersSection);

  return prompt;
}

function buildCleanupPrompt(discoveryNotes: string): string {
  return `${CLEANUP_PROMPT_HEADER}\n\nAnalyst's research groups notes:\n\n${discoveryNotes}`;
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
    if (!body.similarPapers || typeof body.similarPapers !== "string" || body.similarPapers.trim().length === 0) {
      return NextResponse.json(
        {
          error: "Similar papers analysis is required for research groups generation. Please wait for similar papers to complete first."
        },
        { status: 400 }
      );
    }

    const similarPapersText = body.similarPapers.trim();

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

    const discoveryPrompt = buildDiscoveryPrompt(paper, claims, similarPapersText);

    // Step 1: Generate research groups discovery notes
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
          input: discoveryPrompt,
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
        console.error("[research-groups] OpenAI error payload", errorPayload);
        if (typeof errorPayload?.error === "string") {
          message = errorPayload.error;
        } else if (typeof errorPayload?.message === "string") {
          message = errorPayload.message;
        }
      } catch (parseError) {
        console.warn("[research-groups] Failed to parse OpenAI error payload", parseError);
      }
      return NextResponse.json({ error: message }, { status: response.status });
    }

    let payload: any;

    try {
      payload = await response.json();
    } catch (parseError) {
      console.error("[research-groups] Failed to parse JSON response", parseError);
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
      console.warn("[research-groups] Model response incomplete", payload.incomplete_details);
      if (outputText) {
        outputText = `${outputText}\n\n[Note: Response truncated because the model hit its output limit. Consider rerunning if key details are missing.]`;
      } else {
        return NextResponse.json(
          {
            error:
              payload.incomplete_details.reason === "max_output_tokens"
                ? "Research groups discovery hit the output limit before completing. Try again in a moment."
                : `Research groups discovery ended early: ${payload.incomplete_details.reason}`
          },
          { status: 502 }
        );
      }
    }

    if (!outputText) {
      console.error("[research-groups] Empty response payload", payload);
      return NextResponse.json({ error: "Model did not return any text." }, { status: 502 });
    }

    // Step 2: Convert the discovery notes to structured JSON
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
