# Backend OCR configuration

Receipt scans use the local OCR engine unless `GEMINI_API_KEY` is set. With a
key configured, the backend sends a downscaled JPEG to Google's
`gemini-3.5-flash-lite` API and returns extracted item names, quantities, and
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

## Authentication

Email/password registration and login are enabled by default. Google OAuth uses
the backend callback configured in `GOOGLE_OAUTH_REDIRECT_URI`. The allowed
frontend return URLs are configured with `GOOGLE_OAUTH_ALLOWED_REDIRECTS`;
development also allows `http://localhost:8081/` and
`http://127.0.0.1:8081/`.

Password recovery uses a single-use token that expires after 30 minutes. To
send recovery messages, configure:

- `RESEND_API_KEY`
- `EMAIL_FROM` (for example, `Despensa <no-reply@your-domain.com>`)
- `FRONTEND_PUBLIC_URL` (the public frontend URL)

Recovery works for any existing account email (including users that originally
signed in only with Google). After confirming the reset token, the account gets
an email/password credential. Registering with an email that already exists is
rejected, so nobody can attach a password to someone else's account.

Emails are sent through SMTP when `SMTP_HOST` is set (works for any recipient),
otherwise through Resend. SMTP settings: `SMTP_HOST`, `SMTP_PORT` (587 or 465),
`SMTP_USER`, `SMTP_PASSWORD` and optionally `EMAIL_FROM`. For Gmail use
`smtp.gmail.com`, port 587 and an App Password. Resend's `onboarding@resend.dev`
sender only delivers to the Resend account owner; verify a domain to send to
everyone.

Without `RESEND_API_KEY`, the API still returns a generic response but no email
can be delivered.
