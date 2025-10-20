# Dynamic Similar Papers - Add Structured Output

## Goal
Update the similar-papers API to return structured JSON data in addition to text, matching the pattern used in claims and research-groups routes.

## Problem
The similar-papers route was only returning `{ text: outputText }` without structured data, making it inconsistent with the other pipeline stages.

## Solution
Added a two-step process (discovery + cleanup) to convert discovery notes into structured JSON.

## Implementation

### Changes to `/app/api/similar-papers/route.ts`

**Step 1: Added Cleanup Prompt**
- Defined CLEANUP_PROMPT_HEADER constant (from script)
- Specifies exact JSON schema for similar papers output
- Matches the structure used in mock-similar-papers.ts

**Step 2: Added buildCleanupPrompt Function**
- Simple wrapper that combines cleanup header with discovery notes
- Follows same pattern as research-groups route

**Step 3: Added Second API Call**
- After getting discovery text from Step 1
- Sends discovery notes to cleanup agent
- Parses JSON response
- Falls back to text-only if parsing fails

### Output Structure
```json
{
  "text": "discovery notes text",
  "structured": {
    "sourcePaper": {
      "summary": "...",
      "keyMethodSignals": ["...", "..."],
      "searchQueries": ["...", "..."]
    },
    "similarPapers": [
      {
        "identifier": "...",
        "title": "...",
        "doi": "...",
        "url": "...",
        "authors": ["...", "..."],
        "year": 2021,
        "venue": "...",
        "clusterLabel": "Sample and model",
        "whyRelevant": "...",
        "overlapHighlights": ["...", "...", "..."],
        "methodMatrix": {
          "sampleModel": "...",
          "materialsSetup": "...",
          "equipmentSetup": "...",
          "procedureSteps": "...",
          "controls": "...",
          "outputsMetrics": "...",
          "qualityChecks": "...",
          "outcomeSummary": "..."
        },
        "gapsOrUncertainties": "..."
      }
    ],
    "promptNotes": "..."
  }
}
```

## Key Features
- Two-step process: discovery → cleanup
- Structured output matches script/mock data format
- Graceful fallback to text-only if JSON parsing fails
- Same error handling pattern as other routes
- Cleanup agent runs with gpt-5-mini, low effort

## Pipeline Consistency
Now all three dynamic routes follow the same pattern:

1. **Claims**: text → (discovery + cleanup) → text + structured ✅
2. **Similar Papers**: claims → (discovery + cleanup) → text + structured ✅
3. **Research Groups**: claims + similar papers → (discovery + cleanup) → text + structured ✅

All routes now return consistent `{ text, structured }` format.

## Next Steps (Future)
- Wire up structured data to frontend UI
- Display similar papers in structured table/card format
- Enable deep linking to similar papers
- Show methodMatrix in expandable sections
