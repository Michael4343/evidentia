# Research Groups Source Paper Deduplication Fix

## Problem

The **source paper was appearing twice** in the Author Contacts results:

**Example:**
```
Paper 1: Scaling Large Language Models for Next-Generation Single-Cell Analysis
         DOI: 10.1101/2025.04.14.648850
         (Source paper - correct)

Paper 2: SCALING LARGE LANGUAGE MODELS FOR NEXT-GENERATION SINGLE-CELL ANALYSIS
         DOI: 10.1101/2025.04.14.648850
         (Duplicate of source - incorrect!)
```

Both papers had:
- ✅ Same DOI: `10.1101/2025.04.14.648850`
- ✅ Same title (just different capitalization)
- ❌ Duplicate author contacts being fetched

This also caused the source paper to appear duplicated in the Similar Papers section.

## Root Cause

The `preparePaperBatches()` function in `/app/api/research-groups/route.ts` was:

1. **Adding the source paper** to the papers array (correct)
2. **Adding ALL similar papers** from the Similar Papers API without checking for duplicates (incorrect)

The Similar Papers API sometimes returns the source paper as one of the "similar" papers (which makes sense - it's the most similar to itself!). Without deduplication, this caused the source paper to be processed twice.

### Code Flow

**Before fix:**
```typescript
allPapers = [
  sourcePaper,                    // Paper 1
  ...similarPapers                // Includes sourcePaper again as Paper 2!
]
```

**Result:** 6 papers total, but Paper 1 and Paper 2 are the same

## Solution

Added **deduplication logic** to filter out any similar papers that match the source paper before processing.

### Implementation

**File:** `app/api/research-groups/route.ts`

**Changes in `preparePaperBatches()` function (~lines 266-302):**

1. **Extract source identifiers** for comparison:
```typescript
const sourceDoi = paper.doi?.trim().toLowerCase() || null;
const sourceTitle = title.trim().toLowerCase();
```

2. **Filter similar papers** to remove duplicates:
```typescript
const uniqueSimilarPapers = similarPapersArray.filter((similarPaper) => {
  // Check DOI match (if both exist)
  if (sourceDoi && similarPaper.doi) {
    const similarDoi = similarPaper.doi.trim().toLowerCase();
    // Match exact or partial DOIs
    if (sourceDoi === similarDoi ||
        sourceDoi.includes(similarDoi) ||
        similarDoi.includes(sourceDoi)) {
      return false; // Skip - matches source DOI
    }
  }

  // Check title match as fallback
  const similarTitle = (similarPaper.title || "").trim().toLowerCase();
  if (similarTitle && sourceTitle === similarTitle) {
    return false; // Skip - matches source title
  }

  return true; // Keep - doesn't match source
});
```

3. **Use filtered array** instead of original:
```typescript
uniqueSimilarPapers.forEach((similarPaper) => {
  // ... add to allPapers
});
```

### Deduplication Strategy

**Primary: DOI matching**
- Normalizes both DOIs (lowercase, trim)
- Handles different formats:
  - `10.1101/2025.04.14.648850`
  - `https://doi.org/10.1101/2025.04.14.648850`
  - `DOI: 10.1101/2025.04.14.648850`
- Uses partial matching to catch all variants

**Fallback: Title matching**
- Normalizes both titles (lowercase, trim)
- Exact match after normalization
- Catches cases where DOI is missing

### Logging

Added comprehensive logging to track deduplication:

```typescript
[research-groups] Filtered out duplicate source paper by DOI {
  sourceDoi: '10.1101/2025.04.14.648850',
  similarDoi: '10.1101/2025.04.14.648850',
  title: 'SCALING LARGE LANGUAGE MODELS FOR NEXT-GENERATION SINGLE-CELL ANALYSIS'
}

[research-groups] Deduplication complete {
  totalSimilarPapers: 5,
  uniqueSimilarPapers: 4,
  filteredCount: 1
}
```

## Expected Results

### Before Fix

**Author Contacts:**
```
Paper 1: Scaling Large Language Models... (10.1101/2025.04.14.648850)
  - Author 1: Syed Asad Rizvi
  - Author 2: Daniel Levine
  - Author 3: Aakash Patel

Paper 2: SCALING LARGE LANGUAGE MODELS... (10.1101/2025.04.14.648850)  ← DUPLICATE!
  - No contacts found (or same contacts again)

Paper 3: Different Paper 1
Paper 4: Different Paper 2
```

**Similar Papers:**
```
Paper #1: SCALING LARGE LANGUAGE MODELS...  ← Source (duplicate)
Paper #2: SCALING LARGE LANGUAGE MODELS...  ← Source (duplicate)
Paper #3: Different Paper 1
```

### After Fix

**Author Contacts:**
```
Paper 1: Scaling Large Language Models... (10.1101/2025.04.14.648850)
  - Author 1: Syed Asad Rizvi
  - Author 2: Daniel Levine
  - Author 3: Aakash Patel

Paper 2: Different Paper 1  ← Now truly different!
Paper 3: Different Paper 2
Paper 4: Different Paper 3
```

**Similar Papers:**
```
Paper #1: Different Paper 1  ← Only unique papers
Paper #2: Different Paper 2
Paper #3: Different Paper 3
```

## Benefits

✅ **No duplicate papers** - Source paper appears only once
✅ **Accurate author counts** - No duplicate author contact searches
✅ **Better similar papers** - All shown papers are genuinely different
✅ **Faster processing** - Fewer papers to process in batches
✅ **Better UX** - Users see only unique papers

## Edge Cases Handled

1. **Different DOI formats:**
   - Bare DOI: `10.1101/2025.04.14.648850`
   - URL format: `https://doi.org/10.1101/2025.04.14.648850`
   - Prefixed: `DOI: 10.1101/2025.04.14.648850`

2. **Case variations:**
   - "Scaling Large Language Models..."
   - "SCALING LARGE LANGUAGE MODELS..."
   - "scaling large language models..."

3. **Missing DOIs:**
   - Falls back to title matching
   - Normalizes titles before comparison

4. **Partial DOI matches:**
   - Uses substring matching
   - Catches DOI in different positions

## Files Modified

- `app/api/research-groups/route.ts` - Added deduplication in `preparePaperBatches()` function

## Testing

✅ TypeScript compilation passes (`npx tsc --noEmit`)
✅ Deduplication logs show filtered papers
✅ Source paper appears only once in results
✅ Similar papers are all unique
✅ Batch processing still works correctly

## Implementation Date

2025-10-27

## Status

✅ Complete and tested

## Future Improvements

Consider applying similar deduplication in:
- Similar Papers API endpoint (prevent returning source paper)
- Frontend display logic (additional safety layer)
- Other pipelines that consume similar papers data
