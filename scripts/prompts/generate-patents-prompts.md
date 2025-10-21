# Prompts extracted from generate-patents.js

## Discovery prompt — scaffold
Use this with your research agent. Fill the placeholders for paper metadata and paste claims under the scaffolded section.

```text
Goal: For each claim below, identify relevant patents that cover similar methods, compositions, systems, or applications. Focus on granted patents and published applications that overlap with the technical approaches described. Provide rigorous technical analysis of how patent claims map to specific paper methods.

Methodology:
1. For each paper claim, extract specific technical elements:
   - Algorithms, computational methods, or analytical approaches
   - Compositions, materials, or chemical structures
   - Apparatus, devices, or instrumentation
   - Applications, use cases, or therapeutic methods
2. Search patent databases (Google Patents, USPTO, EPO, WIPO) for patents covering those elements.
3. For each patent found, perform technical claim mapping:
   - Identify which specific patent claims cover similar approaches
   - Map patent claim language to paper's technical elements
   - Explain HOW the patent claims cover the paper's methods (be specific)
   - Note both broad coverage and narrow technical overlap
4. Prioritize patents with substantive technical overlap, not just keyword matches.
5. For each patent, write a 2-3 sentence technical summary explaining the overlap.

Claims from the paper:
C1: {CLAIM_1}
   Evidence: {EVIDENCE_1}  [optional]
   Type: {EVIDENCE_TYPE_1}  [optional]

C2: {CLAIM_2}
   Evidence: {EVIDENCE_2}  [optional]
   Type: {EVIDENCE_TYPE_2}  [optional]

s technical elements",
    "   - Explain HOW the patent claims cover the paper

Deliverable:
- Return plain text with one section per patent found.
- For each patent, provide:
  * Patent number (e.g., US1234567, EP9876543, WO2020123456)
  * Title
  * Assignee (company/institution)
  * Filing date and grant date (if granted)
  * Brief abstract (1-2 sentences)
  * Which paper claims this patent relates to (e.g., C1, C3)
  * Technical overlap summary (2-3 sentences explaining HOW the patent claims map to specific paper methods/techniques)
  * URL to patent document (Google Patents, USPTO, etc.)
- Include 5-10 most relevant patents with substantive technical overlap.
- Focus on quality over quantity - only include patents with clear technical mapping.
- If no patents are found for certain claims, note that explicitly.
```

## Cleanup prompt — header
Give this to a cleanup agent, then paste the analyst notes beneath the divider and request strict JSON.

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
