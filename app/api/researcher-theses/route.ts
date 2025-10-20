import { NextResponse } from "next/server";

export const runtime = "nodejs";

const CLEANUP_PROMPT_HEADER = `You are a cleanup agent. Convert the analyst's notes into strict JSON for Evidentia's researcher thesis UI.

Output requirements:
- Return a single JSON object with keys: researchers (array), promptNotes (optional string).
- Each researcher object must include: name (string), email (string|null), group (string|null),
  latest_publication (object with title (string|null), year (number|null), venue (string|null), url (string|null)),
  phd_thesis (null or object with title (string|null), year (number|null), institution (string|null), url (string|null)),
  data_publicly_available ("yes" | "no" | "unknown").
- Use null for unknown scalars. Use lowercase for data_publicly_available values.
- Every url field must be a direct https:// link. If the notes provide a markdown link or reference-style footnote, extract the underlying URL and place it in the url field. Never leave a url blank when the notes include a working link.
- For phd_thesis.url, copy the repository/download link from the analyst notes' "Data access link" column; if multiple are provided, prefer the PDF/download URL. Only set null when no link is given or it is explicitly unavailable.
- No markdown, commentary, or trailing prose. Valid JSON only (double quotes).
- Preserve factual content from the notes; do not invent new theses or publications.
- Output raw JSON only — no markdown fences, comments, trailing prose, or extra keys.`;

interface ResearchGroup {
  name?: string;
  institution?: string | null;
  website?: string | null;
  notes?: string | null;
  researchers?: Array<{
    name?: string;
    email?: string | null;
    role?: string | null;
  }>;
}

interface Paper {
  title?: string;
  identifier?: string | null;
  groups?: ResearchGroup[];
}

interface ResearchGroupsStructured {
  papers?: Paper[];
}

interface ResearchGroupsPayload {
  structured?: ResearchGroupsStructured;
}

function cleanPlainText(input: string): string {
  if (typeof input !== "string") {
    return "";
  }
  return input.replace(/\r\n/g, "\n").trim();
}

function buildDiscoveryPrompt(researchGroups: ResearchGroupsPayload): string {
  const papers = researchGroups?.structured?.papers || [];

  if (papers.length === 0) {
    throw new Error("No papers found in research groups data.");
  }

  // Extract all researchers from all groups across all papers
  const allResearchers: Array<{
    name: string;
    email: string | null;
    group: string;
    institution: string;
    website: string;
    notes: string;
    paper: string;
  }> = [];

  papers.forEach((paper) => {
    const paperTitle = cleanPlainText(paper?.title || "Unknown paper");
    const groups = paper?.groups || [];

    groups.forEach((group) => {
      const groupName = cleanPlainText(group?.name || "Unknown group");
      const institution = cleanPlainText(group?.institution || "");
      const website = cleanPlainText(group?.website || "");
      const notes = cleanPlainText(group?.notes || "");
      const researchers = group?.researchers || [];

      researchers.forEach((researcher) => {
        const name = cleanPlainText(researcher?.name || "");
        if (name.length > 0) {
          allResearchers.push({
            name,
            email: researcher?.email || null,
            group: groupName,
            institution,
            website,
            notes,
            paper: paperTitle
          });
        }
      });
    });
  });

  if (allResearchers.length === 0) {
    throw new Error("No researchers found in research groups data.");
  }

  const lines = [
    "You are a research analyst identifying PhD theses and publications.",
    "",
    "Task:",
    "For each researcher listed below, find:",
    "1. Most recent publication (2022 or later preferred) - title, year, venue, URL",
    "2. PhD thesis if verifiable - title, year, institution, direct thesis URL",
    "3. Data availability for latest publication - yes/no/unknown",
    "",
    "Research Groups and Members:",
    ""
  ];

  // Group researchers by paper for better context
  const researchersByPaper = new Map<string, typeof allResearchers>();
  allResearchers.forEach((r) => {
    if (!researchersByPaper.has(r.paper)) {
      researchersByPaper.set(r.paper, []);
    }
    researchersByPaper.get(r.paper)!.push(r);
  });

  researchersByPaper.forEach((researchers, paperTitle) => {
    lines.push(`Paper: ${paperTitle}`);

    const researchersByGroup = new Map<string, typeof researchers>();
    researchers.forEach((r) => {
      if (!researchersByGroup.has(r.group)) {
        researchersByGroup.set(r.group, []);
      }
      researchersByGroup.get(r.group)!.push(r);
    });

    researchersByGroup.forEach((groupResearchers, groupName) => {
      const sample = groupResearchers[0];
      const meta: string[] = [];
      if (sample?.institution) {
        meta.push(sample.institution);
      }
      if (sample?.website) {
        meta.push(sample.website);
      }
      if (sample?.notes) {
        meta.push(sample.notes);
      }

      const metaLine = meta.length > 0 ? ` (${meta.join(" · ")})` : "";
      lines.push(`  Group: ${groupName}${metaLine}`);
      groupResearchers.forEach((r) => {
        const emailPart = r.email ? ` (${r.email})` : "";
        lines.push(`    - ${r.name}${emailPart}`);
      });
    });
    lines.push("");
  });

  lines.push(
    "Guidelines:",
    "- Use web search to verify official records and repositories for each researcher individually.",
    "- Prefer institutional repositories, Google Scholar, DBLP, Semantic Scholar, and university thesis databases.",
    "- If you cannot confirm a field after reasonable searching, write 'Not found' for that specific field instead of skipping it.",
    "- Never return a blanket statement that nothing was found; produce an entry for every researcher listed.",
    "- For thesis URLs, prioritise direct PDF/download links from trusted sources; otherwise provide the best official landing page.",
    "- Cite sources or reasoning briefly so downstream systems can trace provenance.",
    "",
    "Output format (plain text notes, no JSON yet):",
    "For each researcher, use this exact format:",
    "",
    "Researcher: [Name] ([Group / Institution])",
    "Email: [email or Not provided]",
    "Latest Publication: [title] ([year]) - [venue]",
    "Publication URL: [direct link or Not found]",
    "PhD Thesis: [title] ([year]) - [institution]",
    "Thesis URL: [direct link or Not found]",
    "Data Available: [yes/no/unknown]",
    "Evidence: [short note on search hits, repositories, or reasoning]",
    ""
  );

  return lines.join("\n");
}

function buildCleanupPrompt(discoveryNotes: string): string {
  return `${CLEANUP_PROMPT_HEADER}\n\nAnalyst's researcher thesis notes:\n\n${discoveryNotes}`;
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);

    // Validate input - expect research groups structured data
    if (!body?.researchGroups || !body.researchGroups.structured) {
      return NextResponse.json(
        {
          error: "Research groups data required. Please wait for research groups to complete first."
        },
        { status: 400 }
      );
    }

    const researchGroups = body.researchGroups as ResearchGroupsPayload;

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error("[researcher-theses] OPENAI_API_KEY is not configured.");
      return NextResponse.json({ error: "OpenAI API key is not configured." }, { status: 500 });
    }

    // Build discovery prompt
    let discoveryPrompt: string;
    try {
      discoveryPrompt = buildDiscoveryPrompt(researchGroups);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to build discovery prompt.";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    // STEP 1: Discovery with web search
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
          model: "gpt-5-mini-2025-08-07",
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
      console.warn("[researcher-theses] Model response incomplete", payload.incomplete_details);
      if (outputText) {
        outputText = `${outputText}\n\n[Note: Response truncated because the model hit its output limit. Consider rerunning if key details are missing.]`;
      } else {
        return NextResponse.json(
          {
            error:
              payload.incomplete_details.reason === "max_output_tokens"
                ? "Researcher thesis discovery hit the output limit before completing. Try again in a moment."
                : `Researcher thesis discovery ended early: ${payload.incomplete_details.reason}`
          },
          { status: 502 }
        );
      }
    }

    if (!outputText) {
      console.error("[researcher-theses] Empty response payload", payload);
      return NextResponse.json({ error: "Model did not return any text." }, { status: 502 });
    }

    // STEP 2: Cleanup - convert notes to structured JSON
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
          model: "gpt-5-mini-2025-08-07",
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
        console.error("[researcher-theses] OpenAI cleanup error payload", errorPayload);
        if (typeof errorPayload?.error === "string") {
          message = errorPayload.error;
        } else if (typeof errorPayload?.message === "string") {
          message = errorPayload.message;
        }
      } catch (parseError) {
        console.warn("[researcher-theses] Failed to parse OpenAI cleanup error payload", parseError);
      }
      return NextResponse.json({ error: message }, { status: response2.status });
    }

    let payload2: any;
    try {
      payload2 = await response2.json();
    } catch (parseError) {
      console.error("[researcher-theses] Failed to parse JSON cleanup response", parseError);
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
      console.error("[researcher-theses] Empty cleanup response payload", payload2);
      return NextResponse.json({ error: "Model did not return cleanup JSON." }, { status: 502 });
    }

    // Parse structured output
    let structuredTheses: any;
    try {
      // Remove markdown code fences if present
      const cleanedOutput = cleanupOutputText.replace(/^```json\s*\n?|\n?```\s*$/g, "").trim();
      structuredTheses = JSON.parse(cleanedOutput);
    } catch (parseError) {
      console.error("[researcher-theses] Failed to parse structured JSON", parseError);
      console.error("[researcher-theses] Raw cleanup output:", cleanupOutputText);
      // Fall back to returning just the text analysis
      return NextResponse.json({ text: outputText, structured: null });
    }

    return NextResponse.json({
      text: outputText,
      structured: structuredTheses
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    console.error("[researcher-theses] Error:", error);
    return NextResponse.json({ error: `Failed to gather researcher details: ${message}` }, { status: 500 });
  }
}
