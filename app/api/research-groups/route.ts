import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_TEXT_LENGTH = 8_000;

const RESEARCH_PROMPT = `You are assisting a researcher who just uploaded the following paper. Read the paper carefully and identify its core themes, methods, and subject domains. The paper context below is the primary signal; only include research groups whose recent work directly overlaps the paper’s topics.

Task:
Find and rank up to five current (active within the last 3–5 years) research groups or independent organisations whose published work is tightly aligned with this paper. Use web search only to confirm activity and surface supporting details; do not include unrelated groups.

For each group, include:
- Group name and affiliated institution
- One-sentence explanation of how their focus connects to the paper (reference the specific overlap you saw in the extracted text)
- One recent publication, project, or initiative (2021 or later) showing the overlap, with year and citation if available
- Contact information or URL if available

Also provide:
- A 1–2 sentence summary of the paper themes that guided your search
- A ranked list explanation (why each group is ordered the way it is)
- A short note if web results were sparse or older than 2021

Output in plain text with clear section headers and bullet lists. Keep the overall answer under roughly 280 tokens. If no groups match, state that explicitly and explain why.`;

function truncateText(text: string, limit: number) {
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit)}\n\n[Truncated input to ${limit} characters for the request]`;
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);

    if (!body || typeof body.text !== "string" || body.text.trim().length === 0) {
      return NextResponse.json({ error: "Missing extracted text." }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      console.error("[research-groups] OPENAI_API_KEY is not configured.");
      return NextResponse.json({ error: "OpenAI API key is not configured." }, { status: 500 });
    }

    const cleanedText = body.text.trim();
    const contextText = truncateText(cleanedText, MAX_TEXT_LENGTH);
    const hasTruncated = contextText.length !== cleanedText.length;

    const contextSegments: string[] = [];

    const title = typeof body.paperName === "string" && body.paperName.trim().length > 0 ? body.paperName.trim() : null;
    const doi = typeof body.doi === "string" && body.doi.trim().length > 0 ? body.doi.trim() : null;

    contextSegments.push(RESEARCH_PROMPT);

    contextSegments.push(
      [
        "Paper context:",
        `• Title: ${title ?? "Unknown"}`,
        `• DOI: ${doi ?? "Unknown"}`,
        hasTruncated ? "• Note: PDF text truncated to fit request limits." : null
      ]
        .filter(Boolean)
        .join("\n")
    );

    contextSegments.push("Extracted paper text:\n" + contextText);

    const assembledPrompt = contextSegments.join("\n\n");

    const startedAt = Date.now();

    console.log("[research-groups] outgoing request", {
      textChars: cleanedText.length,
      truncated: hasTruncated,
      promptChars: assembledPrompt.length
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, 600_000);

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
          tools: [{ type: "web_search" }],
          tool_choice: "auto",
          input: assembledPrompt,
          max_output_tokens: 4096
        }),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeoutId);
    }

    const finishedAt = Date.now();

    console.log("[research-groups] openai response", {
      status: response.status,
      durationMs: finishedAt - startedAt
    });

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
      return NextResponse.json(
        { error: "Failed to read model response." },
        { status: 502 }
      );
    }

    if (payload?.status === "incomplete" && payload?.incomplete_details?.reason) {
      console.warn("[research-groups] Model response incomplete", payload.incomplete_details);
      return NextResponse.json(
        {
          error: payload.incomplete_details.reason === "max_output_tokens"
            ? "The model ran out of response tokens before finishing. Try again in a moment."
            : `The model response was incomplete: ${payload.incomplete_details.reason}`
        },
        { status: 502 }
      );
    }

    let outputText = typeof payload?.output_text === "string" ? payload.output_text.trim() : "";

    if (!outputText && Array.isArray(payload?.output)) {
      outputText = payload.output
        .filter((item: any) =>
          item && item.type === "message" && Array.isArray(item.content)
        )
        .flatMap((item: any) =>
          item.content
            .filter((part: any) => part?.type === "output_text" && typeof part.text === "string")
            .map((part: any) => part.text)
        )
        .join("\n")
        .trim();
    }

    const lowLevelOutput = Array.isArray(payload?.output)
      ? payload.output
          .map((item: any) => {
            if (Array.isArray(item?.content)) {
              return item.content
                .filter((part: any) => typeof part?.text === "string")
                .map((part: any) => part.text)
                .join("\n");
            }
            return "";
          })
          .join("\n")
          .trim()
      : "";

    if (!outputText && lowLevelOutput) {
      outputText = lowLevelOutput;
    }

    if (!outputText) {
      console.error("[research-groups] Empty response payload", payload);
      return NextResponse.json({ error: "Model did not return any text." }, { status: 502 });
    }

    console.log("[research-groups] returning payload", {
      outputPreview: outputText.slice(0, 120)
    });

    return NextResponse.json({ text: outputText });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    console.error("[research-groups] Error:", error);
    return NextResponse.json({ error: `Failed to gather research groups: ${message}` }, { status: 500 });
  }
}
