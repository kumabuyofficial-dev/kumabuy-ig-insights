# KumaBuy IG Insights

Netlify-ready IG growth diagnostic tool for KumaBuy.

The app uses Phyllo Connect so business owners can authorize their own Instagram account. After authorization, Netlify Functions retrieve the connected account's profile and content performance data from Phyllo and generate the diagnostic report.

## Files

- `public/index.html` - app shell and Phyllo Connect SDK script
- `public/styles.css` - KumaBuy visual styling
- `public/app.js` - frontend validation, Phyllo Connect launch, report rendering
- `netlify/functions/connect-data-source.js` - creates/reuses a Phyllo user and SDK token
- `netlify/functions/instagram-report.js` - reads Phyllo Instagram data and builds the report
- `netlify/functions/config-status.js` - checks whether Phyllo credentials are configured
- `netlify/functions/delete-data.js` - user data deletion endpoint placeholder
- `tests/instagram-report.test.js` - report builder smoke test

## Required Netlify Environment Variables

```bash
PHYLLO_CLIENT_ID=
PHYLLO_CLIENT_SECRET=
PHYLLO_ENVIRONMENT=sandbox
PHYLLO_BASE_URL=https://api.sandbox.getphyllo.com
PHYLLO_INSTAGRAM_WORK_PLATFORM_ID=
PHYLLO_CLIENT_DISPLAY_NAME=熊熊跨麥
```

Use Phyllo sandbox credentials while testing. Switch `PHYLLO_ENVIRONMENT` and `PHYLLO_BASE_URL` to production only after Phyllo approves live access.

## Deploy

1. Push this folder to GitHub or upload the Netlify Drop ZIP.
2. Set Netlify publish directory to `public` when using Git deploy.
3. Set Netlify functions directory to `netlify/functions`.
4. Add the Phyllo environment variables above.

## Data Integrity

The app does not generate fake reports. If Phyllo is not configured or the user has not authorized Instagram, the UI shows a clear disconnected state instead of sample analytics.
