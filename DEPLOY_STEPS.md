# Deploy Steps

## Netlify Settings

- Publish directory: `public`
- Functions directory: `netlify/functions`
- Build command: leave empty

## Required Environment Variables

Add these in Netlify Site configuration > Environment variables:

```bash
PHYLLO_CLIENT_ID=
PHYLLO_CLIENT_SECRET=
PHYLLO_ENVIRONMENT=staging
PHYLLO_BASE_URL=https://api.staging.getphyllo.com
PHYLLO_INSTAGRAM_WORK_PLATFORM_ID=
PHYLLO_CLIENT_DISPLAY_NAME=熊熊跨麥
```

Use staging for real account testing. Switch to production only after Phyllo approves live Instagram access and provides production credentials.

## Public Flow

1. User fills Instagram account and industry.
2. User clicks `連接 Instagram 數據`.
3. Netlify creates/reuses a Phyllo user and SDK token.
4. Phyllo Connect opens the Instagram authorization flow.
5. After authorization, the app receives the Phyllo account ID.
6. The report API reads that account's Phyllo profile/content data and generates the diagnosis.

The app does not show fake report data when Phyllo is not configured or the user has not authorized Instagram.
