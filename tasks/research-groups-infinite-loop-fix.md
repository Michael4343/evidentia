# Research Groups Infinite Loop Fix

## Problem
Research Groups was getting stuck in an infinite loop after Similar Papers completed successfully, repeating the API call multiple times.

## Root Cause
Same 3 bugs as Similar Papers had:

1. **useEffect guard** (line 3783) checked `if (activeResearchGroupState)` instead of checking status
   - Blocked on ANY state including storage loading
   - When state updated from undefined → loading → success, it kept triggering

2. **No ref tracking** to prevent duplicate calls
   - State updates triggered useEffect repeatedly
   - No mechanism to track which papers already started generation

3. **No fetch timeout**
   - Could hang forever if API didn't respond
   - No way to cancel stuck requests

## Fixes Applied

### Fix 1: Add Generation Ref Tracking (line 2392)
```javascript
const researchGroupsGenerationRef = useRef<Set<string>>(new Set<string>());
```

### Fix 2: Update useEffect Guard (lines 3784-3796)
**Before:**
```javascript
if (activeResearchGroupState) {
  return;
}
void runResearchGroups(...);
```

**After:**
```javascript
// Skip if already successful or errored
if (activeResearchGroupState?.status === "success" || activeResearchGroupState?.status === "error") {
  return;
}

// Skip if we've already started API generation for this paper
if (researchGroupsGenerationRef.current.has(activePaper.id)) {
  return;
}

// Mark as started and run generation
researchGroupsGenerationRef.current.add(activePaper.id);
void runResearchGroups(...);
```

### Fix 3: Add Timeout to Fetch (lines 3395-3442)
```javascript
const controller = new AbortController();
const timeoutId = window.setTimeout(() => {
  console.warn("[research-groups] Frontend timeout fired after 120 seconds");
  controller.abort();
}, 120_000); // 120s - research groups uses web search and takes longer

try {
  response = await fetch("/api/research-groups", {
    // ... existing config
    signal: controller.signal
  });
} finally {
  window.clearTimeout(timeoutId);
}
```

**Why 120 seconds?**
- Research groups uses web search which is slower than similar-papers
- Similar-papers takes ~45s, research groups can take 60-90s
- 120s provides comfortable margin

### Fix 4: Clear Ref in Cleanup Locations
Added `researchGroupsGenerationRef.current.delete(paperId)` in:
- Line 2704: When re-extracting (runExtraction)
- Line 3595: When deleting mock paper
- Line 4044: When deleting regular paper
- Line 4009: When retrying (handleRetryResearchGroups)

## Testing
After uploading a PDF:

**Expected behavior:**
- Claims completes
- Similar papers runs once and completes
- Research groups runs **once** and completes
- No infinite loops
- No timeout aborts (unless API actually takes >120s)

**Logs to verify:**
```
[research-groups] starting fetch { paperId: '...' }
POST /api/research-groups 200 in ~60000ms
```

Should see this **exactly once** per paper, not repeated.

## Comparison with Similar Papers Fix
Both endpoints now have identical patterns:
- ✅ Ref-based duplicate prevention
- ✅ Status-based guard checks (success/error)
- ✅ Frontend timeout with abort controller
- ✅ Ref cleanup in all necessary locations
- ✅ Retry handler clears ref before re-running

Similar Papers: 90s timeout (GPT-5 discovery + cleanup)
Research Groups: 120s timeout (GPT-5 + web search)

## Result
Research groups now executes cleanly once per paper with proper error handling and timeout protection.
