import { NextResponse } from "next/server";

export const runtime = "nodejs";

const CLEANUP_PROMPT_HEADER = `You are a cleanup agent. Review ALL discovery responses in this conversation thread and compile them into strict JSON for Evidentia's researcher thesis UI.

Task: Scan back through this conversation to find all author thesis discovery responses. Compile every author's information into a single JSON object.

Output requirements:
- Return a single JSON object with keys: researchers (array), promptNotes (optional string).
- Each researcher object must include: name (string), email (string|null),
  latest_publication (object with title (string|null), year (number|null), venue (string|null), url (string|null)),
  phd_thesis (null or object with title (string|null), year (number|null), institution (string|null), url (string|null)),
  data_publicly_available ("yes" | "no" | "unknown").
- Use null for unknown scalars. Use lowercase for data_publicly_available values.
- Every url field must be a direct https:// link. If the discovery responses include markdown links or reference-style footnotes, extract the underlying URL. Never leave a url blank when a working link was provided.
- For phd_thesis.url, prefer PDF/download URLs when multiple links are available. Only use null when no link was found or it is explicitly unavailable.
- No markdown, commentary, or trailing prose. Valid JSON only (double quotes).
- Preserve factual content from the discovery responses; do not invent new theses or publications.
- Include ALL researchers from ALL discovery responses in this thread - do not skip anyone.`;

interface Author {
  name?: string;
  email?: string | null;
  role?: string | null;
  orcid?: string | null;
}

interface Paper {
  title?: string;
  identifier?: string | null;
  year?: number | null;
  authors?: Author[];
}

interface AuthorContactsStructured {
  papers?: Paper[];
}

interface AuthorContactsPayload {
  structured?: AuthorContactsStructured;
}

interface FilteredPaper {
  title: string;
  identifier: string | null;
  year: number | null;
  authors: Array<{
    name: string;
    email: string | null;
    role: string | null;
  }>;
}

function cleanPlainText(input: string): string {
  if (typeof input !== "string") {
    return "";
  }
  return input.replace(/\r\n/g, "\n").trim();
}

/**
 * Filter to key authors per paper: First author + Corresponding/PI author
 * Falls back to positional last author if no corresponding author found by role
 */
function filterToKeyAuthors(papers: Paper[]): FilteredPaper[] {
  return papers
    .map((paper) => {
      const paperTitle = cleanPlainText(paper?.title || "");
      if (!paperTitle) {
        return null;
      }

      const authors = paper?.authors || [];
      if (authors.length === 0) {
        return null;
      }

      const keyAuthors: Array<{ name: string; email: string | null; role: string | null }> = [];

      // Find first author (role-based or positional)
      const firstAuthorByRole = authors.find((a) =>
        a?.role?.toLowerCase().includes("first author")
      );
      const firstAuthor = firstAuthorByRole || authors[0];

      if (firstAuthor?.name) {
        keyAuthors.push({
          name: cleanPlainText(firstAuthor.name),
          email: firstAuthor.email || null,
          role: firstAuthor.role ? cleanPlainText(firstAuthor.role) : null
        });
      }

      // Find corresponding/PI author (role-based)
      const correspondingAuthor = authors.find((a) => {
        const role = a?.role?.toLowerCase() || "";
        return (
          role.includes("corresponding") ||
          role.includes("pi") ||
          role.includes("principal investigator") ||
          role.includes("senior author")
        );
      });

      if (correspondingAuthor && correspondingAuthor.name && correspondingAuthor.name !== firstAuthor.name) {
        keyAuthors.push({
          name: cleanPlainText(correspondingAuthor.name),
          email: correspondingAuthor.email || null,
          role: correspondingAuthor.role ? cleanPlainText(correspondingAuthor.role) : null
        });
      } else if (!correspondingAuthor && authors.length > 1) {
        // Fallback to last positional author if no corresponding found
        const lastAuthor = authors[authors.length - 1];
        if (lastAuthor?.name && lastAuthor.name !== firstAuthor.name) {
          keyAuthors.push({
            name: cleanPlainText(lastAuthor.name),
            email: lastAuthor.email || null,
            role: lastAuthor.role ? cleanPlainText(lastAuthor.role) : "Last author"
          });
        }
      }

      if (keyAuthors.length === 0) {
        return null;
      }

      return {
        title: paperTitle,
        identifier: paper.identifier ? cleanPlainText(paper.identifier) : null,
        year: typeof paper.year === "number" ? paper.year : null,
        authors: keyAuthors
      };
    })
    .filter((p): p is FilteredPaper => p !== null);
}

/**
 * Build a discovery prompt for a single paper's key authors
 * Matches the pattern from generate-researcher-theses.js
 */
function buildDiscoveryPromptForPaper(paper: FilteredPaper): string {
  const lines = [
    "You are a research analyst specializing in PhD thesis discovery for Evidentia.",
    "",
    "Your PRIMARY task is to find the doctoral dissertations for the paper authors listed below.",
    "Use systematic database searches and verify researcher identity carefully.",
    ""
  ];

  lines.push(`Paper: ${paper.title}`);
  if (paper.year !== null) {
    lines.push(`Publication year: ${paper.year}`);
  }
  if (paper.identifier) {
    lines.push(`Identifier: ${paper.identifier}`);
  }

  lines.push("", "Authors to investigate:");
  paper.authors.forEach((author, index) => {
    const details = [`${index + 1}. ${author.name}`];
    if (author.role) {
      details.push(author.role);
    }
    if (author.email) {
      details.push(author.email);
    }
    lines.push(`- ${details.join(" — ")}`);
  });

  lines.push(
    "",
    "PRIMARY GOAL: Find the PhD thesis for each researcher listed above.",
    "",
    "For each researcher, complete the following steps in order:",
    "",
    "STEP 1 - PhD Thesis Search (PRIORITY):",
    "Find their doctoral dissertation using the systematic search workflow below. Provide:",
    "- Thesis title",
    "- Year completed",
    "- Awarding institution",
    "- Direct URL to thesis or PDF (institutional repository, national library, or ProQuest)",
    "- Identity verification notes (see workflow below)",
    "",
    "If no thesis is found after thorough search, write \"No thesis verified\" and explain which databases were checked and why no match was found (e.g., researcher may have industry background, thesis not digitized, name ambiguity).",
    "",
    "STEP 2 - Supporting Context (SECONDARY):",
    "If easily available, note:",
    "- Most recent peer-reviewed publication (2022+ preferred): title, year, venue, URL",
    "- Data availability from that publication (yes/no/unknown)",
    "",
    "PhD Thesis Search Workflow (follow this sequence):",
    "",
    "1. START with institutional repositories:",
    "   - Use the author's current/known affiliation to search their institution's thesis repository",
    "   - Check department thesis lists and supervisor pages",
    "   - Look for theses related to the paper's research topic",
    "",
    "2. National thesis databases:",
    "   - ProQuest Dissertations & Theses (global coverage)",
    "   - National/regional thesis libraries (e.g., NDLTD, EThOS UK, HAL France, NARCIS Netherlands)",
    "   - University repository networks (OpenDOAR, BASE)",
    "",
    "3. Cross-reference with academic profiles:",
    "   - Google Scholar: check \"Cited by\" and early publications",
    "   - ORCID profile: look for thesis entries",
    "   - ResearchGate, LinkedIn: check education history",
    "",
    "4. Identity verification (CRITICAL):",
    "   - Confirm the thesis author matches the target researcher by checking:",
    "     • Thesis year aligns with current role (e.g., postdoc in 2023 likely PhD ~2018-2023)",
    "     • Research topic matches the paper's focus area",
    "     • Co-authors or supervisor names appear in their publication history",
    "     • Institution matches known affiliations",
    "   - If multiple candidates appear, explain the ambiguity",
    "",
    "5. Name variations to check:",
    "   - Different first name spellings or middle initials",
    "   - Maiden names (especially for researchers who may have married)",
    "   - Hyphenated surnames",
    "   - Name order variations (Eastern vs Western conventions)",
    "",
    "Output format (plain text notes, no markdown tables):",
    "Researcher: <Full name>",
    "Email: <email or Not provided>",
    "Role: <role or Not provided>",
    "",
    "PhD Thesis:",
    "  Title: <thesis title or No thesis verified>",
    "  Year: <year completed or Unknown>",
    "  Institution: <awarding institution or Unknown>",
    "  URL: <direct https:// link to thesis/PDF or Not found>",
    "  Verification: <concise note on how identity was confirmed OR why no thesis was found>",
    "",
    "Latest Publication (if easily found):",
    "  Title: <title or Skipped>",
    "  Year: <year or Skipped>",
    "  Venue: <venue or Skipped>",
    "  URL: <direct https:// link or Skipped>",
    "  Data Available: <yes/no/unknown or Skipped>",
    "",
    "Search Summary: <list 2-3 key databases checked>",
    "",
    "---",
    "",
    "Repeat this block for every author in the list. Do not skip anyone.",
    `At the end, provide a summary:`,
    `- Total authors searched: ${paper.authors.length}`,
    "- Theses found: <number>",
    "- Theses not verified: <number>",
    "- Primary databases used: <list top 3>"
  );

  return lines.join("\n");
}

/**
 * Build cleanup prompt that aggregates multiple discovery responses
 */
function buildCleanupPrompt(allDiscoveryNotes: string): string {
  return `${CLEANUP_PROMPT_HEADER}\n\nAnalyst's researcher thesis notes (from multiple discovery passes):\n\n${allDiscoveryNotes}`;
}

/**
 * Execute a single OpenAI API call with timeout and error handling
 */
async function callOpenAI(
  prompt: string,
  options: {
    apiKey: string;
    timeout?: number;
    maxTokens?: number;
    useWebSearch?: boolean;
  }
): Promise<string> {
  const { apiKey, timeout = 600_000, maxTokens = 8_192, useWebSearch = false } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const requestBody: any = {
      model: "gpt-5-mini-2025-08-07",
      reasoning: { effort: "low" },
      input: prompt,
      max_output_tokens: maxTokens
    };

    if (useWebSearch) {
      requestBody.tools = [{ type: "web_search", search_context_size: "medium" }];
      requestBody.tool_choice = "auto";
    }

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });

    if (!response.ok) {
      let message = "OpenAI request failed.";
      try {
        const errorPayload = await response.json();
        if (typeof errorPayload?.error === "string") {
          message = errorPayload.error;
        } else if (typeof errorPayload?.message === "string") {
          message = errorPayload.message;
        }
      } catch (parseError) {
        console.warn("[researcher-theses] Failed to parse OpenAI error payload", parseError);
      }
      throw new Error(message);
    }

    const payload = await response.json();

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
        outputText = `${outputText}\n\n[Note: Response truncated because the model hit its output limit.]`;
      } else {
        throw new Error(
          payload.incomplete_details.reason === "max_output_tokens"
            ? "Researcher thesis discovery hit the output limit. Try again."
            : `Researcher thesis discovery ended early: ${payload.incomplete_details.reason}`
        );
      }
    }

    if (!outputText) {
      throw new Error("Model did not return any text.");
    }

    return outputText;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);

    // Validate input - expect author contacts structured data
    if (!body?.authorContacts || !body.authorContacts.structured) {
      return NextResponse.json(
        {
          error: "Author contacts data required. Please wait for author contacts to complete first."
        },
        { status: 400 }
      );
    }

    const authorContacts = body.authorContacts as AuthorContactsPayload;
    const papers = authorContacts?.structured?.papers || [];

    if (papers.length === 0) {
      return NextResponse.json({ error: "No papers found in author contacts data." }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error("[researcher-theses] OPENAI_API_KEY is not configured.");
      return NextResponse.json({ error: "OpenAI API key is not configured." }, { status: 500 });
    }

    // Filter to key authors (first + corresponding/PI)
    const filteredPapers = filterToKeyAuthors(papers);

    if (filteredPapers.length === 0) {
      return NextResponse.json({ error: "No key authors found in papers." }, { status: 400 });
    }

    const totalAuthors = filteredPapers.reduce((sum, p) => sum + p.authors.length, 0);
    console.log(`[researcher-theses] Processing ${filteredPapers.length} papers with ${totalAuthors} key authors`);

    // STEP 1: Sequential discovery - one prompt per paper
    const discoveryNotes: string[] = [];

    for (let i = 0; i < filteredPapers.length; i++) {
      const paper = filteredPapers[i];
      console.log(
        `[researcher-theses] Discovery ${i + 1}/${filteredPapers.length}: ${paper.title} (${paper.authors.length} authors)`
      );

      const discoveryPrompt = buildDiscoveryPromptForPaper(paper);

      try {
        const discoveryResponse = await callOpenAI(discoveryPrompt, {
          apiKey,
          timeout: 600_000,
          maxTokens: 8_192,
          useWebSearch: true
        });

        discoveryNotes.push(discoveryResponse);
        console.log(
          `[researcher-theses] Discovery ${i + 1}/${filteredPapers.length} completed (${discoveryResponse.length} chars)`
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "Discovery request failed.";
        console.error(`[researcher-theses] Discovery ${i + 1}/${filteredPapers.length} failed:`, error);
        // Continue with other papers even if one fails
        discoveryNotes.push(
          `[Discovery failed for paper: ${paper.title}]\nError: ${message}\nSkipping these authors: ${paper.authors.map((a) => a.name).join(", ")}`
        );
      }
    }

    if (discoveryNotes.length === 0) {
      return NextResponse.json({ error: "All discovery attempts failed." }, { status: 502 });
    }

    // Combine all discovery notes
    const allDiscoveryText = discoveryNotes.join("\n\n---\n\n");

    // STEP 2: Cleanup - convert aggregated notes to structured JSON
    console.log(`[researcher-theses] Running cleanup on ${allDiscoveryText.length} chars of discovery notes`);

    const cleanupPrompt = buildCleanupPrompt(allDiscoveryText);

    let cleanupResponse: string;
    try {
      cleanupResponse = await callOpenAI(cleanupPrompt, {
        apiKey,
        timeout: 600_000,
        maxTokens: 8_192,
        useWebSearch: false
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Cleanup request failed.";
      console.error("[researcher-theses] Cleanup failed:", error);
      return NextResponse.json({ error: `Cleanup failed: ${message}` }, { status: 502 });
    }

    // Parse structured output
    let structuredTheses: any;
    try {
      // Remove markdown code fences if present
      const cleanedOutput = cleanupResponse.replace(/^```json\s*\n?|\n?```\s*$/g, "").trim();
      structuredTheses = JSON.parse(cleanedOutput);
    } catch (parseError) {
      console.error("[researcher-theses] Failed to parse structured JSON", parseError);
      console.error("[researcher-theses] Raw cleanup output:", cleanupResponse);
      // Fall back to returning just the text analysis
      return NextResponse.json({ text: allDiscoveryText, structured: null });
    }

    console.log(
      `[researcher-theses] Success: ${structuredTheses?.researchers?.length || 0} researchers compiled`
    );

    return NextResponse.json({
      text: allDiscoveryText,
      structured: structuredTheses
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    console.error("[researcher-theses] Error:", error);
    return NextResponse.json({ error: `Failed to gather researcher details: ${message}` }, { status: 500 });
  }
}
