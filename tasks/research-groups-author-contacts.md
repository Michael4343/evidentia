# Author Contacts: Simplified 2-Prompt Workflow

## Overview

Simplified approach for gathering author contact information: instead of finding research groups, we simply get comprehensive contact details for the **first 3 authors** of each paper (source + similar papers).

**Completed:** 2025-10-26

## What Changed

### From Research Groups to Author Contacts

**Before:** Complex 3-prompt chain
1. Find top 2 research groups per paper
2. Gather contacts for all group members
3. Cleanup to JSON

**After:** Simple 2-prompt workflow
1. Find first 3 authors per paper + gather their contacts
2. Cleanup to JSON

### Why This Is Better

✅ **Simpler**: No need to identify research groups - just use the paper's author list
✅ **Faster**: 2 prompts instead of 3
✅ **Direct**: Contact the people who actually wrote the papers
✅ **Predictable**: First 3 authors is a clear, objective selection
✅ **Scalable**: Works with any paper that has authors

## Implementation Details

### 1. Discovery + Contact Gathering (`buildDiscoveryPrompt()` - lines 254-389)

**Purpose:** For each paper, take the first 3 authors and get their complete contact details

**Key features:**
- Lists source paper + all similar papers with full author lists
- For each paper: extract first 3 authors (or all if <3)
- Gather 5 fields per author:
  1. Name
  2. Institutional email
  3. Role/position
  4. ORCID
  5. Academic profiles (Google Scholar, LinkedIn, website)
- All in ONE prompt (no separate contact gathering step)

**Input format:**
```
1. SOURCE PAPER:
   Title: ...
   DOI: ...
   Authors (in order):
     1. First Author
     2. Second Author
     3. Third Author

2. SIMILAR PAPER 1:
   Title: ...
   Authors (in order):
     1. Author A
     2. Author B
```

**Output format:**
```
Paper 1: <Title>

Author 1: <Name>
  Email: <email>
  Role: <role>
  ORCID: <ID>
  Profiles:
    - Google Scholar: <URL>
    - LinkedIn: <URL>

Author 2: ...
Author 3: ...
```

### 2. Cleanup Prompt (`CLEANUP_PROMPT_HEADER` - lines 73-87)

**Updated schema:**
- `papers` array
- Each paper has `authors` array (up to 3 objects)
- Each author: name, email, role, orcid, profiles
- No more `groups` or `researchers` - just `authors`

### 3. Data Structure

**Changed from:**
```js
{
  papers: [{
    title, identifier,
    groups: [{
      name, institution, website, notes,
      researchers: [{ name, email, role, orcid, profiles }]
    }]
  }]
}
```

**To:**
```js
{
  papers: [{
    title, identifier,
    authors: [
      { name, email, role, orcid, profiles }
    ]
  }]
}
```

### 4. Normalization Functions

**Removed:**
- `normaliseGroup()` - no longer needed

**Updated:**
- `normalisePaper()` - now expects `authors` instead of `groups`
- `normaliseResearcher()` - kept as-is (works for authors)

### 5. Workflow Updates

**2-step process:**

```
=== STEP 1: Find First 3 Authors + Gather Contacts ===
→ Copy discovery prompt to clipboard
→ User pastes into research agent
→ Agent finds first 3 authors per paper + gathers contacts
→ Press ENTER when ready

=== STEP 2: Cleanup - Convert to JSON ===
→ Copy cleanup prompt to clipboard
→ User pastes prompt + notes from Step 1
→ Agent returns JSON
→ User pastes JSON back to script
→ Script saves to mock library
```

### 6. Output Storage

**Changed field name in mock library:**
- Before: `researchGroups`
- After: `authorContacts`

## Structure Example

If you have:
- 1 source paper with 3 authors
- 5 similar papers with ~3 authors each

Result: **6 papers × 3 authors = ~18 author contacts** (fewer if some papers have <3 authors)

## Example Output

```json
{
  "papers": [
    {
      "title": "Source Paper Title",
      "identifier": "10.1234/source",
      "authors": [
        {
          "name": "Jane Smith",
          "email": "jsmith@stanford.edu",
          "role": "PI",
          "orcid": "0000-0002-1234-5678",
          "profiles": [
            {"platform": "Google Scholar", "url": "https://..."},
            {"platform": "LinkedIn", "url": "https://..."}
          ]
        },
        {
          "name": "John Doe",
          "email": "jdoe@stanford.edu",
          "role": "PhD Student",
          "orcid": "0000-0003-9876-5432",
          "profiles": [
            {"platform": "Google Scholar", "url": "https://..."}
          ]
        },
        {
          "name": "Alice Johnson",
          "email": null,
          "role": "Postdoc",
          "orcid": "0000-0001-2345-6789",
          "profiles": []
        }
      ]
    }
  ]
}
```

## Files Modified

1. **`scripts/generate-research-groups.js`**:
   - `buildDiscoveryPrompt()` - Simplified to get first 3 authors + contacts
   - Removed `buildContactDetailsPrompt()` - merged into discovery
   - `CLEANUP_PROMPT_HEADER` - Updated schema for authors
   - `normalisePaper()` - Expects authors instead of groups
   - Removed `normaliseGroup()` - no longer needed
   - `formatResearchGroups()` - Formats author table
   - `runResearchGroups()` - 2-step workflow
   - Changed output field: `researchGroups` → `authorContacts`

2. **`scripts/prompts/generate-research-groups-prompts.md`**:
   - Complete rewrite for 2-prompt workflow
   - Documented discovery + contact gathering
   - Documented cleanup prompt
   - Example JSON with authors structure

3. **`tasks/research-groups-author-contacts.md`** (this file):
   - New documentation for simplified approach

## Usage

```bash
node scripts/generate-research-groups.js
```

1. Select a mock entry with existing similar papers
2. Run through 2-prompt workflow with research agent (with web search capability)
3. Paste final JSON back to script
4. Script saves to `lib/mock-library.ts` under `authorContacts` field

## Testing

- ✅ Discovery prompt lists all papers with author lists
- ✅ Discovery prompt requests first 3 authors per paper
- ✅ Discovery prompt gathers comprehensive contact info (5 fields)
- ✅ Cleanup prompt produces valid JSON with authors schema
- ✅ Normalization handles authors correctly
- ✅ Formatting displays author table with Name, Email, Role, ORCID
- ✅ Data saved to `authorContacts` field

## Next Steps

This implementation is for the **mock data generation workflow**. To apply to the production PDF upload pipeline:

1. Create `app/api/author-contacts/route.ts` with new prompts
2. Update UI components to display author contacts
3. Design author cards with:
   - Name
   - Email (mailto link)
   - Role badge
   - ORCID link
   - Profile links (icons for Google Scholar, LinkedIn, etc.)
4. Consider adding "copy all emails" button for outreach

## UI Design Guidance

### Proposed Layout

**Paper Card:**
```
┌─────────────────────────────────────┐
│ Paper Title (clickable if has DOI) │
│ 10.1234/identifier                  │
│                                      │
│ Author 1                             │
│ ┌─────────────────────────────────┐ │
│ │ Jane Smith                      │ │
│ │ 🎓 PI                           │ │
│ │ ✉️ jsmith@stanford.edu          │ │
│ │ 🆔 0000-0002-1234-5678          │ │
│ │ 🔗 Scholar | LinkedIn | Website │ │
│ └─────────────────────────────────┘ │
│                                      │
│ Author 2                             │
│ ┌─────────────────────────────────┐ │
│ │ John Doe                        │ │
│ │ 🎓 PhD Student                  │ │
│ │ ✉️ jdoe@stanford.edu            │ │
│ │ 🆔 0000-0003-9876-5432          │ │
│ │ 🔗 Scholar                      │ │
│ └─────────────────────────────────┘ │
│                                      │
│ Author 3                             │
│ ┌─────────────────────────────────┐ │
│ │ Alice Johnson                   │ │
│ │ 🎓 Postdoc                      │ │
│ │ ✉️ No email                     │ │
│ │ 🆔 0000-0001-2345-6789          │ │
│ │ 🔗 Scholar                      │ │
│ └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

**Visual hierarchy:**
- White paper cards with shadow
- Nested slate author cards
- Blue for clickable links
- Pill badges for roles
- Icons for ORCID and profiles

**Statistics:**
- "X papers"
- "Y total authors"
- "Z with emails"
- "W with ORCID"

See `tasks/research-groups-optimization-prompts.md` Prompt 2 for detailed UI component specs (adapt for authors instead of groups).
