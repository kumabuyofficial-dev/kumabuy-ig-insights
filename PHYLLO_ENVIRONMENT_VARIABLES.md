# Phyllo Environment Variables

This project uses Phyllo Connect and Phyllo Social Data API to let Instagram account owners authorize access, then generate the IG growth diagnosis report from authorized account data.

Set these variables in Netlify:

Netlify > Site configuration > Environment variables > Add a variable

## Required Variables

```bash
PHYLLO_CLIENT_ID=
PHYLLO_CLIENT_SECRET=
PHYLLO_ENVIRONMENT=staging
PHYLLO_BASE_URL=https://api.staging.getphyllo.com
PHYLLO_CLIENT_DISPLAY_NAME=熊熊跨麥
```

## Optional Variable

```bash
PHYLLO_INSTAGRAM_WORK_PLATFORM_ID=
```

Use `PHYLLO_INSTAGRAM_WORK_PLATFORM_ID` only if you want Phyllo Connect to open Instagram directly instead of showing the platform selection screen.

## What Each Variable Means

`PHYLLO_CLIENT_ID`
The Client ID from the Phyllo developer dashboard.

`PHYLLO_CLIENT_SECRET`
The Secret from the Phyllo developer dashboard. Mark this as secret in Netlify.

`PHYLLO_ENVIRONMENT`
Use `staging` while testing. Use `production` only after Phyllo approves production access.

`PHYLLO_BASE_URL`
Use `https://api.staging.getphyllo.com` for staging.
Use Phyllo's production API URL only after production access is approved.

`PHYLLO_CLIENT_DISPLAY_NAME`
The brand name displayed in the authorization flow. Recommended value: `熊熊跨麥`.

`PHYLLO_INSTAGRAM_WORK_PLATFORM_ID`
Optional Phyllo Instagram work platform ID. Leave blank if unsure.

## After Updating Variables

After adding or editing environment variables, redeploy the site in Netlify:

Deploys > Trigger deploy > Deploy project

If the old behavior remains, use:

Deploys > Trigger deploy > Deploy project without cache
