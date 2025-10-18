# Research Group Contacts Plan

## Minimum viable proof
- After the Research Groups deep-search response arrives, automatically request a second model pass that extracts named researchers and email addresses from the generated group descriptions.
- Append a simple table per group (name + email) to the bottom of the existing Research Groups tab so we can inspect the results.

## What we skip for v0.1
- Validating or de-duplicating emails beyond what the model returns.
- Handling pagination or very large contact lists.
- Persisting contact info or linking it to Supabase records.
- Fancy formatting beyond a basic table layout.

## Implementation steps
1. **API layer** – Add `/api/research-group-contacts` that accepts the research group write-up, calls GPT-5-mini with a contact-extraction prompt, and returns structured rows (group label, person name, email).
2. **Client orchestration** – After the research groups call succeeds, trigger the contacts endpoint; manage loading/error state separately so primary results aren’t blocked.
3. **UI rendering** – Render contact tables under each group section, with a fallback message when no contacts/emails are found.

## Definition of done
- Visiting the Research Groups tab populates the main write-up, then (without a manual refresh) adds contact tables under each group.
- Errors in the contact extraction step surface inline but leave the main research results untouched.
