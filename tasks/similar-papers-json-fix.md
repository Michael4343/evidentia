# Similar Papers JSON fix

## Minimum viable change
- Add lightweight sanitisation so unescaped double quotes inside string values are escaped before parsing.
- Tighten the cleanup prompt to force the agent to double-check quotes before returning JSON.

## Skip for v0.1
- Broader schema validation or restructuring of the pipeline.
- Automated tests or linting for the script.
- General refactors to other prompts or utilities.

## Definition of done
- Script accepts a payload containing internal double quotes without throwing the JSON parse error.
- Cleanup prompt retains existing guidance while clearly instructing agents to escape embedded quotes.
- Manual spot-check confirms JSON with embedded quotes parses and script proceeds to finish.
