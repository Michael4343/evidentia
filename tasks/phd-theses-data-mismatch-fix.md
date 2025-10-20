# PhD Theses Data Mismatch Fix

## Problem
The PhD theses workflow was failing with error:
```
Research groups data required. Please wait for research groups to complete first.
```

This occurred even after research groups completed successfully.

## Root Cause

**API Endpoint Expected Data Structure:**
The `/api/researcher-theses` endpoint expected full research groups structured data:
```typescript
{
  researchGroups: {
    structured: {
      papers: [{
        title: string,
        groups: [{
          name: string,
          researchers: [{ name, email, role }]
        }]
      }]
    }
  }
}
```

**But Frontend Was Sending:**
The `runResearcherTheses` function was receiving simplified contacts data:
```typescript
[{
  group: string,
  people: [{ name, email }]
}]
```

**Why This Happened:**
The workflow sequence was:
1. ✅ Research groups generates structured data with full researcher info
2. ✅ Research group contacts simplifies to just contacts for UI display
3. ❌ Researcher theses receives contacts but needs full structured data

The theses API requires the full structured data to extract researchers properly from the nested papers → groups → researchers hierarchy, but we were only passing the flattened contacts array.

## Solution

Pass research groups structured data (not contacts) directly to the researcher theses API.

## Changes Made in `app/page.tsx`

### 1. Updated `runResearcherTheses` Function Signature (~line 3153)
**Before:**
```typescript
const runResearcherTheses = useCallback(
  async (
    paper: UploadedPaper,
    contacts: Array<{ group: string; people: Array<{ name: string | null; email: string | null }> }>
  ) => {
```

**After:**
```typescript
const runResearcherTheses = useCallback(
  async (
    paper: UploadedPaper,
    researchGroupsStructured: ResearchGroupPaperEntry[] | undefined
  ) => {
```

### 2. Updated Validation and API Call (~line 3162-3203)
**Before:**
```typescript
const researchersPayload = contacts.filter((entry) => entry.people.length > 0);

if (researchersPayload.length === 0) {
  // ... set success with empty array
}

// API call with:
body: JSON.stringify({
  contacts: researchersPayload
})
```

**After:**
```typescript
if (!researchGroupsStructured || researchGroupsStructured.length === 0) {
  setResearchThesesStates((prev) => ({
    ...prev,
    [paper.id]: {
      status: "error",
      message: "Research groups data is required for researcher theses lookup."
    }
  }));
  return;
}

// API call with:
body: JSON.stringify({
  researchGroups: {
    structured: {
      papers: researchGroupsStructured
    }
  }
})
```

### 3. Updated `runResearchGroupContacts` Function (~line 3270)
Added research groups structured data as parameter to pass through:

**Before:**
```typescript
const runResearchGroupContacts = useCallback(async (paper: UploadedPaper, researchText: string) => {
  // ...
  if (contacts.length > 0) {
    void runResearcherTheses(paper, contacts);
  }
}, [runResearcherTheses]);
```

**After:**
```typescript
const runResearchGroupContacts = useCallback(
  async (
    paper: UploadedPaper,
    researchText: string,
    researchGroupsStructured: ResearchGroupPaperEntry[] | undefined
  ) => {
    // ...
    if (contacts.length > 0) {
      void runResearcherTheses(paper, researchGroupsStructured);
    }
  },
  [runResearcherTheses]
);
```

### 4. Updated `runResearchGroups` to Pass Structured Data (~line 3507)
**Before:**
```typescript
void runResearchGroupContacts(paper, outputText);
```

**After:**
```typescript
void runResearchGroupContacts(paper, outputText, structuredData);
```

### 5. Updated Theses Tab useEffect (~line 3834-3862)
Changed from watching contacts state to watching research groups state:

**Before:**
```typescript
useEffect(() => {
  if (activeTab !== "theses") return;
  if (!activePaper) return;
  if (activeResearchThesesState) return;
  if (!activeResearchContactsState || activeResearchContactsState.status !== "success") return;
  if (activeResearchContactsState.contacts.length === 0) return;

  void runResearcherTheses(activePaper, activeResearchContactsState.contacts);
}, [
  activeTab,
  activePaper,
  activeResearchContactsState,
  activeResearchThesesState,
  runResearcherTheses
]);
```

**After:**
```typescript
useEffect(() => {
  if (activeTab !== "theses") return;
  if (!activePaper || isMockPaper(activePaper)) return;
  if (activeResearchThesesState) return;
  if (!activeResearchGroupState || activeResearchGroupState.status !== "success") return;
  if (!activeResearchGroupState.structured || activeResearchGroupState.structured.length === 0) return;

  void runResearcherTheses(activePaper, activeResearchGroupState.structured);
}, [
  activeTab,
  activePaper,
  activeResearchGroupState,
  activeResearchThesesState,
  runResearcherTheses
]);
```

## Bonus Fix: TypeScript Error in Similar Papers

Fixed pre-existing TypeScript error at line 157 where `methodMatrix` was missing from the `sourcePaper` type definition:

**Added to `SimilarPapersStructured` interface (~line 373):**
```typescript
interface SimilarPapersStructured {
  sourcePaper?: {
    summary?: string;
    keyMethodSignals?: string[];
    searchQueries?: string[];
    methodMatrix?: Record<string, string>;  // <- ADDED
  };
  // ...
}
```

## Testing

Build completed successfully with exit code 0:
```
✓ Compiled successfully
✓ Linting and checking validity of types
✓ Generating static pages (10/10)
```

### Expected Workflow After Fix:
1. ✅ PDF upload → Extract text
2. ✅ Generate claims
3. ✅ Generate similar papers
4. ✅ Generate research groups (produces structured data with full researcher info)
5. ✅ Generate research group contacts (produces simplified contacts for UI)
6. ✅ Generate researcher theses (receives structured data, extracts researchers properly)

### Manual Testing Steps:
1. Upload a PDF
2. Wait for full pipeline to complete
3. Navigate to "PhD Theses" tab
4. Verify theses data loads without "Research groups data required" error
5. Confirm researcher thesis information displays correctly

## Result

The PhD theses workflow now correctly receives the full research groups structured data it needs to extract researchers and their thesis information. The API endpoint can now process the nested papers → groups → researchers hierarchy as designed.

## Files Modified
- `app/page.tsx` - Updated workflow to pass research groups structured data instead of simplified contacts

## Build Status
✅ Build successful with no TypeScript errors
✅ All 10 static pages generated
✅ Type checking passed
