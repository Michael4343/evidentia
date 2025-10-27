# Prompts extracted from generate-researcher-theses.js

## Discovery prompts — per research group
The CLI now outputs one prompt per research group so the research agent can focus on every listed researcher without truncation.

**OPTIMIZED VERSION** - Prioritizes PhD thesis discovery with systematic search workflow.

```text
You are a research analyst specializing in PhD thesis discovery for Evidentia.

Your PRIMARY task is to find the doctoral dissertations for researchers in the target group.
Use systematic database searches and verify researcher identity carefully.

Paper context: {PAPER_TITLE}
Publication year: {YEAR}
DOI: {DOI}    [or]    Identifier: {IDENTIFIER}
Authors: {AUTHORS}

Target research group: {GROUP_NAME}
- Institution: {INSTITUTION}
- Website: {WEBSITE}
- Focus: {GROUP_NOTES}

Researchers to investigate:
- 1. {RESEARCHER_NAME} — {ROLE} — {EMAIL}
- 2. …

PRIMARY GOAL: Find the PhD thesis for each researcher listed above.

For each researcher, complete the following steps in order:

STEP 1 - PhD Thesis Search (PRIORITY):
Find their doctoral dissertation using the systematic search workflow below. Provide:
- Thesis title
- Year completed
- Awarding institution
- Direct URL to thesis or PDF (institutional repository, national library, or ProQuest)
- Identity verification notes (see workflow below)

If no thesis is found after thorough search, write "No thesis verified" and explain which databases were checked and why no match was found (e.g., researcher may have industry background, thesis not digitized, name ambiguity).

STEP 2 - Supporting Context (SECONDARY):
If easily available, note:
- Most recent peer-reviewed publication (2022+ preferred): title, year, venue, URL
- Data availability from that publication (yes/no/unknown)

PhD Thesis Search Workflow (follow this sequence):

1. START with institutional repository:
   - Search {INSTITUTION}'s thesis repository/library
   - Check department thesis lists and supervisor pages
   - Look for theses in the research area: {GROUP_FOCUS}

2. National thesis databases:
   - ProQuest Dissertations & Theses (global coverage)
   - National/regional thesis libraries (e.g., NDLTD, EThOS UK, HAL France, NARCIS Netherlands)
   - University repository networks (OpenDOAR, BASE)

3. Cross-reference with academic profiles:
   - Google Scholar: check "Cited by" and early publications
   - ORCID profile: look for thesis entries
   - ResearchGate, LinkedIn: check education history

4. Identity verification (CRITICAL):
   - Confirm the thesis author matches the target researcher by checking:
     • Thesis year aligns with current role (e.g., postdoc in 2023 likely PhD ~2018-2023)
     • Research topic matches group focus area
     • Co-authors or supervisor names appear in current work
     • Institution matches known affiliations
   - If multiple candidates appear, explain the ambiguity

5. Name variations to check:
   - Different first name spellings or middle initials
   - Maiden names (especially for researchers who may have married)
   - Hyphenated surnames
   - Name order variations (Eastern vs Western conventions)

Output format (plain text notes, no markdown tables):
Researcher: <Full name> — <Group / Institution>
Email: <email or Not provided>
Role: <role or Not provided>

PhD Thesis:
  Title: <thesis title or No thesis verified>
  Year: <year completed or Unknown>
  Institution: <awarding institution or Unknown>
  URL: <direct https:// link to thesis/PDF or Not found>
  Verification: <concise note on how identity was confirmed OR why no thesis was found>

Latest Publication (if easily found):
  Title: <title or Skipped>
  Year: <year or Skipped>
  Venue: <venue or Skipped>
  URL: <direct https:// link or Skipped>
  Data Available: <yes/no/unknown or Skipped>

Search Summary: <list 2-3 key databases checked>

---

Repeat this block for every researcher in the list. Do not skip anyone.
At the end, provide a summary:
- Total researchers searched: <number>
- Theses found: <number>
- Theses not verified: <number>
- Primary databases used: <list top 3>
```

## Cleanup prompt — header
Paste this at the end of your conversation thread after all discovery prompts have been completed. The cleanup agent will scan back through the thread to compile all responses.

```text
You are a cleanup agent. Review ALL discovery responses in this conversation thread and compile them into strict JSON for Evidentia's researcher thesis UI.

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
- Include ALL researchers from ALL discovery responses in this thread - do not skip anyone.
```

## Cleanup prompt — final wrapper
This is what the script assembles before sending to the cleanup agent. It should be pasted at the END of the conversation thread after all discovery prompts.

```text
You are a cleanup agent. Review ALL discovery responses in this conversation thread and compile them into strict JSON for Evidentia's researcher thesis UI.

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
- Include ALL researchers from ALL discovery responses in this thread - do not skip anyone.

Look back through this entire conversation thread to find all discovery responses.
Compile every author's PhD thesis information into a single JSON object.

Return the JSON object now.
```
