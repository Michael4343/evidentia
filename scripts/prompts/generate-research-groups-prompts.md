# Prompts extracted from generate-research-groups.js

## Overview

The author contacts script mirrors production by running a **two-prompt workflow**:

1. **Discovery + Contact Gathering** – For each paper, focus on the first author, last author, and corresponding author (deduplicated when one person holds multiple roles) and capture full contact details.
2. **Cleanup** – Convert those notes into the structured JSON consumed by the app.

With 1 source paper + up to 5 similar papers you still gather at most ~18 contacts, but they now represent the academically relevant decision-makers instead of a generic "first three" slice.

---

## Prompt 1: Discovery + Contact Gathering

Identify the first, last, and corresponding authors for each paper and capture their contact information in one pass.

### Template

```text
Objective: For EACH paper below, gather contact information for the FIRST author, LAST author, and CORRESPONDING author.

Context: You're building a collaboration pipeline for research analysts. For each paper, identify the key authors (first, last, corresponding) and find their complete contact details. You have web search tools enabled—use them immediately.

Papers to analyze:

1. SOURCE PAPER:
   Title: {SOURCE_TITLE}
   Identifier: {SOURCE_IDENTIFIER}
   Key authors to prioritise:
     - {FIRST_AUTHOR} (first author)
     - {LAST_AUTHOR} (last author)
     - {CORRESPONDING_AUTHOR} (corresponding author)
     - Corresponding author not marked; confirm during research.  # include when unknown
   Full author list (ordered):
     1. {AUTHOR_1}
     2. {AUTHOR_2}
     ...

2. SIMILAR PAPER 1:
   Title: {PAPER_TITLE_1}
   Venue: {VENUE_1} ({YEAR_1})
   Identifier: {IDENTIFIER_1}
   Key authors to prioritise:
     - {FIRST_AUTHOR}
     - {LAST_AUTHOR}
     - {CORRESPONDING_AUTHOR}
   Full author list (ordered):
     1. {AUTHOR_1}
     2. {AUTHOR_2}

[... continue for all similar papers]

Task:

For each paper:
1. Identify the FIRST, LAST, and CORRESPONDING authors (deduplicate when roles overlap).
2. For each author, gather comprehensive contact information:
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

[If a paper has fewer than 3 total authors, include all authors instead.]

Important:
- Execute all searches automatically without asking for permission
- Use 'Not found' when information genuinely can't be located after thorough search
- ORCID format: 0000-0000-0000-0000 (16 digits with hyphens)
- Only include profiles that are publicly accessible
- For each paper, include: first author, last author, and corresponding author (deduplicated when the same person fills multiple roles)
- If a corresponding author is not clearly marked, make your best determination based on affiliation or contact clues
- Prioritize institutional emails over personal emails
```

---

## Prompt 2: Cleanup — Convert to JSON

After gathering all author contacts, use this to convert to structured JSON.

### Template

```text
You are a cleanup agent. Convert the analyst's notes into strict JSON for Evidentia's Author Contacts UI.

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
- Each paper should have up to 3 authors: first author, last author, and corresponding author (deduplicated if the same person appears in multiple roles). For papers with fewer than 3 total authors, include all authors.
Before responding, you must paste the analyst notes after these instructions so you can structure them. Use them verbatim; do not add new facts.

Refer to the analyst notes in the previous message (do not paste them here).
---
[Notes already provided above]
---
Return the JSON object now.
```

---

## Example JSON Output

```json
{
  "papers": [
    {
      "title": "Example Source Paper Title",
      "identifier": "10.1234/source",
      "authors": [
        {
          "name": "Jane Smith",
          "email": "jsmith@stanford.edu",
          "role": "First author",
          "orcid": "0000-0002-1234-5678",
          "profiles": [
            {"platform": "Google Scholar", "url": "https://scholar.google.com/citations?user=ABC123"},
            {"platform": "LinkedIn", "url": "https://linkedin.com/in/janesmith"}
          ]
        },
        {
          "name": "John Doe",
          "email": "jdoe@stanford.edu",
          "role": "Last author / corresponding author",
          "orcid": "0000-0003-9876-5432",
          "profiles": [
            {"platform": "Google Scholar", "url": "https://scholar.google.com/citations?user=XYZ789"}
          ]
        },
        {
          "name": "Alice Johnson",
          "email": null,
          "role": "Co-author (supporting)",
          "orcid": "0000-0001-2345-6789",
          "profiles": [
            {"platform": "Google Scholar", "url": "https://scholar.google.com/citations?user=DEF456"}
          ]
        }
      ]
    },
    {
      "title": "Similar Paper 1 Title",
      "identifier": "10.1234/similar1",
      "authors": [
        {
          "name": "Bob Lee",
          "email": "bob@berkeley.edu",
          "role": "First author",
          "orcid": "0000-0004-5678-9012",
          "profiles": [
            {"platform": "Google Scholar", "url": "https://scholar.google.com/citations?user=GHI789"},
            {"platform": "Personal Website", "url": "https://boblee.com"}
          ]
        },
        {
          "name": "Carol Martinez",
          "email": "carol@berkeley.edu",
          "role": "Last author / corresponding author",
          "orcid": null,
          "profiles": [
            {"platform": "LinkedIn", "url": "https://linkedin.com/in/carolmartinez"}
          ]
        }
      ]
    }
  ],
  "promptNotes": "Captured key author contacts (first/last/corresponding) for each paper. Total: 5 authors across 2 papers."
}
```
