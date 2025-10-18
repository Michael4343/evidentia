import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_TEXT_LENGTH = 12_000;

interface PaperPayload {
  title?: string | null;
  doi?: string | null;
  scraped_url?: string | null;
  url?: string | null;
  authors?: Array<string | { name?: string | null }> | string | null;
  abstract?: string | null;
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

function buildPrompt(paper: PaperPayload): string {
  const title = paper.title && paper.title.trim().length > 0 ? paper.title.trim() : "Unknown title";
  const doiOrId =
    (paper.doi && paper.doi.trim()) ||
    (paper.scraped_url && paper.scraped_url.trim()) ||
    (paper.url && paper.url.trim()) ||
    "Not provided";
  const authors = formatAuthors(paper.authors);
  const abstractLine =
    paper.abstract && paper.abstract.trim().length > 0
      ? `- Optional: Abstract: ${paper.abstract.trim()}`
      : "- Optional: Abstract: not provided";

  return [
    "You are running a deep-research pass to gather every detail needed for Evidentia’s reproducibility briefing and method crosswalk. Focus on completeness and factual accuracy rather than polished prose. Use plain English. Avoid domain-specific or medical jargon; prefer general words like \"equipment\", \"materials\", \"samples\", \"procedure\", \"quality checks\".",
    "",
    "Inputs",
    `- Title: ${title}`,
    `- DOI or ID: ${doiOrId}`,
    `- Authors: ${authors}`,
    abstractLine,
    "",
    "Output",
    "Produce a detailed research dossier that a human operator can later transform into structured data. Use headings and bullet lists where helpful, but strict formatting is not required.",
    "",
    "Tasks",
    "",
    "PART 1 - Reproducibility (plain language)",
    "",
    "1.1 Overall verdict",
    '- State the overall reproducibility level using the pattern “Highly reproducible for…”, “Moderately reproducible with…”, or “Limited reproducibility due to…”. Add the plain-language gating factor.',
    "",
    "1.2 Feasibility snapshot",
    "- Create 5-7 yes/no capability checks a typical lab or team can use to self-assess.",
    "- Each item must:",
    '  - Start with "Do you have", "Can you", or "Are you equipped to"',
    '  - Target a specific capability, resource, or infrastructure need',
    '  - Include a one-sentence "why this matters" note',
    '  - Be concrete and checkable',
    "- Use general terms. Do not use technical or medical jargon.",
    "- Present as a list so the operator can extract question, importance, and supporting rationale.",
    "",
    "PART 2 - Method & finding crosswalk (build a small related set)",
    "",
    "Goal: Find 3-5 papers whose methods are similar to the input paper. Prioritise method overlap over topic keywords and capture the information needed for Evidentia’s crosswalk.",
    "",
    "Search approach",
    "- Derive neutral method terms from the input (e.g., sample type, preparation steps, equipment class, control style, readout type).",
    "- Create 3-5 search queries that mix these terms with general synonyms.",
    "- Prefer papers that:",
    '  - Clearly describe materials, equipment, steps, controls, readouts, and quality checks',
    '  - Include code, data, or supplementary methods',
    '  - Have non-paywalled summaries when possible',
    "- Keep language plain in all outputs.",
    "",
    "For each selected paper, compile the following details so the operator can later structure them:",
    "- Identifier (Semantic Scholar ID, DOI, or stable hash).",
    '- Title, concise author list (“Surname et al.” for 3+ authors).',
    "- Venue and year.",
    "- Citation count (or note if not reported).",
    '- Cluster label: choose “Sample and model”, “Field deployments”, or “Insight primers” and explain why it fits.',
    "- Two to three sentences summarising why the methods align.",
    '- Highlight line: if the abstract yields a key signal use “Signal from abstract: …”, else “Signal from editorial or summary in <venue>”.',
    '- Matrix covering sampleModel, materialsRatios, equipmentSetup, procedureSteps, controls, outputsMetrics, qualityChecks, outcomeSummary using plain language. Mark any missing info as “not reported”.',
    "",
    "Housekeeping",
    "- Capture sources for every fact (links, DOIs, or figure/table references).",
    "- Note any uncertainties or gaps so the operator can follow up.",
    "- Output format beyond clear headings/lists is flexible—the priority is gathering complete, well-cited information."
  ].join("\n");
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

    const basePrompt = buildPrompt(paper);
    const cleanedText = body.text.trim();
    const { text: truncatedText, truncated } = truncateText(cleanedText, MAX_TEXT_LENGTH);

    const assembledPrompt = [
      basePrompt,
      "",
      truncated
        ? `Extracted PDF text (truncated to ${MAX_TEXT_LENGTH} characters):`
        : "Extracted PDF text:",
      truncatedText
    ].join("\n");

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
          input: assembledPrompt,
          max_output_tokens: 4_096
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

    if (payload?.status === "incomplete" && payload?.incomplete_details?.reason) {
      console.warn("[similar-papers] Model response incomplete", payload.incomplete_details);
      return NextResponse.json(
        {
          error:
            payload.incomplete_details.reason === "max_output_tokens"
              ? "Similar paper search hit the output limit. Try again in a moment."
              : `Similar paper search ended early: ${payload.incomplete_details.reason}`
        },
        { status: 502 }
      );
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

    if (!outputText) {
      console.error("[similar-papers] Empty response payload", payload);
      return NextResponse.json({ error: "Model did not return any text." }, { status: 502 });
    }

    return NextResponse.json({ text: outputText });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    console.error("[similar-papers] Error:", error);
    return NextResponse.json({ error: `Failed to gather similar papers: ${message}` }, { status: 500 });
  }
}
