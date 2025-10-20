# Researcher Theses Prompt Fix

## Minimum to Prove It Works (v0.1)
- Adjust the `/api/researcher-theses` discovery instructions so GPT returns at least a structured set of researcher notes instead of the generic "No researcher publications" message.
- Update the model ID while we touch the prompt to match the version already used by similar endpoints.

## Skip for v0.1
- No retries, streaming, or alternate providers.
- No front-end changes beyond what is needed for the new payload format.
- No schema migrations or caching changes.

## Definition of Done
- Running the researcher theses route with existing research group data yields entries per researcher (with "Not found" fallbacks if needed) rather than a blanket failure message.
- Logs show the updated model version and discovery prompt in use with no runtime errors.
