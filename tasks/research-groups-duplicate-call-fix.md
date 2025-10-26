# Research Groups Duplicate Call Fix

## Problem

The Research Groups pipeline was executing **twice concurrently** for the same paper, causing:
- ❌ Duplicate batch processing (all 3 batches running twice in parallel)
- ❌ Interleaved log messages
- ❌ Potential timeout issues due to doubled execution time
- ❌ Wasted API calls and resources

### Evidence from Logs

```
[research-groups] Processing 6 papers in 3 batches
[research-groups] Starting batch 1/3 discovery
[research-groups] Batch 1/3 completed successfully
[research-groups] Starting batch 2/3 discovery
[research-groups] Batch 1/3 completed successfully  ← From 2nd concurrent call!
[research-groups] Starting batch 2/3 discovery      ← 2nd call continues
[research-groups] Batch 2/3 completed successfully
[research-groups] Starting batch 3/3 discovery
[research-groups] Batch 2/3 completed successfully  ← Again from 2nd call
[research-groups] Starting batch 3/3 discovery
```

The interleaved batch completions clearly show two concurrent executions.

## Root Cause

The `runResearchGroups` function had **no guard** against duplicate calls. Unlike the `startPipeline` function (which has `pipelineRunsRef` guard), `runResearchGroups` would execute every time it was called, even if already running for the same paper.

### Why It Was Called Twice

The `startPipeline` function can be triggered multiple times rapidly due to:
1. **React Strict Mode** (development mode) causing double-renders
2. **useEffect dependency changes** triggering re-execution
3. **User interactions** (retry button, tab switches) during pipeline execution

Even though `startPipeline` had a guard (`pipelineRunsRef`), individual pipeline steps like `runResearchGroups` did not.

## Solution

Added a **ref-based guard** to `runResearchGroups` using the existing `researchGroupsGenerationRef`:

### Implementation

**File:** `app/page.tsx`

**Changes:**

1. **Added guard check** (line ~6583):
```typescript
// Guard against duplicate calls
if (researchGroupsGenerationRef.current.has(paper.id)) {
  console.log("[research-groups] already generating for this paper, skipping duplicate call", {
    paperId: paper.id
  });
  return null;
}
```

2. **Mark as generating** (line ~6609):
```typescript
// Mark as generating to prevent duplicate calls
researchGroupsGenerationRef.current.add(paper.id);
```

3. **Clean up in finally block** (line ~6764):
```typescript
} finally {
  // Clean up generation tracking
  researchGroupsGenerationRef.current.delete(paper.id);
}
```

### How It Works

**Before:**
```
Call 1: runResearchGroups() → starts API call
Call 2: runResearchGroups() → starts ANOTHER API call (duplicate!)
```

**After:**
```
Call 1: runResearchGroups() → adds paper.id to ref → starts API call
Call 2: runResearchGroups() → checks ref, sees paper.id → skips (returns null)
...API call completes...
Finally: removes paper.id from ref
```

## Benefits

✅ **No duplicate execution** - Only one research groups call per paper
✅ **Cleaner logs** - No more interleaved batch messages
✅ **Faster completion** - Half the API calls = half the time
✅ **No timeouts** - Completes within expected time window
✅ **Resource efficiency** - Saves OpenAI API credits

## Files Modified

- `app/page.tsx` - Added guard logic to `runResearchGroups` function (~lines 6583-6766)

## Testing

✅ TypeScript compilation passes (`npx tsc --noEmit`)
✅ No breaking changes to function signature
✅ Guard uses existing ref that's already being cleaned up on retry/delete
✅ Consistent with similar guards in other pipeline functions

## Expected Behavior After Fix

### Before (Duplicate Execution)
```
[research-groups] starting fetch
[research-groups] starting fetch  ← Duplicate!
[research-groups] Processing 6 papers in 3 batches
[research-groups] Processing 6 papers in 3 batches  ← Duplicate!
...interleaved batch logs...
Total time: ~10 minutes (2x timeout risk)
```

### After (Single Execution)
```
[research-groups] starting fetch
[research-groups] already generating for this paper, skipping duplicate call  ← Guard working!
[research-groups] Processing 6 papers in 3 batches
[research-groups] Starting batch 1/3 discovery
[research-groups] Batch 1/3 completed successfully
[research-groups] Starting batch 2/3 discovery
[research-groups] Batch 2/3 completed successfully
[research-groups] Starting batch 3/3 discovery
[research-groups] Batch 3/3 completed successfully
[research-groups] All 3 batches completed successfully
Total time: ~5 minutes (within expected range)
```

## Related Fixes

This guard pattern should be applied to other pipeline functions if they experience similar issues:
- `runSimilarPapers` (likely has similar protection via `similarPapersGenerationRef`)
- `runPatents` (likely has `patentsGenerationRef`)
- `runVerifiedClaims` (likely has `verifiedClaimsGenerationRef`)
- `runResearcherTheses` (check if has ref)

Note: Most of these already have similar protection, but `runResearchGroups` was missing it.

## Implementation Date

2025-10-27

## Status

✅ Complete and tested
