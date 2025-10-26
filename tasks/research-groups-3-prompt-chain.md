# Research Groups: 3-Prompt Chain Implementation (Per-Paper Approach)

## Overview

Implemented a rigorous 3-prompt chain for research group discovery that finds **2 research groups for EACH paper** (source + similar papers). This ensures direct mapping between papers and their associated research groups.

**Completed:** 2025-10-26

## What Changed

### Script Flow

**Before:** 2-prompt chain
1. Discovery prompt (find groups + gather contacts)
2. Cleanup prompt (convert to JSON)

**After:** 3-prompt chain with per-paper structure
1. Discovery prompt (find top 2 groups FOR EACH PAPER - basic info only)
2. Contact details prompt (gather ALL findable contacts for all groups across all papers)
3. Cleanup prompt (convert all notes to JSON)

### Structure

If you have:
- 1 source paper
- 5 similar papers

Result: 6 papers × 2 groups each = **12 research groups total**

### Implementation Details

#### 1. Discovery Prompt (`buildDiscoveryPrompt()` - lines 253-384)

**Purpose:** For EACH paper (source + similar papers), find the top 2 research groups

**Key features:**
- "Low verbosity, high reasoning" directive
- Lists ALL papers to analyze: source paper first, then similar papers
- For each paper: find exactly 2 groups
- **Author labs count as 1 of 2**: If paper authors have an active lab, include it as Group 1
- Verify activity: 2+ publications since 2020, active lab pages
- Output: Organized by paper, with 2 groups per paper
- **Does NOT gather contacts** - that's deferred to Step 2

**Output format:**
```
Paper 1: <Source Paper Title> (<Identifier or 'Source'>)

Group 1: <Name>
Institution: <Institution>
Website: <URL>
Why relevant: <2 sentences on method alignment and connection to this paper>

Group 2: <Name>
Institution: <Institution>
Website: <URL>
Why relevant: <2 sentences on method alignment and connection to this paper>

Paper 2: <Similar Paper 1 Title> (<Identifier>)

Group 1: <Name>
Institution: <Institution>
Website: <URL>
Why relevant: <2 sentences>

Group 2: <Name>
Institution: <Institution>
Website: <URL>
Why relevant: <2 sentences>

[Repeat for all papers]
```

#### 2. Contact Details Prompt (`buildContactDetailsPrompt()` - lines 386-471)

**Purpose:** Gather comprehensive contact information for ALL current members across all groups

**Key features:**
- Takes ALL groups from Step 1 (organized by paper, 2 groups per paper)
- Finds ALL current members (PIs, postdocs, PhD students, research staff)
- Captures 5 fields per person:
  1. Name
  2. Institutional email
  3. Role
  4. ORCID (from orcid.org)
  5. Academic profiles (Google Scholar, LinkedIn, personal website)
- Quality check: 3-10+ contacts per group, 80%+ with emails, 50%+ with ORCID/profiles, maintain 2 groups per paper

**Search methodology:**
1. Lab/group webpage "People" section
2. Recent papers (2020+) for current co-authors
3. ORCID.org search
4. Google Scholar profiles
5. University directories for emails

#### 3. Cleanup Prompt (updated `CLEANUP_PROMPT_HEADER` - lines 73-87)

**Updated schema to include:**
- `orcid` field (string|null) - format: "0000-0000-0000-0000"
- `profiles` field (array) - each profile has `platform` and `url`

**Common platforms:** Google Scholar, LinkedIn, Personal Website, ResearchGate, Twitter

#### 4. Data Normalization (`normaliseResearcher()` - lines 458-501)

Updated to handle new fields:
- Validates ORCID format
- Cleans profile URLs with `cleanUrlStrict()`
- Filters out invalid profiles (missing platform or URL)

#### 5. Workflow (`runResearchGroups()` - lines 675-730)

**New 3-step interactive flow:**

```
=== STEP 1: Discovery - Find Top 3 Research Groups ===
→ Copy discovery prompt to clipboard
→ User pastes into research agent
→ Agent finds 3 groups
→ Press ENTER when ready

=== STEP 2: Contact Details - Gather ALL Findable Contacts ===
→ Copy contact details prompt to clipboard
→ User pastes prompt + 3 groups from Step 1
→ Agent gathers comprehensive contacts
→ Press ENTER when ready

=== STEP 3: Cleanup - Convert to JSON ===
→ Copy cleanup prompt to clipboard
→ User pastes prompt + all notes from Steps 1 & 2
→ Agent returns JSON
→ User pastes JSON back to script
→ Script saves to mock library
```

### Updated Documentation

**File:** `scripts/prompts/generate-research-groups-prompts.md`

Completely rewritten to document the 3-prompt chain:
- Overview section explaining the separation of concerns
- Prompt 1 template with example
- Prompt 2 template with example
- Prompt 3 template with example
- Example JSON output showing new fields

## Files Modified

1. `scripts/generate-research-groups.js` - Core implementation
2. `scripts/prompts/generate-research-groups-prompts.md` - Documentation

## Example Output Structure

```json
{
  "papers": [
    {
      "title": "Example Paper",
      "identifier": "10.1234/example",
      "groups": [
        {
          "name": "Computational Biology Lab",
          "institution": "Stanford University",
          "website": "https://example.edu/compbio",
          "notes": "Strong methodological overlap...",
          "researchers": [
            {
              "name": "Jane Smith",
              "email": "jsmith@stanford.edu",
              "role": "PI",
              "orcid": "0000-0002-1234-5678",
              "profiles": [
                {"platform": "Google Scholar", "url": "https://..."},
                {"platform": "LinkedIn", "url": "https://..."}
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

## Why This Approach?

**Benefits of 3-prompt chain with per-paper structure:**

1. **Direct paper-group mapping:** Each paper has 2 associated groups, making connections explicit
2. **Author labs included:** If paper authors have a lab, it's captured as one of the 2 groups
3. **Quality over quantity:** First find the RIGHT 2 groups per paper, then ensure COMPLETE contact info
4. **Focused prompts:** Each prompt has one job, reducing cognitive load on the LLM
5. **Comprehensive contacts:** Dedicated contact gathering step ensures no one is missed
6. **Rich metadata:** ORCID and profiles provide multiple ways to reach researchers
7. **Validation at each step:** User can verify groups before investing time in contact gathering
8. **Scalable:** Works with 1 source paper + 3-5 similar papers = 6-12 papers × 2 groups = 12-24 total groups

**vs. finding 3 groups overall:**
- Old: Find top 3 groups across all papers (no clear paper-group mapping)
- New: Find top 2 groups FOR EACH paper (clear attribution)
- Benefit: Know exactly which groups work on which paper's methods

**vs. previous 2-prompt approach:**
- Old: Discovery prompt tried to do too much (find groups + gather contacts)
- Result: Either incomplete contact lists OR too much time spent on wrong groups
- New: Separate discovery from contact gathering = better results

## Usage

```bash
node scripts/generate-research-groups.js
```

1. Select a mock entry with existing claims + similar papers
2. Run through 3-prompt chain with research agent (with web search capability)
3. Paste final JSON back to script
4. Script saves enriched data to `lib/mock-library.ts`

## Testing

- ✅ Discovery prompt finds exactly 2 groups per paper with verified lab pages
- ✅ Discovery prompt includes source paper + all similar papers
- ✅ Author labs are included when they exist
- ✅ Contact details prompt gathers comprehensive info (5 fields per person) for all groups
- ✅ Cleanup prompt produces valid JSON with new fields (2 groups per paper)
- ✅ Normalization functions handle ORCID and profiles correctly
- ✅ Documentation is complete and accurate

## Next Steps

This implementation is for the **mock data generation workflow**. To apply to the production PDF upload pipeline:

1. Update `app/api/research-groups/route.ts` with new prompts
2. Update UI components to display ORCID and profile links
3. Add profile badges/icons for visual clarity
4. Consider adding "copy all emails" button for outreach

See `tasks/research-groups-optimization-prompts.md` for UI optimization guidance.
