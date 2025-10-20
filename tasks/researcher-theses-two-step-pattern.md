# Researcher Theses Route: Two-Step Pattern Implementation

**Date**: 2025-10-20
**Status**: ✅ Complete

## Objective

Update the `/app/api/researcher-theses/route.ts` to follow the same two-step pattern (discovery + cleanup) used in the similar-papers and research-groups routes.

## Changes Made

### 1. Input Change
**Before**: Accepted raw `contacts` array
**After**: Accepts research groups structured data from `/api/research-groups`

```typescript
// Input structure
{
  researchGroups: {
    structured: {
      papers: [{
        title: string,
        identifier: string,
        groups: [{
          name: string,
          institution: string,
          researchers: [{ name, email, role }]
        }]
      }]
    }
  }
}
```

### 2. Output Change
**Before**: `{ researchers: [...] }` (structured only)
**After**: `{ text: string, structured: { researchers: [...], promptNotes?: string } }`

### 3. Two-Step Process

#### Step 1: Discovery (with web search)
- Model: gpt-5-mini with reasoning effort: low
- Tools: web_search with search_context_size: "medium"
- Timeout: 600s (10 minutes)
- max_output_tokens: 8,192
- Extracts all researchers from research groups
- Returns plain text discovery notes

#### Step 2: Cleanup (JSON conversion)
- Model: gpt-5-mini with reasoning effort: low
- No tools
- Timeout: 600s (10 minutes)
- max_output_tokens: 8,192
- Converts discovery notes to structured JSON
- Uses exact schema from `scripts/generate-researcher-theses.js`

### 4. New Functions

#### buildDiscoveryPrompt()
- Extracts all researchers from nested research groups structure
- Groups by paper and research group for context
- Asks model to find:
  - Most recent publication (2022+)
  - PhD thesis details (title, year, institution, URL)
  - Data availability (yes/no/unknown)
- Returns plain text prompt

#### buildCleanupPrompt()
- Wraps discovery notes with cleanup instructions
- Uses CLEANUP_PROMPT_HEADER from reference script
- Ensures structured JSON output

### 5. Error Handling
- Follows same pattern as research-groups and similar-papers routes
- Handles API failures, timeouts, incomplete responses
- Graceful fallback: returns text-only if JSON parsing fails
- Comprehensive logging with `[researcher-theses]` prefix

## Key Decisions

1. **Process all researchers**: No MAX_RESEARCHERS limit (per user preference)
2. **Exact schema**: Uses script schema with `{ researchers, promptNotes }` structure
3. **Moderate thoroughness**: Verifies thesis existence and finds URLs, but doesn't require PDF deep-dive

## Testing

✅ TypeScript compilation successful
✅ Next.js build completed without errors
✅ Route recognized as dynamic API endpoint

## Usage

This route is part of the research pipeline:

```
Claims → Similar Papers → Research Groups → Researcher Theses
```

**Endpoint**: `POST /api/researcher-theses`

**Example Request**:
```json
{
  "researchGroups": {
    "structured": {
      "papers": [...]
    }
  }
}
```

**Example Response**:
```json
{
  "text": "Researcher: Jane Doe (Soil Lab)\nEmail: jane@edu\n...",
  "structured": {
    "researchers": [{
      "name": "Jane Doe",
      "email": "jane@edu",
      "group": "Soil Lab",
      "latest_publication": {
        "title": "Recent work",
        "year": 2023,
        "venue": "Nature",
        "url": "https://..."
      },
      "phd_thesis": {
        "title": "PhD work",
        "year": 2020,
        "institution": "MIT",
        "url": "https://..."
      },
      "data_publicly_available": "yes"
    }],
    "promptNotes": "Optional notes from model"
  }
}
```

## Files Modified

- `/app/api/researcher-theses/route.ts` - Complete rewrite to two-step pattern

## Reference Files

- `/scripts/generate-researcher-theses.js` - Cleanup prompt schema (lines 21-34)
- `/scripts/researcher-theses-deep-dive.js` - Discovery approach reference
- `/app/api/research-groups/route.ts` - Two-step pattern reference
- `/app/api/similar-papers/route.ts` - Two-step pattern reference

## Next Steps

- Monitor API performance with larger researcher lists
- Consider adding pagination if response times become problematic
- Frontend integration to consume the new `{ text, structured }` format
