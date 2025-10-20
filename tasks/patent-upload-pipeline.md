# Patent Upload Pipeline

## What's the absolute minimum to prove this works?
- Add a backend route that generates patent research notes + structured JSON using the existing claims payload.
- Hook the patent tab into the upload pipeline so it triggers after claims and shows the structured patents list for non-mock uploads.
- Persist the patent output alongside other tab data so refreshes don't lose results.

## What can we skip for v0.1?
- Advanced retry logic or parallelization across multiple patent passes.
- UI polish beyond reusing the existing patent card layout.
- Deep validation of every patent field (assume cleanup agent returns well-formed JSON and surface simple errors only).

## How will we know it's done?
- Uploading a new PDF runs patent discovery automatically once claims are ready and surfaces the returned patents in the tab.
- Patent data is cached (local + Supabase) so revisiting the paper shows the previous results without recomputing.
- A failed patent run displays an actionable error with a retry path.
