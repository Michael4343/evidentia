# Dynamic Research Groups API

## Goal
Implement a dynamic research groups generation workflow that follows the same pattern as claims and similar papers routes.

## Context
Previously, research groups were only available via CLI script. Now we have a working dynamic pipeline:
- PDF → Claims (text + structured)
- Claims → Similar Papers (text)
- Claims + Similar Papers → Research Groups (text + structured)

## Implementation

### Input Requirements
- `text`: PDF extracted text (for consistency)
- `claims`: Claims analysis object (text + structured)
- `similarPapers`: Similar papers text output
- `paper`: Paper metadata (title, DOI, authors, abstract)

### Two-Step Process

**Step 1: Discovery**
- Build discovery prompt using:
  - Source paper metadata (title, DOI)
  - Executive summary from claims
  - Method signals from claims
  - Similar papers text output
- Call GPT-5-mini with web_search enabled
- Generate research groups discovery notes

**Step 2: Cleanup**
- Convert discovery notes to structured JSON
- Schema matches the script version:
  ```typescript
  {
    papers: [
      {
        title: string,
        identifier: string | null,
        groups: [
          {
            name: string,
            institution: string | null,
            website: string | null,
            notes: string | null,
            researchers: [
              {
                name: string,
                email: string | null,
                role: string | null
              }
            ]
          }
        ]
      }
    ],
    promptNotes?: string
  }
  ```

### Output Format
```json
{
  "text": "formatted markdown text",
  "structured": {
    "papers": [...],
    "promptNotes": "..."
  }
}
```

## Key Features
- Requires both claims and similar papers (sequential dependency)
- Uses web search for finding active research groups
- Two-step process ensures clean structured output
- Follows same error handling pattern as claims route
- 10-minute timeout for web searches
- Falls back to text-only if JSON parsing fails

## Model Configuration
- Model: gpt-5-mini
- Reasoning effort: low
- Tools: web_search with medium context size
- Max tokens: 8,192 (discovery + cleanup)

## Files Changed
- `/app/api/research-groups/route.ts` - Updated from simple text-based to two-step structured

## Next Steps (Future Enhancements)
- Wire up to frontend UI
- Add loading states
- Display structured research groups data
- Enable direct researcher contact
