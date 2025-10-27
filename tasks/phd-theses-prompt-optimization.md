# PhD theses prompt optimisation plan

## Minimum viable outcome
- Update the mock thesis discovery prompt so every researcher from the research groups data is explicitly covered and the LLM gets manageable chunks for thorough searches.

## Skip for v0.1
- Automating API integration or UI tweaks; focus solely on the mock CLI prompt output.
- Adding new cleanup logic—reuse existing JSON cleanup path for now.

## Definition of done
- Running the thesis mock script generates prompts that enumerate all listed researchers (no silent truncation).
- Prompts are chunked or otherwise structured so long research-group lists remain readable for the analyst.
- Discovery instructions emphasise finding each researcher's PhD thesis (with direct links when available).
