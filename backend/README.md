# Backend OCR configuration

Receipt scans use the local OCR engine unless `GEMINI_API_KEY` is set. With a
key configured, the backend sends a downscaled JPEG to Google's
`gemini-2.5-flash-lite` API and returns extracted item names, quantities, and
unit prices.

To enable the faster cloud scan:

1. Create an API key in Google AI Studio using a project on Gemini's free tier.
   Do not attach billing if you want to prevent requests from becoming paid.
2. Add the key as the `GEMINI_API_KEY` secret in the Render backend environment.
   Never add it to the frontend or commit it to the repository.
3. Redeploy the backend after saving the environment variable.

The free tier has per-project request limits. Scans can fail temporarily when
those limits are reached. Google states that content submitted on the free tier
may be used to improve its products; the scanner screen discloses this before
the user takes or selects a receipt image.
