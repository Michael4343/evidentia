# Similar Papers Prompt Prototype

## What's the absolute minimum to prove this works?
- A script that outputs a ready-to-run prompt for the deep research agent given a seed paper title/doi.
- Mock data renderer on the landing page that reads a pasted agent response and shows a shared "Similar Papers" library.

## What can we skip for v0.1?
- No backend wiring or Supabase storage.
- No auth gating; library is static data embedded client-side.
- No automated fetching from the agent; manual paste of results is fine.

## How will we know it's done?
- Running the script prints a clear prompt template using supplied inputs.
- Landing page shows example similar papers list derived from a sample agent response file.
- Stakeholders can tweak the prompt script or the pasted JSON without touching backend code.
