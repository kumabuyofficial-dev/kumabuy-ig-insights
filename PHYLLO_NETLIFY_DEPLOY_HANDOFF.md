# Phyllo + Netlify Deployment Handoff

This document is for the person taking over deployment.

The site can be deployed to Netlify, but Phyllo will only work after the required environment variables are added to the Netlify project.

## What This Project Does

This project lets Instagram account owners authorize their own Instagram data through Phyllo Connect.

After authorization, the Netlify Functions call Phyllo Social Data API and generate the IG growth diagnosis report from the authorized account data.

## Files That Must Be Deployed

Deploy the whole project folder, not only the `public` folder.

Required folders and files:

```text
public/
netlify/functions/
netlify.toml
package.json
```

The `public` folder contains the website.
The `netlify/functions` folder contains the API endpoints needed for Phyllo and report generation.

## Netlify Deploy Settings

If deploying from GitHub, use these settings:

```text
Build command: leave empty
Publish directory: public
Functions directory: netlify/functions
```

If using Netlify Drop, unzip the ZIP file and drag the whole unzipped project folder into Netlify Drop.

Do not drag only the `public` folder, because the Phyllo API functions will not be deployed.

## Required Netlify Environment Variables

Go to:

```text
Netlify > Site configuration > Environment variables > Add a variable
```

Add these variables:

```bash
PHYLLO_CLIENT_ID=
PHYLLO_CLIENT_SECRET=
PHYLLO_ENVIRONMENT=staging
PHYLLO_BASE_URL=https://api.staging.getphyllo.com
PHYLLO_CLIENT_DISPLAY_NAME=熊熊跨麥
```

`PHYLLO_CLIENT_SECRET` must be marked as secret in Netlify.

## Optional Netlify Environment Variable

```bash
PHYLLO_INSTAGRAM_WORK_PLATFORM_ID=
```

This is optional. Leave it blank if unsure.

Use it only when you want Phyllo Connect to open Instagram directly instead of showing the platform selection screen.

## Where To Find Phyllo Credentials

In the Phyllo developer dashboard:

```text
For developers > API credentials
```

Use:

```text
Client ID -> PHYLLO_CLIENT_ID
Secret -> PHYLLO_CLIENT_SECRET
```

For staging:

```bash
PHYLLO_ENVIRONMENT=staging
PHYLLO_BASE_URL=https://api.staging.getphyllo.com
```

For production, switch only after Phyllo approves production Instagram access and provides production credentials.

## Required Redeploy After Variables

After adding or editing any environment variable, redeploy the site:

```text
Netlify > Deploys > Trigger deploy > Deploy project
```

If the site still behaves like the old version:

```text
Netlify > Deploys > Trigger deploy > Deploy project without cache
```

## How To Verify Phyllo Is Working

Open the deployed website and test this flow:

1. Enter an Instagram account.
2. Select an industry / service type.
3. Check the consent checkbox.
4. Click `連接 Instagram 數據`.
5. Phyllo Connect should open.
6. Select Instagram and complete authorization.
7. Return to the website.
8. The site should show `資料狀態：已連接數據`.
9. Click `產生診斷`.

If the report still shows no usable data, check whether the connected Instagram account has data available in Phyllo staging.

## Common Problems

### Phyllo Connect Does Not Open

Check that these variables exist in Netlify:

```bash
PHYLLO_CLIENT_ID
PHYLLO_CLIENT_SECRET
PHYLLO_ENVIRONMENT
PHYLLO_BASE_URL
```

Then redeploy.

### The Website Shows Phyllo Is Not Configured

The Netlify Functions cannot read the required environment variables.

Check the variable names exactly. They must match uppercase spelling.

### The Website Connects But Report Data Is Empty

Possible causes:

- The Instagram account has limited data available in Phyllo staging.
- The authorization did not include enough data access.
- Phyllo is still processing the account data.
- The connected platform/account is not the expected Instagram account.

### Netlify Drop Deployed The Page But API Returns 404

This usually means only `public` was deployed.

Deploy the whole unzipped project folder so `netlify/functions` is included.

## Privacy / Data Deletion

The project includes:

```text
netlify/functions/delete-data.js
public/privacy.html
public/terms.html
```

If a production privacy policy needs a formal company contact, update `public/privacy.html` before launch.

## Important Notes

Do not put Phyllo secrets inside frontend files such as:

```text
public/app.js
public/index.html
```

Phyllo secrets must only be stored in Netlify environment variables.

Do not share the `PHYLLO_CLIENT_SECRET` publicly.
