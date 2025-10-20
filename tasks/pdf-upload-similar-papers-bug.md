# Fix similar-papers LLM fallback prompt

## Minimum proof of success
- Locate the prompt/agent wiring that yields the clarifying question.
- Adjust the request flow so the LLM returns structured similar-paper data for the sample upload.

## Skip for v0.1
- Do not add retries, caching, or UI polish beyond confirming structured data arrives.
- Ignore unrelated research groups or patents endpoints unless the fix touches them directly.

## Definition of done
- Manual run of the upload/processing pipeline produces the expected similar-papers payload without the clarifying question.
- Add a short note or inline comment capturing why the guard/fix exists so future updates keep the constraint.
