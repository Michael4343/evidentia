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
    "You are building a Similar Papers crosswalk for Evidentia. Focus entirely on method-level overlap and actionable signals that help a founder understand how related teams ran comparable work. Use concise, plain English.",
    "",
    "Inputs",
    `- Title: ${title}`,
    `- DOI or ID: ${doiOrId}`,
    `- Authors: ${authors}`,
    abstractLine,
    "",
    "Deliverables",
    "- Summarise the source paper's methods (2-3 sentences) and call out the 3-5 method signals we will use when pitching it to founders (keyMethods array).",
    "- Surface 5-10 high-signal similar papers. Method overlap beats topical similarity.",
    "",
    "Search playbook",
    "- Derive neutral method terms from the PDF (sample model, preparation steps, equipment classes, control style, readout type, QC practices).",
    "- Generate 4-6 diversified search queries mixing those terms with synonyms (e.g., \"aggregates micro-CT stable isotope probing\").",
    "- Prioritise papers that:",
    '  - Describe materials, equipment, controls, readouts, and QC steps clearly',
    '  - Provide supplementary protocols, data, or code',
    '  - Are accessible via arXiv, publisher OA versions, or lab websites',
    "- Keep language plain; avoid jargon unless it is unavoidable (then explain it).",
    "",
    "For each selected paper (5-10 total):",
    "- identifier: DOI, Semantic Scholar ID, or other stable handle.",
    "- whyRelevant: 2-3 sentences explaining the method overlap and what a founder should copy or avoid.",
    "- overlapHighlights: 3-4 bullet fragments (<=12 words) naming concrete overlaps (e.g., 'Micro-CT pore segmentation', '13C glucose SIP').",
    "- methodMatrix: fill every field; if a point is missing, return 'not reported'.",
    "- clusterLabel: choose “Sample and model”, “Field deployments”, or “Insight primers” and explain the reasoning in whyRelevant.",
    "",
    "Answer with a concise narrative that a cleanup agent can later structure into JSON. Do not format as JSON yourself.",
    "Highlight the key method signals for the source paper (3-5 bullet points).",
    "For each similar paper (5-10 total) write 2-3 sentences explaining the method overlap, note the cluster label rationale, list 3 short overlap bullets, and quote any concrete gaps or uncertainties.",
    "Stay within ~1,800 tokens overall; be specific but efficient.",
    "",
    "Return the narrative summary now."
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
          max_output_tokens: 6_144
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

    return NextResponse.json({ text: outputText });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    console.error("[similar-papers] Error:", error);
    return NextResponse.json({ error: `Failed to gather similar papers: ${message}` }, { status: 500 });
  }
}
