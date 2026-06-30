exports.handler = async (event) => {
  const params = event.queryStringParameters || {};

  if (params.error) {
    return html(400, page("Instagram connection failed", params.error_description || params.error));
  }

  if (!params.code) {
    return html(400, page("Missing authorization code", "Please start the Instagram connection flow again."));
  }

  if (!process.env.META_CLIENT_ID || !process.env.META_CLIENT_SECRET || !process.env.META_REDIRECT_URI) {
    return html(
      200,
      page(
        "Authorization received",
        "The app received an authorization code. Add META_CLIENT_ID, META_CLIENT_SECRET, and META_REDIRECT_URI in Netlify to exchange it for an access token."
      )
    );
  }

  return html(
    501,
    page(
      "Token exchange not enabled yet",
      "The production token exchange should store encrypted tokens in a database before enabling public connected analytics."
    )
  );
};

function page(title, message) {
  return `<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)} | KumaBuy IG Insights</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #eef3ef; color: #18201f; font-family: Arial, "Microsoft JhengHei", sans-serif; }
      main { width: min(640px, calc(100vw - 32px)); padding: 28px; border: 1px solid #d9dfdc; border-radius: 8px; background: #fff; }
      a { color: #0a5d4e; font-weight: 700; }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(message)}</p>
      <p><a href="/">Back to IG Insights</a></p>
    </main>
  </body>
</html>`;
}

function html(statusCode, body) {
  return {
    statusCode,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store"
    },
    body
  };
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
