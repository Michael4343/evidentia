import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_TEXT_LENGTH = 6_000;

const CONTACT_PROMPT = `You will receive a write-up describing up to five research groups, including brief descriptions of their activities.

Task:
- For each distinct research group mentioned, list researchers, leaders, staff, or students affiliated with it whenever their names appear in the text.
- If an email address is provided, include it. If no email is present, set the email field to null (do not invent addresses).
- If a name is missing but an email is present, leave the name as null.
- If neither name nor email is present for a person, omit them.

Output format:
Return a JSON array. Each item must be an object with the shape:
{
  "group": string,
  "people": [
    { "name": string | null, "email": string | null }
  ]
}
Only include groups that appear in the source text. Make sure the output is valid JSON with double-quoted keys.`;

function truncateText(text: string, limit: number) {
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit)}\n\n[Truncated input to ${limit} characters for the request]`;
}

function extractContactsArray(raw: string) {
  const candidates: string[] = [];
  if (raw.trim()) {
    candidates.push(raw.trim());
  }

  const fencedMatch = raw.match(/```json([\s\S]*?)```/i);
  if (fencedMatch && fencedMatch[1]) {
    candidates.push(fencedMatch[1].trim());
  }

  const bracketMatch = raw.match(/\[[\s\S]*\]/);
  if (bracketMatch && bracketMatch[0]) {
    candidates.push(bracketMatch[0].trim());
  }

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed)) {
        return parsed;
      }
      if (parsed && Array.isArray(parsed.contacts)) {
        return parsed.contacts;
      }
    } catch (error) {
      continue;
    }
  }

  return null;
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);

    if (!body || typeof body.text !== "string" || body.text.trim().length === 0) {
      return NextResponse.json({ error: "Missing research group text." }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      console.error("[research-group-contacts] OPENAI_API_KEY is not configured.");
      return NextResponse.json({ error: "OpenAI API key is not configured." }, { status: 500 });
    }

    const cleanedText = body.text.trim();
    const contextText = truncateText(cleanedText, MAX_TEXT_LENGTH);

    const prompt = `${CONTACT_PROMPT}\n\nResearch group write-up:\n${contextText}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, 600_000); // 10 minutes

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
          input: prompt,
          max_output_tokens: 4_000
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
        console.error("[research-group-contacts] OpenAI error payload", errorPayload);
        if (typeof errorPayload?.error === "string") {
          message = errorPayload.error;
        } else if (typeof errorPayload?.message === "string") {
          message = errorPayload.message;
        }
      } catch (parseError) {
        console.warn("[research-group-contacts] Failed to parse OpenAI error payload", parseError);
      }
      return NextResponse.json({ error: message }, { status: response.status });
    }

    let payload: any;

    try {
      payload = await response.json();
    } catch (parseError) {
      console.error("[research-group-contacts] Failed to parse JSON response", parseError);
      return NextResponse.json({ error: "Failed to read model response." }, { status: 502 });
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

    if (payload?.status === "incomplete" && payload?.incomplete_details?.reason) {
      console.warn("[research-group-contacts] Model response incomplete", payload.incomplete_details);
      if (textOutput) {
        textOutput = `${textOutput}\n\n[Note: Response truncated because the model hit its output limit.]`;
      } else {
        return NextResponse.json(
          {
            error:
              payload.incomplete_details.reason === "max_output_tokens"
                ? "Contact extraction hit the output limit. Try reducing the number of groups."
                : `Contact extraction ended early: ${payload.incomplete_details.reason}`
          },
          { status: 502 }
        );
      }
    }

    if (!textOutput) {
      console.error("[research-group-contacts] Empty response payload", payload);
      return NextResponse.json({ error: "Model did not return any text." }, { status: 502 });
    }

    const sanitised = textOutput.trim();

    const contacts = extractContactsArray(sanitised);
    if (!contacts) {
      console.error("[research-group-contacts] Failed to parse JSON payload", sanitised);
      return NextResponse.json({ error: "Model returned malformed JSON." }, { status: 502 });
    }

    if (!Array.isArray(contacts)) {
      return NextResponse.json({ error: "Model response was not an array." }, { status: 502 });
    }

    const normalised = contacts.map((item: any) => {
      const group = typeof item?.group === "string" ? item.group : "Unknown group";
      const rawPeople = Array.isArray(item?.people) ? item.people : [];
      const people = rawPeople
        .map((person: any) => {
          const name =
            typeof person?.name === "string" && person.name.trim().length > 0
              ? person.name.trim()
              : null;
          const email =
            typeof person?.email === "string" && person.email.trim().length > 0
              ? person.email.trim()
              : null;
          if (!name && !email) {
            return null;
          }
          return { name, email };
        })
        .filter((person: { name: string | null; email: string | null } | null): person is { name: string | null; email: string | null } => Boolean(person));
      return { group, people };
    });

    return NextResponse.json({ contacts: normalised });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    console.error("[research-group-contacts] Error:", error);
    return NextResponse.json({ error: `Failed to gather contacts: ${message}` }, { status: 500 });
  }
}
