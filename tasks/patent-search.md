# Patent Search Script (Mock Data)

## Minimum to Prove It Works (v0.1)
- Create `scripts/generate-patents.js` that reads claims from the mock library and generates patent search prompts
- Build discovery prompt that searches for patents matching the paper's claims
- Copy prompts to clipboard for manual LLM workflow
- Accept cleaned JSON back and save to `mock-similar-papers.ts`
- Update `PatentsPanel` to display mock patent data in a clean UI

## Skip for v0.1
- No API route integration
- No PDF upload pipeline integration
- No automated patent search APIs (Google Patents, USPTO, etc.)
- No patent similarity scoring algorithms

## Definition of Done
- Script generates patent discovery prompt based on claims from mock data
- Cleanup prompt converts LLM notes to structured JSON
- Patent data saved to `MOCK_SIMILAR_PAPERS_LIBRARY.patents`
- UI displays patent cards with number, title, assignee, dates, and claim overlap
- Pattern matches existing scripts (researcher-theses, claims-analysis)

## Input Source
- Uses `claimsAnalysis.structured.claims` from mock-similar-papers.ts
- Each claim (C1, C2, etc.) becomes a patent search query

## Output Structure
```javascript
{
  patents: {
    text: "...", // Formatted plaintext summary
    structured: {
      patents: [
        {
          patentNumber: "US1234567",
          title: "...",
          assignee: "...",
          filingDate: "YYYY-MM-DD",
          grantDate: "YYYY-MM-DD",
          abstract: "...",
          overlapWithPaper: {
            claimIds: ["C1", "C3"],
            summary: "2-3 sentence technical explanation of HOW patent claims map to specific paper methods/techniques"
          },
          url: "https://patents.google.com/patent/..."
        }
      ]
    }
  }
}
```

## Discovery Prompt Features
- Rigorous technical claim mapping
- Extracts specific technical elements (algorithms, compositions, apparatus, applications)
- Maps patent claim language to paper's technical elements
- Explains HOW patent claims cover the paper's methods (specificity required)
- Focuses on substantive technical overlap, not just keyword matches
- Requests 2-3 sentence technical summary for each patent

## UI Requirements
- Display patent cards similar to Similar Papers showcase
- Show patent metadata (number, assignee, dates, abstract)
- Highlight overlap with paper claims in blue box
- Display technical overlap summary (detailed explanation)
- Link to patent documents prominently
- Clean, scannable layout with proper typography
- No individual patent claims listed (simplified)
