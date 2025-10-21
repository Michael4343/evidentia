# Claims Analysis and Cleanup Prompts

These prompts were extracted from the provided script. Use them to run an initial analysis on raw PDF text, then convert the result into strict JSON for testing.

## How to use
1. Run **Prompt 1** with raw text from one or more scientific PDFs.
2. Paste the model’s textual summary into **Prompt 2** to get a strict JSON payload suitable for a claims UI.

---

## Prompt 1 — Claims analysis

```text
Objective: Produce a rigorous yet concise text-only summary of a scientific paper that clearly states the paper’s claims, the supporting evidence for each claim, and the gaps or limitations.

Context: You will receive raw text extracted from one or more scientific publication PDFs. Work strictly from this text (no external sources). If multiple papers are present, analyse each separately and add a brief cross-paper comparison.

Audience and Tone: Research analysts and domain experts. Tone: neutral, precise, evidence-centred, and concise.

Inputs:

Raw PDF text: [PASTE RAW TEXT HERE]

Optional metadata: [PAPER TITLE], [AUTHORS], [VENUE], [YEAR], [DOI/URL], [DISCIPLINE/DOMAIN], [TARGET AUDIENCE]

Optional scope constraints: [SECTIONS TO FOCUS ON], [MAX CLAIMS], [WORD LIMIT], [INCLUSION/EXCLUSION CRITERIA]

Optional rubric or definitions: [EVIDENCE STRENGTH RUBRIC], [CLAIM TYPES], [KEY OUTCOMES]

Constraints:

Text-only output (no JSON in this step).

Use Australian spelling and DD/MM/YYYY dates.

Base all findings strictly on the provided text; do not infer beyond it or browse externally.

Attribute every claim and evidence item to page/section/figure/table references where available.

Quote snippets ≤30 words; otherwise paraphrase faithfully.

Extract numerical results exactly as written (effect sizes, CIs, p-values, N, timeframes); round only if specified [ROUNDING RULES or 2 s.f.].

Flag OCR artefacts or ambiguities with [UNCLEAR] and state assumptions explicitly.

Prioritise concision and clarity; keep the full summary ≤[WORD LIMIT, e.g., 600–900 words].

Tools/Data:

Provided raw PDF text and optional metadata only.

If headings exist, segment by: Abstract, Introduction, Methods, Results, Discussion, Limitations, Conclusion, References.

Output Format:

Executive Summary (≤10 bullet points or ≤200 words): main claims, headline numbers, and overall evidence strength (High/Moderate/Low).

Key Claims and Evidence (bulleted list):

Claim ID: C1, C2, …

Claim (one sentence).

Evidence summary (design, sample, measures, analysis).

Key numbers (effect size, CI, p, N, timeframe).

Source location (page/section/figure/table).

Strength rating (High/Moderate/Low) and key assumptions/conditions.

Gaps & Limitations (categorised): data gaps, methodological weaknesses, external validity, unresolved confounders, missing comparisons, contradictions—link each to relevant Claim IDs.

Methods Snapshot (3–6 bullets): study design, sample, measures, analysis approach, preregistration/ethics [DETAIL NEEDED if absent].

Risk-of-Bias/Quality Checklist (tick/short notes): sampling, randomisation, blinding, missing data handling, multiplicity, selective reporting.

Open Questions & Next Steps (3–6 bullets): specific, testable follow-ups implied by the paper.

Cross-Paper Comparison (only if multiple papers): 3–5 bullets on points of agreement, divergence, and evidence quality.

Steps or Acceptance Criteria:

Parse and segment the raw text; note missing sections explicitly.

Extract distinct, testable claims; if >[MAX CLAIMS], prioritise the top [MAX CLAIMS] by centrality (presence in abstract/conclusion, frequency, emphasis) and list the remainder briefly.

For each claim, locate and summarise direct supporting evidence with precise source locations and key numbers.

Classify evidence type (e.g., RCT, observational, simulation, qualitative, prior work) and rate strength using a transparent rubric:

High: appropriate design, adequate N, consistent results, clear statistics.

Moderate: some limitations (e.g., small N, partial controls).

Low: anecdotal/speculative or weakly supported.

Identify gaps/limitations and tie them to affected Claim IDs.

Provide a concise methods snapshot and risk-of-bias checklist based only on stated details.

Ensure concision and coherence: no redundant text; all claims have strength ratings and location references or [DETAIL NEEDED] if absent.

Final QA: all required sections present; numbers match the text exactly; all quotes ≤30 words; all claims tie back to the supplied text.
```

---

## Prompt 2 — Cleanup to strict JSON

```text
You are a cleanup agent. Convert the analyst's claims summary into strict JSON for Evidentia's claims UI.

Output requirements:
- Return a single JSON object with keys: text (string), structured (object), promptNotes (optional string).
- text must reproduce the analyst's formatted summary exactly (including headings and bullet markers). Replace every newline with 
 and escape embedded double quotes with " so the string parses in JSON.
- structured.executiveSummary: array of strings (each one bullet).
- structured.claims: array of objects with keys { id, claim, evidenceSummary, keyNumbers (array of strings), source, strength, assumptions, evidenceType }.
  - strength must be one of "High", "Moderate", "Low", "Unclear".
  - Use empty arrays for missing keyNumbers; use null for unknown scalars.
- structured.gaps: array of objects { category, detail, relatedClaimIds (array of strings) }.
- structured.methodsSnapshot: array of strings.
- structured.riskChecklist: array of objects { item, status, note }. Status must be one of "met", "partial", "missing", "unclear" (lowercase).
- structured.openQuestions: array of strings.
- structured.crossPaperComparison: array of strings (omit when not applicable).
- Output raw JSON only — no markdown fences, comments, trailing prose, or extra keys. Validate the payload with JSON.parse before responding.
- Preserve factual content; do not invent new claims or numbers. When details are missing, use placeholders like "[DETAIL NEEDED]" exactly as written.
```
