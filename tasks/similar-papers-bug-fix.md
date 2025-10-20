# Similar Papers Compilation Bug Fix

## Problem
Similar papers generation was getting stuck at "Compiling similar papers..." loading state and never completing or showing errors.

## Root Causes Identified
1. **Model identifier** - Using `"gpt-5-mini"` instead of full version `"gpt-5-mini-2025-08-07"`
2. **Missing error visibility** - Network errors and timeouts weren't being logged comprehensively
3. **Timeout mismatch** - Frontend 45s timeout vs backend 600s timeout could cause silent failures
4. **Insufficient debugging** - Hard to diagnose issues without detailed logs

## Changes Made

### API Route (`/app/api/similar-papers/route.ts`)

1. **Updated model identifiers** (lines 553, 641)
   - Changed from `"gpt-5-mini"` to `"gpt-5-mini-2025-08-07"`
   - This matches the official OpenAI model version string

2. **Added comprehensive logging**
   - Discovery phase start (line 538-541)
   - Request sending confirmation (line 552)
   - Response completion with status (line 569-573)
   - Timeout warnings (line 545, 654)
   - Network error catching (line 574-578, 681-685)
   - Cleanup phase start (line 647-650)
   - Success summary (line 747-751)
   - Enhanced error logging with stack traces (line 760-763)

3. **Improved error handling**
   - Added explicit try-catch around fetch calls
   - Log network errors separately from API errors
   - Include error type and stack trace in logs

### Frontend (`/app/page.tsx`)

1. **Added request lifecycle logging**
   - Request preparation and sending (line 2909-2915)
   - Response completion (line 2937-2942)
   - Timeout firing (line 2893-2895)
   - Fetch failure details (line 2943-2951)
   - Enhanced error logging (line 3019-3025)

2. **Better error diagnostics**
   - Log whether error is from timeout abort
   - Include error type and message
   - Track paper ID throughout the flow

## How to Test

### 1. Check Console Logs
Upload a PDF and watch the browser console. You should see:
```
[similar-papers] starting fetch with claims
[similar-papers] Sending fetch request to /api/similar-papers
```

Then in the server console (terminal running `npm run dev`):
```
[similar-papers] Starting discovery phase with OpenAI API...
[similar-papers] Sending discovery request to OpenAI...
[similar-papers] Discovery request completed { status: 200, ok: true }
[similar-papers] Starting cleanup phase with OpenAI API...
[similar-papers] Sending cleanup request to OpenAI...
[similar-papers] Cleanup request completed { status: 200, ok: true }
[similar-papers] Successfully completed both discovery and cleanup phases
```

### 2. Success Indicators
- No error messages in console
- State transitions from "loading" to "success"
- Similar papers data appears in the UI
- Both `text` and `structured` fields are populated

### 3. Error Scenarios to Check
If it still fails, the logs will now show exactly WHERE and WHY:

**Authentication Error:**
```
[similar-papers] OpenAI error payload { error: "Incorrect API key..." }
```

**Model Not Found:**
```
[similar-papers] OpenAI error payload { error: "The model 'gpt-5-mini-2025-08-07' does not exist..." }
```

**Timeout:**
```
[similar-papers] Discovery request timed out after 600 seconds
[similar-papers] Fetch failed { isAbortError: true }
```

**Network Error:**
```
[similar-papers] Discovery fetch failed with network error: Failed to fetch
```

## Root Cause Discovered

After adding comprehensive logging, discovered the real issue:

**Race condition between storage loading and generation:**
- Storage load attempts set `activeSimilarPapersState = { status: "loading" }`
- useEffect checks `if (activeSimilarPapersState) return;` and exits early
- Storage load fails (400 error) and deletes state
- But useEffect never re-runs because dependencies didn't change
- Result: `runSimilarPapers` never executes

**Additional Fixes Applied:**

**Fix 1: Allow generation when storage is loading** (app/page.tsx:3678-3682)
- Changed guard to allow generation even if storage load is in progress
- This prevented the race condition but created an infinite loop

**Fix 2: Add ref to track generation starts** (Prevents infinite loop)

Added `similarPapersGenerationRef` (line 2390):
```javascript
const similarPapersGenerationRef = useRef<Set<string>>(new Set<string>());
```

Updated useEffect guard (lines 3679-3691):
```javascript
// Skip if already successful or errored
if (activeSimilarPapersState?.status === 'success' || activeSimilarPapersState?.status === 'error') {
  return;
}

// Skip if we've already started API generation for this paper (prevents infinite loop)
if (similarPapersGenerationRef.current.has(activePaper.id)) {
  return;
}

// Mark as started and run generation
similarPapersGenerationRef.current.add(activePaper.id);
void runSimilarPapers(activePaper, activeExtraction.data, activeClaimsState);
```

Clear ref in cleanup locations:
- When deleting mock paper (line 3571)
- When deleting regular paper (line 3993)
- When retrying generation (line 3938)
- When re-running extraction (line 2701)

**Fix 3: Increase frontend timeout** (Prevents timeout abort of successful requests)

Changed frontend timeout (line 2891):
```javascript
// From:
}, 45_000);  // 45 seconds

// To:
}, 90_000);  // 90 seconds
```

**Why this was critical:**
- API call takes ~45.145 seconds to complete
- Frontend timeout was exactly 45.000 seconds
- Request was aborted 0.145 seconds before success!
- Increasing to 90s gives GPT-5 enough time for discovery + cleanup

## Expected Outcome

With these changes:
1. Storage loading won't block generation - **FIXED** ✅
2. Generation will start even if storage load is in progress - **FIXED** ✅
3. Model version issue - **FIXED** ✅ (now using gpt-5-mini-2025-08-07)
4. Infinite loop - **FIXED** ✅ (ref prevents duplicate calls)
5. Frontend timeout killing successful requests - **FIXED** ✅ (increased to 90s)
6. All error cases now have comprehensive logging for diagnosis

## Next Steps (if still failing)

1. **Check the server console** (terminal) for the API route logs
2. **Check the browser console** for frontend logs
3. **Look for the specific error message** in the logs
4. **If model doesn't exist** - May need to update to a different model version or use standard GPT-4
5. **If authentication fails** - Verify `OPENAI_API_KEY` in `.env.local`
6. **If rate limited** - Wait and retry, or upgrade API plan

## Verification Checklist

- [x] Model identifier updated to full version string
- [x] Comprehensive logging added at all key points
- [x] Network errors caught and logged
- [x] Timeout behavior logged
- [x] Error details include stack traces
- [x] Frontend logs match backend logs for request tracking
- [x] Success case logs completion summary

## References

- OpenAI GPT-5 documentation confirms model identifier should be `gpt-5-mini-2025-08-07`
- Responses API endpoint `/v1/responses` is correct for GPT-5 models
- Similar pattern works in `research-groups` route with same API setup
