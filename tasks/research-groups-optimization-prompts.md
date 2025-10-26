# Research Groups Optimization Prompt Chain

This document contains 3 independent prompts for optimizing the Research Groups workflow. Each prompt should be executed separately in sequence.

---

## Prompt 1: Optimize Script Prompts for Mock Generation

**Context:** You're optimizing the prompts in `scripts/generate-research-groups.js` to produce focused, high-quality research group discoveries. The script uses a two-prompt pattern (discovery → cleanup) and currently finds 3-5+ groups per paper, but we want to focus on the **top 3 most relevant groups**.

**Files to modify:**
- `scripts/generate-research-groups.js`

**Your task:**

1. **Update the Discovery Prompt** (currently starts around line 250):

Replace the current discovery prompt with this streamlined version:

```javascript
const DISCOVERY_PROMPT = `Objective: Identify the TOP 3 research groups with the strongest methodological alignment to the source paper and similar papers provided.

Context: You have access to a source paper's claims brief and 3-5 similar papers. Your goal is to find active research groups (with 2+ recent publications, active lab pages, and current contact information) that could collaborate on or replicate this research.

Audience: Research analysts building collaboration pipelines.

Inputs:
- Source paper: [TITLE]
- Claims brief: [SUMMARY]
- Similar papers: [TITLES]

Constraints:

Low verbosity, high reasoning; prioritize producing the answer efficiently.

Find exactly 3 groups—rank by methodological alignment and current activity level.

Each group must have:
- Active lab/group webpage (verified)
- 2+ publications since 2020 matching domain keywords
- Current PI listed at institution
- At least 2-3 named contacts with institutional emails

Use web search immediately to:
1. Extract domain keywords from source + similar papers
2. Search Google Scholar: author names + "lab" OR "group" (filter: since 2020, .edu/.ac.*)
3. Verify lab pages are active and current
4. Find current researchers from lab pages + recent author lists
5. Locate institutional emails via university directories

Output Format:

Paper: <Title> (<Identifier>)

Top 3 Groups:

Group 1: <Name>
Institution: <Institution>
Website: <URL>
Why relevant: <2 sentences on method alignment>
Current members:
  - Name | email@institution.edu | Role (PhD student/Postdoc/Research Scientist)
  - Name | email@institution.edu | Role
  - Name | email@institution.edu | Role

Group 2: ...

Group 3: ...

Steps:

1. Extract method signals from claims + similar papers
2. Web search for candidate groups with verified lab pages
3. Rank by publication overlap + method alignment
4. Select TOP 3 groups
5. Find 2-3 current contacts per group with emails
6. QA: all groups have verified websites, current members, institutional emails
7. Stop when validation passes

Important:
- Execute all searches automatically without asking
- Only include groups with verified active lab pages
- Prioritize quality over quantity: 3 complete groups beats 5 incomplete ones
- Use "Not provided" only when genuinely unavailable after thorough search`;
```

2. **Update the Cleanup Prompt** (currently around line 73):

Replace `CLEANUP_PROMPT_HEADER` with this optimized version:

```javascript
const CLEANUP_PROMPT_HEADER = `🚨 CRITICAL: USE ONLY STRAIGHT ASCII QUOTES (") - NEVER SMART QUOTES (" " ' ')

Your output MUST be valid JSON that passes JSON.parse. The #1 cause of failure is smart quotes.

BAD (will fail):  "notes": "Research on "cell sentences" shows promise"
GOOD (will work): "notes": "Research on \\"cell sentences\\" shows promise"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Objective: Convert research group notes into strict, valid JSON (expect exactly 3 groups per paper).

Context: You are receiving notes from a discovery agent that performed web searches and verified 3 research groups. Transform this into clean JSON. This is a deterministic ETL process—preserve content exactly, validate schema, avoid extra keys or prose.

CRITICAL JSON FORMATTING RULES:

1. Use ONLY straight ASCII double quotes (") - NEVER use curly/smart quotes (" " ' ')
2. Escape any internal quotes in strings with backslash: \\"
3. No trailing commas in arrays or objects
4. No single quotes - only double quotes for strings
5. Numbers must be unquoted where applicable
6. No markdown code fences (\`\`\`json) or backticks
7. No comments (// or /* */) anywhere
8. No trailing prose after the JSON closes
9. Escape all internal double quotes inside string values with backslash: \\"

Example of CORRECT quote handling:
"notes": "The lab focuses on \\"single-cell genomics\\" methods"

Example of WRONG (will fail):
"notes": "The lab focuses on "single-cell genomics" methods"

Schema Requirements:

Return a single JSON object with keys: papers (array), promptNotes (optional string).

papers (array): {
  title (string),
  identifier (string|null - DOI or URL),
  groups (array of exactly 3 objects): {
    name (string),
    institution (string|null),
    website (string|null - verified URL),
    notes (string|null - 2 sentences on method alignment),
    researchers (array of 2-3 objects): {
      name (string),
      email (string|null - institutional email),
      role (string|null - PhD student/Postdoc/Research Scientist/etc)
    }
  }
}

Output Requirements:

- Raw JSON only — start with { and end with }
- Must be valid under JSON.parse (strict JSON syntax)
- Use ONLY straight ASCII double quotes (")
- Preserve factual content; use null for missing data (NOT "Not provided")
- Each paper should have exactly 3 groups
- Each group should have 2-3 researchers with emails

Validation Steps:

1. Ingest analyst notes exactly as provided
2. Parse into structured fields (papers, groups, researchers)
3. Ensure exactly 3 groups per paper
4. Populate all required fields; use null for genuinely missing data
5. Validate with JSON.parse; fix and re-validate if invalid
6. Stop when valid`;
```

3. **Update the prompt builder function** (search for `buildDiscoveryPrompt` around line 250):

Make sure it:
- Includes source paper title, summary, and identifier
- Lists similar papers from the mock library
- Uses the new streamlined discovery prompt template
- Focuses on top 3 groups

4. **Test the changes:**
```bash
node scripts/generate-research-groups.js
```

Select a PDF with existing claims + similar papers data, run the discovery prompt through an LLM agent with web search, then use the cleanup prompt to get JSON.

**Success criteria:**
- ✅ Discovery prompt produces exactly 3 groups with complete information
- ✅ "Low verbosity, high reasoning" directive is present
- ✅ Cleanup prompt includes smart quotes warning and validation steps
- ✅ JSON output has exactly 3 groups per paper with 2-3 researchers each
- ✅ All groups have verified websites and institutional emails

---

## Prompt 2: Optimize Mock UI Display

**Context:** The research groups are currently displayed in a functional but basic UI. You'll transform this into a beautiful, scannable interface matching the Similar Papers optimization pattern.

**Files to check for reference:**
- `components/mock-similar-papers-showcase.tsx` (for styling reference)
- Current research groups display in the mock library showcase

**Files you may need to update:**
- Any component that displays mock research groups data
- Look for where `researchGroups?.structured?.papers` is rendered

**Your task:**

Transform the research groups UI to follow this beautiful card-based pattern:

### **Structure:**

```
1. "At a glance" gradient section (if there's summary data)
2. Statistics cards (3 metrics in a row)
3. Paper cards containing group cards
```

### **Design Specifications:**

**1. At a glance section** (if applicable):
```tsx
<section className="bg-gradient-to-r from-blue-50/50 to-slate-50/50 rounded-xl p-6 border border-blue-100/50">
  <p className="text-base leading-relaxed text-slate-700">
    <span className="text-blue-700 font-semibold">At a glance:</span>{" "}
    {summary text here}
  </p>
</section>
```

**2. Statistics cards:**
```tsx
<div className="grid gap-3 sm:grid-cols-3">
  <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Matched papers</p>
    <p className="mt-1 text-2xl font-semibold text-slate-900">{count}</p>
  </div>
  <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Active groups</p>
    <p className="mt-1 text-2xl font-semibold text-slate-900">3</p>
  </div>
  <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Named contacts</p>
    <p className="mt-1 text-2xl font-semibold text-slate-900">{contactCount}</p>
  </div>
</div>
```

**3. Paper cards:**
```tsx
<article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
  <div className="space-y-1">
    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
      Paper 1
    </p>
    {/* Make title clickable if identifier exists */}
    {paperUrl ? (
      <h3 className="text-lg font-semibold">
        <a
          href={paperUrl}
          target="_blank"
          rel="noreferrer"
          className="text-slate-900 hover:text-blue-600 transition"
        >
          {paper.title}
        </a>
      </h3>
    ) : (
      <h3 className="text-lg font-semibold text-slate-900">{paper.title}</h3>
    )}
    <p className="text-xs text-slate-500">{paper.identifier || "No identifier"}</p>
  </div>

  {/* Group cards nested inside */}
  <div className="mt-5 space-y-4">
    {paper.groups.map((group, idx) => (
      <div key={idx} className="rounded-xl border border-slate-200 bg-slate-50/80 p-5 space-y-4">
        {/* Group header with clickable name */}
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            {group.website ? (
              <a
                href={group.website}
                target="_blank"
                rel="noreferrer"
                className="text-base font-semibold text-blue-600 hover:underline transition"
              >
                {group.name}
              </a>
            ) : (
              <p className="text-base font-semibold text-slate-900">{group.name}</p>
            )}
            {group.institution && (
              <p className="text-sm text-slate-600">{group.institution}</p>
            )}
          </div>
          {group.website && (
            <span className="text-xs text-blue-600 font-medium">→ Website</span>
          )}
        </div>

        {/* Why relevant - blue tint */}
        {group.notes && (
          <div className="bg-blue-50/30 rounded-lg p-3 border-l-4 border-blue-400">
            <p className="text-sm leading-relaxed text-slate-700">
              <span className="font-semibold text-slate-900">Why relevant:</span>{" "}
              {group.notes}
            </p>
          </div>
        )}

        {/* Contacts */}
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
            Contacts ({group.researchers?.length || 0})
          </p>
          <div className="space-y-2">
            {group.researchers?.map((person, personIdx) => (
              <div
                key={personIdx}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                <span className="font-semibold text-slate-900">
                  {person.name || "Unnamed"}
                </span>
                {person.role && (
                  <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    {person.role}
                  </span>
                )}
                {person.email ? (
                  <a
                    href={`mailto:${person.email}`}
                    className="text-sm font-medium text-blue-600 hover:underline"
                  >
                    {person.email}
                  </a>
                ) : (
                  <span className="text-xs text-slate-500">No email</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    ))}
  </div>
</article>
```

### **Key UI improvements:**

1. **Clickable links:**
   - Paper titles link to identifier URL (if DOI/URL exists)
   - Group names link to group websites
   - Email addresses are mailto: links
   - Blue color indicates clickability

2. **Visual hierarchy:**
   - Elevated white cards with shadows (`shadow-sm`)
   - Nested groups use slate background (`bg-slate-50/80`)
   - Clear spacing with `space-y-4`, `space-y-5`, `p-6`, etc.

3. **Color coding:**
   - Blue tint for "Why relevant" notes
   - Blue links for clickable items
   - Slate for secondary information

4. **Contact badges:**
   - Role displayed as pill badge
   - Email as clickable link
   - Clean, scannable layout

5. **Consistent styling:**
   - Uppercase tracking labels for metadata
   - Semibold headings
   - Generous padding and spacing

### **Implementation steps:**

1. Locate where mock research groups are displayed
2. Replace the current UI with the new card-based structure
3. Add clickable links for paper titles (if identifier exists)
4. Add clickable links for group names (if website exists)
5. Style contacts with badges and mailto links
6. Add hover states and transitions
7. Test with mock data

**Success criteria:**
- ✅ Beautiful card-based layout with proper hierarchy
- ✅ Paper titles are clickable (if identifier exists)
- ✅ Group names are clickable (if website exists)
- ✅ Contacts display with role badges and email links
- ✅ Statistics cards show metrics cleanly
- ✅ Generous spacing and modern shadows
- ✅ Consistent with Similar Papers UI style

---

## Prompt 3: Implement Optimized Changes in PDF Upload Workflow

**Context:** You've optimized the script prompts (Prompt 1) and the mock UI (Prompt 2). Now you'll apply these changes to the actual PDF upload workflow so real papers get the same beautiful, focused experience.

**Files to modify:**
1. `app/api/research-groups/route.ts` - Update API prompts
2. `app/page.tsx` - Update `ResearchGroupsPanel` component UI

**Your task:**

### **Part A: Update API Route Prompts**

Open `app/api/research-groups/route.ts` and update:

1. **Replace the discovery prompt template** (around line 49, `DISCOVERY_PROMPT_TEMPLATE`):

Use the exact streamlined prompt from Prompt 1, but keep the template variable placeholders:
- `[SOURCE_TITLE]`
- `[SOURCE_SUMMARY]`
- `[SOURCE_DOI]`
- `[METHOD_SIGNALS]`
- `[SIMILAR_PAPERS]`

Key changes:
- Add "Low verbosity, high reasoning" directive
- Focus on **top 3 groups** (not 3-5+)
- Specify 2-3 contacts per group with emails
- Include validation steps

2. **Add/update the cleanup prompt:**

If there's a cleanup prompt constant, replace it with the one from Prompt 1 (with smart quotes warning, JSON validation rules, and schema for exactly 3 groups).

If cleanup is inline, add it as a constant following the pattern from Similar Papers API.

3. **Verify the response handling:**

Ensure the API expects exactly 3 groups per paper in the response parsing logic.

### **Part B: Update ResearchGroupsPanel Component UI**

Open `app/page.tsx` and find the `ResearchGroupsPanel` function (starts around line 2349).

**Current structure** (lines 2571-2643):
- Header with statistics
- Paper cards containing group cards
- Contacts list

**Transform to beautiful UI:**

1. **Keep the statistics cards** (lines 2553-2568) - they're already good!

2. **Update paper cards** to match the mock UI from Prompt 2:

```tsx
{structuredEntries.map((paperEntry, paperIndex) => {
  const paperUrl = paperEntry.identifier ?
    (paperEntry.identifier.startsWith('http') ? paperEntry.identifier : `https://doi.org/${paperEntry.identifier}`)
    : null;

  return (
    <article
      key={`${paperEntry.title}-${paperIndex}`}
      className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
    >
      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
          Paper {paperIndex + 1}
        </p>
        {paperUrl ? (
          <h3 className="text-lg font-semibold">
            <a
              href={paperUrl}
              target="_blank"
              rel="noreferrer"
              className="text-slate-900 hover:text-blue-600 transition"
            >
              {paperEntry.title}
            </a>
          </h3>
        ) : (
          <h3 className="text-lg font-semibold text-slate-900">{paperEntry.title}</h3>
        )}
        <p className="text-xs text-slate-500">
          {paperEntry.identifier || "No identifier"}
        </p>
      </div>

      {/* Groups */}
      {paperEntry.groups.length > 0 ? (
        <div className="mt-5 space-y-4">
          {paperEntry.groups.map((group, groupIndex) => (
            <div
              key={`${paperEntry.title}-${group.name}-${groupIndex}`}
              className="rounded-xl border border-slate-200 bg-slate-50/80 p-5 space-y-4"
            >
              {/* Group header */}
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  {group.website ? (
                    <a
                      href={group.website}
                      target="_blank"
                      rel="noreferrer"
                      className="text-base font-semibold text-blue-600 hover:underline transition"
                    >
                      {group.name}
                    </a>
                  ) : (
                    <p className="text-base font-semibold text-slate-900">{group.name}</p>
                  )}
                  {group.institution && (
                    <p className="text-sm text-slate-600">{group.institution}</p>
                  )}
                </div>
                {group.website && (
                  <span className="text-xs text-blue-600 font-medium">→ Website</span>
                )}
              </div>

              {/* Why relevant - blue tint */}
              {group.notes && (
                <div className="bg-blue-50/30 rounded-lg p-3 border-l-4 border-blue-400">
                  <p className="text-sm leading-relaxed text-slate-700">
                    <span className="font-semibold text-slate-900">Why relevant:</span>{" "}
                    {group.notes}
                  </p>
                </div>
              )}

              {/* Contacts */}
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                  Contacts ({Array.isArray(group.researchers) ? group.researchers.length : 0})
                </p>
                {renderGroupContacts(group)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm text-slate-600">No groups reported for this paper.</p>
      )}
    </article>
  );
})}
```

3. **Update the `renderGroupContacts` function** (starts around line 2477):

Replace with:

```tsx
function renderGroupContacts(group: ResearchGroupEntry) {
  const researchers = Array.isArray(group.researchers) ? group.researchers : [];

  if (researchers.length === 0) {
    return <p className="text-sm text-slate-500">No named contacts listed.</p>;
  }

  return (
    <div className="space-y-2">
      {researchers.map((person, personIndex) => {
        const key = `${group.name}-${person.name ?? person.email ?? personIndex}`;

        return (
          <div
            key={key}
            className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
          >
            <span className="font-semibold text-slate-900">
              {person.name || "Unnamed contact"}
            </span>
            {person.role && (
              <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                {person.role}
              </span>
            )}
            {person.email ? (
              <a
                href={`mailto:${person.email}`}
                className="text-sm font-medium text-blue-600 hover:underline"
              >
                {person.email}
              </a>
            ) : (
              <span className="text-xs text-slate-500">No email</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

### **Implementation checklist:**

**API Route (`app/api/research-groups/route.ts`):**
- [ ] Update discovery prompt to focus on top 3 groups
- [ ] Add "low verbosity, high reasoning" directive
- [ ] Update/add cleanup prompt with JSON validation rules
- [ ] Ensure response parsing expects exactly 3 groups

**UI Component (`app/page.tsx`):**
- [ ] Make paper titles clickable (if identifier exists)
- [ ] Make group names clickable (if website exists)
- [ ] Update group cards with blue tint for notes
- [ ] Update contacts display with badges and links
- [ ] Add hover states for all clickable elements
- [ ] Improve spacing and shadows

**Testing:**
- [ ] Run TypeScript check: `npx tsc --noEmit`
- [ ] Test with a real PDF upload
- [ ] Verify top 3 groups are returned
- [ ] Check all links are clickable
- [ ] Verify hover states work
- [ ] Ensure build succeeds

### **Success criteria:**
- ✅ API produces exactly 3 groups per paper with complete info
- ✅ Discovery prompt includes "low verbosity" directive
- ✅ Cleanup prompt has smart quotes warning
- ✅ Paper titles link to identifiers
- ✅ Group names link to websites
- ✅ Contacts have role badges and email links
- ✅ Blue tint for "Why relevant" sections
- ✅ Consistent with Similar Papers UI styling
- ✅ Build succeeds with no errors
- ✅ UI looks beautiful and is highly scannable

---

## Notes for Execution

**Run these prompts in sequence:**
1. First optimize the script (Prompt 1) and test it manually
2. Then optimize the mock UI (Prompt 2) and verify it visually
3. Finally apply to PDF upload (Prompt 3) and test end-to-end

**Key principles maintained:**
- Focus on **top 3 groups** (quality over quantity)
- "Low verbosity, high reasoning" behavioral directives
- Beautiful card-based UI with clickable links
- Consistent styling with Similar Papers
- Simple, working, maintainable code

**Reference files for patterns:**
- `app/api/similar-papers/route.ts` - API prompt patterns
- `components/mock-similar-papers-showcase.tsx` - UI styling reference
- `app/page.tsx` (SimilarPapersStructuredView) - Card layout patterns
