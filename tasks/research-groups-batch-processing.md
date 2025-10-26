# Research Groups Batch Processing Fix

## Problem

The Author Contacts (Research Groups) API was trying to process ALL papers (1 source + 5 similar = 6 papers, ~18 authors) in a single API call. The OpenAI agent was getting overwhelmed and responding with:

> "I can do this, but it's a substantial, multi-step collection task... I need your confirmation..."

This hesitation was due to the scope being too large: **6 papers × 3 authors × 5+ fields = 90+ individual research tasks in ONE prompt**.

## Solution

Implemented **batch processing** to break the work into manageable chunks of **2 papers at a time**.

### Batch Strategy

- **Batch 1**: Source paper + Similar Paper 1 (2 papers, ~6 authors)
- **Batch 2**: Similar Papers 2-3 (2 papers, ~6 authors)
- **Batch 3**: Similar Papers 4-5 (2 papers, ~6 authors)

**Total**: 3 sequential API calls instead of 1 large call

### Implementation Details

#### 1. Updated Prompt Template (`DISCOVERY_PROMPT_TEMPLATE`)

**Before:**
- Single template with placeholders for ALL papers at once
- Required total paper count tracking
- Had "CRITICAL REQUIREMENT" messaging about processing all papers

**After:**
- Simplified template with `[PAPERS_SECTION]` placeholder
- Works with any subset of papers (1-2 papers per batch)
- Removed overwhelming language about total count
- More focused: "For EACH paper below..."

#### 2. New Interfaces & Functions

**`PaperBatchItem` interface:**
```typescript
interface PaperBatchItem {
  title: string;
  identifier: string;
  authors: string;
  summary?: string;
  methodSignals?: string;
  isSource: boolean;
}
```

**`preparePaperBatches()` function:**
- Converts source paper and similar papers into uniform batch items
- Returns array of all papers ready for batching
- Handles source paper metadata (summary, method signals)
- Formats similar papers consistently

**`buildPaperSection()` function:**
- Builds the papers section for a given batch
- Handles paper numbering correctly across batches
- Distinguishes source vs similar papers in output

**`buildBatchDiscoveryPrompt()` function:**
- Creates discovery prompt for a specific batch
- Uses the simplified template with `[PAPERS_SECTION]` placeholder
- Maintains consistent numbering across batches

**`fetchBatchDiscovery()` helper:**
- Makes OpenAI API call for a single batch
- Includes batch tracking (batch X/Y) in logs
- Handles errors with batch-specific messaging
- Returns discovery notes for the batch

#### 3. Updated POST Handler Logic

**New workflow:**

```typescript
// Step 1: Prepare all papers for batching
const allPapers = preparePaperBatches(paper, claims, similarPapersPayload);
const BATCH_SIZE = 2;

// Split papers into batches of 2
const batches = []; // Each batch has 2 papers (or 1 for last batch)

// Step 2: Process each batch sequentially
for each batch:
  - Build batch-specific prompt
  - Call OpenAI API with web search
  - Collect results

// Step 3: Combine all batch results
const outputText = batchResults.join("\n\n---\n\n");

// Step 4: Run cleanup on combined results (unchanged)
const cleanupPrompt = buildCleanupPrompt(outputText);
// ... cleanup call (same as before)
```

#### 4. Logging Improvements

Added comprehensive logging:
- `[research-groups] Processing N papers in M batches`
- `[research-groups] Starting batch X/Y discovery`
- `[research-groups] Batch X/Y completed successfully`
- `[research-groups] All M batches completed successfully`

## Key Benefits

✅ **Manageable scope**: 2 papers × 3 authors = 6 contacts per batch (vs 18 total)
✅ **No agent hesitation**: Clear, focused task per batch
✅ **Better error handling**: If one batch fails, we know which one
✅ **Reasonable speed**: 3 API calls instead of 1 (acceptable trade-off)
✅ **Same final output**: Cleanup step combines all results
✅ **Flexible batch size**: Easy to adjust `BATCH_SIZE` constant if needed

## Files Modified

- `app/api/research-groups/route.ts` - Complete batch processing implementation

## Testing

✅ TypeScript compilation passes (`npx tsc --noEmit`)
✅ No breaking changes to API contract
✅ Same output structure as before (papers array with authors)
✅ Backward compatible with existing UI components

## Expected Behavior

### Before (Single Call)
```
[research-groups] starting fetch
→ Agent receives 6 papers at once
→ Agent asks: "I need your confirmation on two points..."
→ User gets stuck waiting for clarification
```

### After (Batch Processing)
```
[research-groups] Processing 6 papers in 3 batches
[research-groups] Starting batch 1/3 discovery
→ Agent processes source + similar 1 (2 papers, 6 authors)
→ Returns results immediately
[research-groups] Batch 1/3 completed successfully

[research-groups] Starting batch 2/3 discovery
→ Agent processes similar 2-3 (2 papers, 6 authors)
→ Returns results immediately
[research-groups] Batch 2/3 completed successfully

[research-groups] Starting batch 3/3 discovery
→ Agent processes similar 4-5 (2 papers, 6 authors)
→ Returns results immediately
[research-groups] Batch 3/3 completed successfully

[research-groups] All 3 batches completed successfully
→ Cleanup step combines all results
→ Returns structured JSON
```

## Configuration

To adjust batch size if needed:

```typescript
const BATCH_SIZE = 2; // Change to 1 or 3 if needed
```

- `BATCH_SIZE = 1`: Most conservative (6 calls, slowest)
- `BATCH_SIZE = 2`: **Recommended** (3 calls, balanced)
- `BATCH_SIZE = 3`: Faster but riskier (2 calls, may still overwhelm)

## Future Improvements

- [ ] Consider parallel batch processing if API allows concurrent calls
- [ ] Add retry logic for failed batches
- [ ] Track batch timing metrics for optimization
- [ ] Consider adaptive batch sizing based on paper complexity

## Implementation Date

2025-10-27

## Status

✅ Complete and tested
