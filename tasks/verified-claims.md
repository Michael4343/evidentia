# Verified Claims - Evidence Synthesis & Validation

## Minimum to Prove It Works (v0.1)
- Create `scripts/generate-verified-claims.js` that synthesizes ALL mock data
- Build discovery prompt combining claims, similar papers, research groups, theses, and patents
- LLM verifies each claim against comprehensive evidence
- Cleanup prompt converts to structured JSON
- UI displays verification results with color-coded status badges

## Skip for v0.1
- No API route integration
- No PDF upload pipeline integration
- No automated verification algorithms
- No real-time evidence gathering

## Definition of Done
- Script reads all relevant data from mock-similar-papers.ts
- Discovery prompt includes comprehensive context from all tabs
- Cleanup prompt produces valid verification JSON
- UI displays claim cards with verification status badges
- Supporting and contradicting evidence clearly listed
- Verification summary explains reasoning
- Pattern matches existing scripts

## Input Sources
All data from `lib/mock-similar-papers.ts`:
- `claimsAnalysis.structured.claims` - Claims to verify
- `similarPapers` - Supporting/contradicting research
- `researchGroups.structured.papers` - Active researchers
- `researcherTheses.structured.researchers` - Academic validation
- `patents.structured.patents` - Prior art and overlaps

## Output Structure
```javascript
{
  verifiedClaims: {
    text: "Formatted plaintext summary",
    structured: {
      claims: [
        {
          claimId: "C1",
          originalClaim: "Full claim text",
          verificationStatus: "Verified" | "Partially Verified" | "Contradicted" | "Insufficient Evidence",
          supportingEvidence: [
            {
              source: "Similar Paper" | "Patent" | "Research Group" | "Thesis",
              title: "Title or identifier",
              relevance: "Brief explanation of how it supports"
            }
          ],
          contradictingEvidence: [
            {
              source: "Similar Paper" | "Patent" | "Research Group" | "Thesis",
              title: "Title or identifier",
              relevance: "Brief explanation of contradiction"
            }
          ],
          verificationSummary: "2-3 sentence explanation of verification status and reasoning",
          confidenceLevel: "High" | "Moderate" | "Low"
        }
      ],
      overallAssessment: "Brief paragraph on paper's overall claim validity"
    }
  }
}
```

## Discovery Prompt Strategy
- Present all claims upfront
- Provide comprehensive evidence context:
  - Similar papers with key findings
  - Research groups with expertise areas
  - PhD theses with data availability
  - Patents with technical overlaps
- Ask LLM to cross-reference each claim against ALL evidence
- Request supporting AND contradicting evidence identification
- Request verification status assignment with reasoning

## UI Requirements
- Full width layout like patents
- One card per verified claim
- Color-coded verification status badges:
  - Green: Verified
  - Yellow: Partially Verified
  - Red: Contradicted
  - Gray: Insufficient Evidence
- Supporting evidence list with source tags
- Contradicting evidence list (if any)
- Verification summary in highlighted box
- Confidence level indicator
- Clean, scannable typography
- Overall assessment card at top

## Verification Status Criteria (STRICT)

### ✅ Verified (RARE - only if ALL criteria met)
- 3+ **independent** sources confirm (different groups/institutions)
- NO contradicting evidence
- Data AND code publicly available
- Methods replicated by other groups
- Statistical rigor confirmed (adequate N, controls, p-values)
- No significant methodological limitations

### ⚠️ Partially Verified (MOST COMMON - default)
- 1-2 supporting sources (may include same group)
- Minor contradictions, gaps, or limitations present
- Limited or no data availability
- Not independently replicated yet
- Some methodological concerns
- Evidence suggests claim is directionally correct but needs more validation

### ❌ Contradicted
- Evidence actively refutes the claim
- Replication attempts failed
- Statistical or methodological flaws identified
- Contradicting papers outnumber supporting ones

### ❓ Insufficient Evidence
- Less than 1 supporting source
- No independent validation available
- Missing key information needed to verify
- Claim too vague to verify

## Critical Verification Checks

1. **Independence**: Same research group ≠ independent validation
2. **Data Availability**: No public data/code = automatic downgrade from Verified
3. **Statistical Rigor**: Check N, controls, p-values, effect sizes
4. **Replication**: Has another group confirmed findings?
5. **Methodological Soundness**: Appropriate design, confounders addressed?
6. **Contradiction Search**: Actively look for contradicting evidence

## Why This Works
- **Rigorous & skeptical**: Assumes claims unverified until proven otherwise
- **High bar for verification**: Requires independent validation, public data, replication
- **Synthesizes ALL evidence**: Combines similar papers, research groups, theses, patents
- **Identifies weaknesses**: Actively searches for contradictions and gaps
- **Highlights limitations**: Most claims should be "Partially Verified" with noted caveats
- **Quality gate**: Final validation before accepting paper claims
- **Prevents false confidence**: "Verified" status is rare and meaningful
