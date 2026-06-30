# KumaBuy IG Insights

This is a Netlify-ready upgrade prototype for the free IG account checker.

It supports two modes:

- Public demo mode: works without API keys and shows realistic sample insight data.
- Connected data mode: serverless functions can call Windsor.ai or a compatible data API from the backend.

## Files

- `public/index.html` - app shell
- `public/styles.css` - responsive UI
- `public/app.js` - dashboard, report rendering, and API calls
- `netlify/functions/instagram-report.js` - report API with Windsor-compatible adapter and demo fallback
- `netlify/functions/connect-instagram.js` - Meta OAuth URL generator
- `netlify/functions/config-status.js` - checks whether provider environment variables are configured
- `netlify/functions/oauth-callback.js` - placeholder callback for Meta authorization
- `netlify/functions/delete-data.js` - placeholder user data deletion endpoint
- `tests/instagram-report.test.js` - report builder smoke test
- `IMPLEMENTATION_PLAN.md` - production roadmap and data model

## Local preview

If Netlify CLI is available:

```bash
pnpm install
pnpm dev
```

If you only want to inspect the frontend, open `public/index.html` directly. It will use demo data if the API is unavailable.

## Deploy

1. Push this folder to GitHub.
2. Create a Netlify site from the repo.
3. Set build settings:
   - Publish directory: `public`
   - Functions directory: `netlify/functions`
4. Add environment variables from `.env.example`.

## Production Notes

For public use, each user should authorize their own Instagram professional account. Do not expose API keys in the browser. Keep Windsor.ai, Meta, OpenAI, and database tokens in Netlify environment variables only.

The current version is a deployable MVP shell. It is intentionally safe by default: if provider credentials are not configured, it uses demo data and labels the app as demo mode.
