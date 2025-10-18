import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_RESEARCHERS = 10;

const PROMPT = `You will receive a JSON array describing research group members. Each item contains a group label and an array of people with names and optional emails.

Task (do not exceed 200 tokens in your answer):
1. For each researcher, identify their most recent publication (2022 or later when possible). Provide title, year, venue, and URL when available.
2. Identify their PhD thesis if verifiable (title, year, institution, URL). If none is found, set thesis to null.
3. State whether data for their latest publication is publicly available ("yes", "no", or "unknown").

Guidelines:
- Use web search only when necessary; prefer official records and repositories.
- If you cannot confirm a field, leave it null rather than inventing details.
- Keep reasoning minimal; focus on the final JSON fulfilment.

Output format:
Return a JSON array of researcher objects shaped as:
{
  "name": string,
  "email": string | null,
  "group": string | null,
  "latest_publication": {
    "title": string | null,
    "year": number | null,
    "venue": string | null,
    "url": string | null
  },
  "phd_thesis": {
    "title": string | null,
    "year": number | null,
    "institution": string | null,
    "url": string | null
  } | null,
  "data_publicly_available": "yes" | "no" | "unknown"
}
Return valid JSON with double-quoted keys. If no researchers are provided, return an empty array.`;

function serialisePayload(payload: unknown) {
  return JSON.stringify(payload, null, 2);
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);

    if (!body || !Array.isArray(body.contacts)) {
      return NextResponse.json({ error: "Missing contacts array." }, { status: 400 });
    }

    const contacts = body.contacts as Array<{
      group: string;
      people: Array<{ name: string | null; email: string | null }>;
    }>;

    const filtered = contacts
      .flatMap((entry) =>
        entry.people
          .filter((person) => typeof person.name === "string" && person.name.trim().length > 0)
          .slice(0, MAX_RESEARCHERS)
          .map((person) => ({
            name: person.name,
            email: person.email,
            group: entry.group ?? null
          }))
      )
      .slice(0, MAX_RESEARCHERS);

    if (filtered.length === 0) {
      return NextResponse.json({ researchers: [] });
    }

    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      console.error("[researcher-theses] OPENAI_API_KEY is not configured.");
      return NextResponse.json({ error: "OpenAI API key is not configured." }, { status: 500 });
    }

    const promptInput = `${PROMPT}\n\nResearch group JSON:\n${serialisePayload(filtered)}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 300_000);

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
          tools: [{ type: "web_search", search_context_size: "low" }],
          tool_choice: "auto",
          input: promptInput,
          max_output_tokens: 2048,
          max_tool_calls: 10
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
        console.error("[researcher-theses] OpenAI error payload", errorPayload);
        if (typeof errorPayload?.error === "string") {
          message = errorPayload.error;
        } else if (typeof errorPayload?.message === "string") {
          message = errorPayload.message;
        }
      } catch (parseError) {
        console.warn("[researcher-theses] Failed to parse OpenAI error payload", parseError);
      }
      return NextResponse.json({ error: message }, { status: response.status });
    }

    let payload: any;

    try {
      payload = await response.json();
    } catch (parseError) {
      console.error("[researcher-theses] Failed to parse JSON response", parseError);
      return NextResponse.json({ error: "Failed to read model response." }, { status: 502 });
    }

    if (payload?.status === "incomplete" && payload?.incomplete_details?.reason) {
      console.warn("[researcher-theses] Model response incomplete", payload.incomplete_details);
      return NextResponse.json(
        {
          error:
            payload.incomplete_details.reason === "max_output_tokens"
              ? "Researcher lookup hit the output limit. Try again or reduce the number of contacts."
              : `Researcher lookup ended early: ${payload.incomplete_details.reason}`
        },
        { status: 502 }
      );
    }

    let textOutput = typeof payload?.output_text === "string" ? payload.output_text.trim() : "";

    if (!textOutput && Array.isArray(payload?.output)) {
      textOutput = payload.output
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

    if (!textOutput) {
      console.error("[researcher-theses] Empty response payload", payload);
      return NextResponse.json({ error: "Model did not return any text." }, { status: 502 });
    }

    const sanitised = textOutput
      .replace(/^```json\s*/i, "")
      .replace(/```$/i, "")
      .trim();

    let researchers;

    try {
      researchers = JSON.parse(sanitised);
    } catch (parseError) {
      console.error("[researcher-theses] Failed to parse JSON payload", sanitised, parseError);
      return NextResponse.json({ error: "Model returned malformed JSON." }, { status: 502 });
    }

    if (!Array.isArray(researchers)) {
      return NextResponse.json({ error: "Model response was not an array." }, { status: 502 });
    }

    const normalised = researchers.map((item: any) => ({
      name: typeof item?.name === "string" ? item.name : null,
      email: typeof item?.email === "string" ? item.email : null,
      group: typeof item?.group === "string" ? item.group : null,
      latest_publication: {
        title: typeof item?.latest_publication?.title === "string" ? item.latest_publication.title : null,
        year: typeof item?.latest_publication?.year === "number" ? item.latest_publication.year : null,
        venue: typeof item?.latest_publication?.venue === "string" ? item.latest_publication.venue : null,
        url: typeof item?.latest_publication?.url === "string" ? item.latest_publication.url : null
      },
      phd_thesis: item?.phd_thesis && typeof item.phd_thesis === "object"
        ? {
            title: typeof item.phd_thesis.title === "string" ? item.phd_thesis.title : null,
            year: typeof item.phd_thesis.year === "number" ? item.phd_thesis.year : null,
            institution: typeof item.phd_thesis.institution === "string" ? item.phd_thesis.institution : null,
            url: typeof item.phd_thesis.url === "string" ? item.phd_thesis.url : null
          }
        : null,
      data_publicly_available: item?.data_publicly_available === "yes" || item?.data_publicly_available === "no"
        ? item.data_publicly_available
        : "unknown"
    }));

    return NextResponse.json({ researchers: normalised });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    console.error("[researcher-theses] Error:", error);
    return NextResponse.json({ error: `Failed to gather researcher details: ${message}` }, { status: 500 });
  }
}
