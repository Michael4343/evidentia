# Prompts extracted from generate-patents.js

## Discovery prompt — scaffold
Use this with your research agent. Fill the placeholders for paper metadata and paste claims under the scaffolded section.

```text
Objective: Identify 3-5 patents that validate the paper's claims through substantive technical overlap.

Context: You have a claims brief from a scientific paper. Search patent databases to find granted patents and published applications that cover similar technical approaches. Focus on validation evidence—patents that demonstrate the paper's methods have been independently developed and claimed in the patent literature.

Inputs:

Paper: {PAPER_TITLE}
DOI: {PAPER_DOI}  [optional]

Claims from the paper:

C1: {CLAIM_1}
   Evidence: {EVIDENCE_1}  [optional]
   Type: {EVIDENCE_TYPE_1}  [optional]

C2: {CLAIM_2}
   Evidence: {EVIDENCE_2}  [optional]
   Type: {EVIDENCE_TYPE_2}  [optional]

Constraints:

- Return 3-5 patents with the strongest technical overlap (quality over quantity).
- Include both granted patents and published applications.
- Bias toward recent filings (last 10 years) when relevance is comparable.
- Focus on substantive technical overlap, not just keyword matches.
- For each patent, explain HOW the patent claims map to specific paper methods (be specific about the technical elements that overlap).

Output Format:

For each patent provide:
- Patent number (e.g., US1234567B2, WO2020123456A1)
- Title
- Assignee (company/institution)
- Filing date and grant date (if granted)
- Brief abstract (1-2 sentences)
- Which paper claims this patent relates to (e.g., C1, C3)
- Technical overlap summary: 2-3 sentences explaining HOW the patent's technical claims map to specific methods/techniques in the paper. Be specific about algorithms, materials, apparatus, or applications that overlap.
- URL to patent document (Google Patents link)

Steps:

1. Extract specific technical elements from each paper claim: algorithms, compositions, materials, apparatus, methods, or applications.
2. Search patent databases (Google Patents, USPTO, EPO, WIPO) using these technical elements.
3. For each candidate patent, read the claims section and identify which patent claims cover similar technical approaches.
4. Map patent claim language to the paper's technical elements and note the overlap.
5. Select the 3-5 patents with the most substantive technical overlap to the paper's claims.
6. For each selected patent, write a 2-3 sentence technical summary explaining the specific overlap.
7. If fewer than 3 patents have substantive overlap, return what you find and note which claims lack patent coverage.
```

## Cleanup prompt — header
Give this to a cleanup agent, then paste the analyst notes beneath the divider and request strict JSON.

```text
You are a cleanup agent. Convert the analyst's patent search notes into strict JSON for Evidentia's patent UI.

Context: You should receive notes for 3-5 patents that validate the paper's claims through substantive technical overlap.

Output requirements:
- Return a single JSON object with keys: patents (array of 3-5 items), promptNotes (optional string).
- Each patent object must include: patentNumber (string), title (string), assignee (string|null), filingDate (string|null), grantDate (string|null), abstract (string|null), overlapWithPaper (object with claimIds array and summary string), url (string).
- Use null for unknown scalars. Use empty arrays for missing claimIds arrays only.
- CRITICAL: Every patent MUST have a url field with a Google Patents link. Construct it as: https://patents.google.com/patent/{PATENT_NUMBER}
  Examples:
  * US7729863B2 → https://patents.google.com/patent/US7729863B2
  * WO2022272120A1 → https://patents.google.com/patent/WO2022272120A1
  * EP3438287B1 → https://patents.google.com/patent/EP3438287B1
- Dates should be in YYYY-MM-DD format when available.
- overlapWithPaper.claimIds should reference the paper claim IDs (e.g., ["C1", "C3"]). This array shows which claims are validated by this patent.
- overlapWithPaper.summary MUST be a detailed 2-3 sentence explanation of HOW the patent's technical claims map to specific methods/techniques in the paper. Be specific about the technical overlap—this is validation evidence.
- No markdown, commentary, or trailing prose. Valid JSON only (double quotes).
- Preserve factual content from the notes; do not invent new patents.
- Output raw JSON only — no markdown fences, comments, trailing prose, or extra keys.
```

## Cleanup prompt — final wrapper
This is what the script assembles before sending to the cleanup agent.

```text
You are a cleanup agent. Convert the analyst's patent search notes into strict JSON for Evidentia's patent UI.

Output requirements:
- Return a single JSON object with keys: patents (array), promptNotes (optional string).
- Each patent object must include: patentNumber (string), title (string), assignee (string|null), filingDate (string|null), grantDate (string|null), abstract (string|null), overlapWithPaper (object with claimIds array and summary string), url (string|null).
- Use null for unknown scalars. Use empty arrays for missing arrays.
- Every url field must be a direct https:// link to the patent (Google Patents, USPTO, etc.).
- Dates should be in YYYY-MM-DD format when available.
- overlapWithPaper.claimIds should reference the paper claim IDs (e.g., ["C1", "C3"]).
- overlapWithPaper.summary MUST be a detailed 2-3 sentence explanation of HOW the patent's technical claims map to specific methods/techniques in the paper. Be specific about the technical overlap.
- No markdown, commentary, or trailing prose. Valid JSON only (double quotes).
- Preserve factual content from the notes; do not invent new patents.
- Output raw JSON only — no markdown fences, comments, trailing prose, or extra keys.

Refer to the analyst notes in the previous message (do not paste them here).
---
[Notes already provided above]
---
Return the JSON object now.
```
