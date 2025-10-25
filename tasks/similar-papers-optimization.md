# Similar Papers Optimization Workflow

**Context:** We're applying the same optimization approach used for the Claims section to the Similar Papers section. This follows our successful pattern: optimize prompts → test → deploy to API → beautify UI.

---

## Phase 1: Optimize Prompts in Script & Test

**Goal:** Update `scripts/generate-similar-papers.js` with streamlined prompts and verify output quality.

### Files to Update:
- `scripts/generate-similar-papers.js`

### Current Issues:

**Discovery Prompt (lines 665-760):**
- Verbose template with 1000-token target (too loose)
- Prescriptive structure with numbered papers and detailed templates
- No "low verbosity" behavioral directive
- Generic clustering labels may not suit all papers
- Heavy method matrix template (8 fields)

**Cleanup Prompt (lines 43-61):**
- Verbose output requirements list
- Prescribed cluster labels
- Complex methodMatrix schema (8 keys)

### Optimization Changes:

#### Discovery Prompt (buildDiscoveryPrompt function):

**Before:** Prescriptive template with numbered structure
**After:** Natural, streamlined format

```
Objective: Identify 3-5 papers with the highest methodological overlap to the source paper, based on its claims analysis.

Context: You have a claims brief (top 3 claims, evidence, gaps, methods). Work strictly from this brief—do not re-open the PDF. Focus on method similarity, not just topical relevance.

Audience: Research analysts comparing experimental approaches.

Inputs:
- Source paper claims brief
- Title, authors, identifier

Constraints:

Low verbosity, high reasoning; prioritize producing the answer efficiently.

Find 3-5 papers maximum—rank by methodological overlap (instrumentation, controls, sample handling).

Link each paper to specific claims/gaps/next-steps from the brief.

Use "Not reported" for missing information.

Output Format:

Source Paper Context: brief synthesis from claims

Similar Papers (3-5 only):

For each paper:
- Title, authors, year, venue, identifier
- Why relevant (focus on method overlap)
- Key overlaps (3 specific points)
- Method comparison (sample, materials, procedure, key outcomes)
- Gaps or uncertainties

Steps:

1. Extract method signals from claims brief
2. Rank candidates by executable method overlap
3. Select top 3-5
4. Map each back to brief (which claim/gap it addresses)
5. QA: all papers have method comparison and overlap points; stop once checks pass
```

#### Cleanup Prompt (CLEANUP_PROMPT_HEADER):

**Before:** Verbose list format
**After:** Streamlined 2-section format (Schema + Validation)

```
Objective: Convert similar papers notes into strict JSON (expects 3-5 papers max).

Context: Deterministic ETL process; preserve content exactly, validate schema, avoid extra keys or prose.

Schema Requirements:

Return a single JSON object with keys: sourcePaper, similarPapers, promptNotes (optional).

sourcePaper: { summary (string), keyMethodSignals (array of strings) }

similarPapers (array, 3-5 items): {
  identifier (string),
  title (string),
  authors (array of strings),
  year (number|null),
  venue (string|null),
  whyRelevant (string),
  methodOverlap (array of exactly 3 strings),
  methodComparison: {
    sample (string),
    materials (string),
    procedure (string),
    outcomes (string)
  },
  gaps (string|null)
}

Output raw JSON only — no markdown fences, comments, or trailing prose. Must be valid under JSON.parse.

Preserve factual content; use "Not reported" for missing data.

Keep verbosity low; terminate once validation succeeds.

Validation Steps:

1. Ingest analyst notes exactly as provided
2. Parse into structured fields (sourcePaper, similarPapers)
3. Ensure 3-5 papers max
4. Populate all required fields; use "Not reported" for missing method data
5. Validate with JSON.parse; fix and re-validate if invalid
6. Stop when valid
```

### Testing Steps:

1. **Update the prompts** in `scripts/generate-similar-papers.js`:
   - Replace `buildDiscoveryPrompt` function (lines 665-760)
   - Replace `CLEANUP_PROMPT_HEADER` constant (lines 43-61)

2. **Run the script:**
   ```bash
   node scripts/generate-similar-papers.js
   ```

3. **Test with a PDF:**
   - Select a PDF with existing claims data
   - Copy discovery prompt to Claude/GPT
   - Review textual output quality
   - Copy cleanup prompt
   - Verify JSON structure

4. **Quality Checks:**
   - ✅ Produces 3-5 papers (not more)
   - ✅ Method overlap is specific and actionable
   - ✅ Links back to claims brief
   - ✅ Method comparison is simplified (4 fields vs 8)
   - ✅ JSON validates cleanly
   - ✅ No verbose exploration or unnecessary detail

### Checkpoint:
Once the script produces clean, focused output, proceed to Phase 2.

---

## Phase 2: Apply Optimized Prompts to API

**Goal:** Update the PDF upload workflow to use optimized prompts.

### Files to Update:
- `app/api/similar-papers/route.ts`

### Implementation Steps:

1. **Locate the prompts** in the API route:
   - Find the discovery prompt template
   - Find the cleanup prompt template

2. **Replace with optimized versions:**
   - Copy the exact optimized prompts from Phase 1
   - Ensure metadata handling remains intact
   - Keep the two-step workflow (discovery → cleanup)

3. **Verify the API:**
   ```bash
   npx tsc --noEmit
   ```

4. **Test the endpoint:**
   - Upload a PDF through the app
   - Check Claims tab generates properly
   - Check Similar Papers tab triggers
   - Verify output structure matches optimized schema

### Key Changes:
- Discovery prompt: Add "low verbosity, high reasoning" directive
- Discovery prompt: Focus on 3-5 papers max
- Discovery prompt: Simplified method comparison (4 fields)
- Cleanup prompt: Streamlined 2-section format
- Cleanup prompt: Simplified methodComparison schema

### Checkpoint:
Once the API produces clean output matching the script, proceed to Phase 3.

---

## Phase 3: UI Optimization - Mock Template

**Goal:** Transform `SimilarPapersStructuredView` into a beautiful, human-friendly interface (test with mock data first).

### File to Update:
- `app/page.tsx` (function `SimilarPapersStructuredView`, starting around line 1918)

### Current UI Issues:

- Heavy table with method matrix (8 rows × N papers)
- Uppercase tracking labels everywhere (`text-xs font-semibold uppercase tracking-[0.18em]`)
- Dense information, hard to scan
- Boxes within boxes
- No visual hierarchy
- Database-like presentation

### New UI Design:

**Inspired by Claims UI Success:**

```
┌─────────────────────────────────────────────┐
│ At a glance: Source paper synthesis in a    │ (gradient bg)
│ natural paragraph with blue accent label    │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐ (elevated card)
│ Similar Paper 1                              │
│                                              │
│ Full Title of the Paper Here                │ (XL bold)
│ Authors · Year · Venue                       │ (metadata line)
│                                              │
│ ┌───────────────────────────────────────┐  │
│ ║ Why relevant: Method overlap focus... │  │ (blue tint + accent)
│ └───────────────────────────────────────┘  │
│                                              │
│ Key overlaps:                               │
│ • Specific overlap point 1                  │
│ • Specific overlap point 2                  │
│ • Specific overlap point 3                  │
│                                              │
│ Method comparison:                          │
│ Sample: Description here                    │
│ Materials: Description here                 │
│ Procedure: Description here                 │
│ Outcomes: Description here                  │
│                                              │
│ ┌───────────────────────────────────────┐  │
│ ║ Gaps: Limitations or uncertainties... │  │ (amber tint + accent)
│ └───────────────────────────────────────┘  │
└─────────────────────────────────────────────┘

[Repeat for papers 2-5]
```

### Design Specifications:

**At a Glance Section:**
```tsx
<section className="bg-gradient-to-r from-blue-50/50 to-slate-50/50 rounded-xl p-6 border border-blue-100/50">
  <p className="text-base leading-relaxed text-slate-700">
    <span className="text-blue-700 font-semibold">At a glance:</span>
    {" "}
    {sourcePaper.summary}
  </p>
</section>
```

**Paper Cards:**
```tsx
<article className="bg-white rounded-xl shadow-lg hover:shadow-xl transition-shadow duration-200 p-8 space-y-5 border border-slate-100">
  {/* Paper header */}
  <div>
    <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">
      Similar Paper {index + 1}
    </p>
    <h4 className="mt-2 text-xl font-bold leading-tight tracking-tight text-slate-900">
      {paper.title}
    </h4>
    <p className="mt-1 text-sm text-slate-600">
      {paper.authors.join(", ")} · {paper.year} · {paper.venue}
    </p>
  </div>

  {/* Why relevant - blue accent */}
  <div className="bg-blue-50/30 rounded-lg p-4 border-l-4 border-blue-400">
    <p className="text-sm leading-relaxed text-slate-700">
      <span className="font-semibold text-slate-900">Why relevant:</span>
      {" "}
      {paper.whyRelevant}
    </p>
  </div>

  {/* Key overlaps - simple list */}
  <div>
    <p className="text-sm font-medium text-slate-700 mb-2">Key overlaps:</p>
    <ul className="space-y-1.5 pl-4 text-sm text-slate-700 list-disc marker:text-slate-400">
      {paper.methodOverlap.map((overlap, i) => (
        <li key={i}>{overlap}</li>
      ))}
    </ul>
  </div>

  {/* Method comparison - inline */}
  <div>
    <p className="text-sm font-medium text-slate-700 mb-2">Method comparison:</p>
    <div className="space-y-2 text-sm text-slate-700">
      <p><span className="font-medium">Sample:</span> {paper.methodComparison.sample}</p>
      <p><span className="font-medium">Materials:</span> {paper.methodComparison.materials}</p>
      <p><span className="font-medium">Procedure:</span> {paper.methodComparison.procedure}</p>
      <p><span className="font-medium">Outcomes:</span> {paper.methodComparison.outcomes}</p>
    </div>
  </div>

  {/* Gaps - amber accent */}
  {paper.gaps && (
    <div className="bg-amber-50/40 rounded-lg p-4 border-l-4 border-amber-400">
      <p className="text-sm font-semibold text-amber-900 mb-1">Gaps:</p>
      <p className="text-sm text-amber-800">{paper.gaps}</p>
    </div>
  )}
</article>
```

### What to Remove:

- ❌ Entire method matrix table (8 rows × N columns)
- ❌ Cross-paper comparison table at top
- ❌ Uppercase tracking labels on every section
- ❌ "PAPER #1", "PAPER #2" labels
- ❌ Excessive borders and shadow-sm everywhere
- ❌ Source paper summary in separate box (move to "At a glance")

### What to Keep:

- ✅ Paper metadata (authors, year, venue)
- ✅ Why relevant
- ✅ Overlap highlights
- ✅ Method comparison (simplified to 4 inline fields)
- ✅ Gaps/uncertainties

### Implementation Steps:

1. **Replace `SimilarPapersStructuredView` function** in `app/page.tsx`
2. **Add gradient "At a glance" section** at top
3. **Create elevated paper cards** with shadow-lg
4. **Add color coding:**
   - Blue tint for "Why relevant"
   - Amber tint for "Gaps"
5. **Simplify method comparison** to 4 inline fields
6. **Remove method matrix table** entirely
7. **Test with mock data** in `lib/mock-similar-papers.ts`

### Testing:

1. View mock paper in browser
2. Navigate to Similar Papers tab
3. Verify visual hierarchy
4. Check card shadows and hover effects
5. Verify color coding works
6. Ensure spacing feels generous

### Checkpoint:
Once the mock template looks beautiful, proceed to Phase 4.

---

## Phase 4: Verify PDF Upload UI (if different)

**Goal:** Ensure PDF upload flow uses the same beautiful UI.

### Verification Steps:

1. Upload a real PDF through the app
2. Wait for Similar Papers generation
3. Verify UI matches mock template
4. Check that simplified schema (4 method fields) displays correctly

### If UI is different:
- Apply same design patterns from Phase 3
- Use elevated cards, color coding, natural reading flow
- Remove any remaining tables or database-like elements

### Final Checks:

- ✅ Mock data displays beautifully
- ✅ PDF upload displays beautifully
- ✅ Prompts produce 3-5 papers max
- ✅ Method comparison is simplified (4 fields)
- ✅ Visual hierarchy is clear
- ✅ No uppercase tracking labels
- ✅ Generous spacing and breathing room
- ✅ Build succeeds with no errors

---

## Key Principles (from Claims Success)

1. **Simple beats complex** — Remove tables, use cards
2. **Color guides the eye** — Blue = relevance/evidence, Amber = gaps
3. **Typography over decoration** — Bold titles, clean labels, no uppercase tracking
4. **Breathing room** — Generous `p-8`, `space-y-6`, `space-y-5`
5. **Human-friendly** — Reads like a research brief, not a database
6. **Low verbosity directive** — Tell the model to be concise
7. **Behavioral constraints** — "High reasoning, low verbosity, stop when done"

---

## Reference: Claims Optimization (What We Learned)

**What worked:**
- Removing word/bullet limits → "low verbosity" directive instead
- Focus on top N items (3 claims, 3-5 papers)
- Streamlined prompts (2 sections: Schema + Validation)
- Elevated white cards with shadows
- Subtle color coding (blue/amber) with left accent borders
- Integrated context (limitations shown with each claim)
- Typography hierarchy (XL bold for main items)

**What didn't work:**
- Prescriptive structure (numbered templates)
- Hard word counts
- Database-like tables
- Uppercase tracking labels everywhere
- Boxes within boxes
- Equal visual weight for all elements

---

## Timeline

**Phase 1:** 30-60 minutes (optimize prompts, test script)
**Phase 2:** 15-30 minutes (apply to API, verify)
**Phase 3:** 45-90 minutes (redesign UI, test mock)
**Phase 4:** 15-30 minutes (verify PDF upload)

**Total:** ~2-3 hours for complete optimization

---

## Success Criteria

- [ ] Script produces 3-5 focused papers
- [ ] Method comparison simplified to 4 fields
- [ ] Prompts use "low verbosity, high reasoning"
- [ ] API generates clean structured output
- [ ] UI uses elevated cards with shadows
- [ ] Color coding (blue/amber) guides the eye
- [ ] No method matrix table
- [ ] Typography creates clear hierarchy
- [ ] Build succeeds with no errors
- [ ] Mock and PDF upload both look beautiful
