# Researcher Theses Bugfix Plan

## Minimum To Prove It Works
- Update the researcher theses handling so the upload pipeline reads the API response produced by `/api/researcher-theses`.
- Manually upload a PDF while logged in (or simulate the data path) to confirm the theses tab renders structured researcher entries instead of the "No researcher publications" fallback.

## Skip For v0.1
- Do not add new UI components or redesign the theses tab.
- Skip adding automated tests or additional error states beyond the existing ones.
- Avoid modifying the research group discovery prompts beyond what is required for correct parsing.

## Definition Of Done
- Fetching `/api/researcher-theses` after an upload results in researchers being stored and rendered when the API returns structured data.
- The error message persists only when the API truly returns no researcher records.
- Manual verification shows the theses tab populates with model output for a sample response.
