# Deploy Steps

## What Codex already prepared

This folder is a complete Netlify-ready project and a local Git repository.

Local folder:

`C:\Users\User\Documents\Codex\2026-06-26\new-chat\outputs\kumabuy-ig-insights`

Netlify site to connect later:

`kumabuy-official-igcheck-v4`

Site ID:

`e80d4d65-2fbb-434d-b2f4-36408b51c121`

## Recommended path

1. Create a new empty GitHub repository.
   - Suggested repo name: `kumabuy-ig-insights`
   - Visibility: private or public, either is fine.
   - Do not add README, `.gitignore`, or license because this project already has files.

2. Send Codex the GitHub repository URL.
   - Example: `https://github.com/YOUR_NAME/kumabuy-ig-insights.git`

3. Codex can then add the remote and push the prepared project.

4. In Netlify, connect `kumabuy-official-igcheck-v4` to that GitHub repo.
   - Publish directory: `public`
   - Functions directory: `netlify/functions`
   - Build command: leave empty for now

5. Add environment variables when real Instagram analytics is ready.
   - `WINDSOR_API_KEY`
   - `WINDSOR_API_URL`
   - `WINDSOR_INSTAGRAM_ACCOUNT_ID`
   - `META_CLIENT_ID`
   - `META_CLIENT_SECRET`
   - `META_REDIRECT_URI`

## Manual push commands

If you want to push it yourself after creating the GitHub repo:

```powershell
cd "C:\Users\User\Documents\Codex\2026-06-26\new-chat\outputs\kumabuy-ig-insights"
git remote add origin https://github.com/YOUR_NAME/kumabuy-ig-insights.git
git branch -M main
git push -u origin main
```

If `git` is not available in your terminal, use GitHub Desktop:

1. File > Add local repository.
2. Choose the `kumabuy-ig-insights` folder.
3. Publish repository.
4. Connect the published repo in Netlify.
