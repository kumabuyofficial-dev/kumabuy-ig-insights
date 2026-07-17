exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const accountId = normalizeAccount(params.accountId || "");
  const industry = String(params.industry || "").trim();
  const connectUrl = process.env.WINDSOR_CONNECT_URL || "";

  return json(200, {
    configured: Boolean(connectUrl),
    authorizationUrl: connectUrl ? withContext(connectUrl, { accountId, industry }) : null,
    message: connectUrl
      ? "Opening data connection flow."
      : "資料串接尚未開通，請先在 Netlify 環境變數設定 WINDSOR_CONNECT_URL。"
  });
};

function withContext(rawUrl, context) {
  try {
    const url = new URL(rawUrl);
    if (context.accountId) url.searchParams.set("account", context.accountId);
    if (context.industry) url.searchParams.set("industry", context.industry);
    return url.toString();
  } catch {
    return rawUrl;
  }
}

function normalizeAccount(value) {
  return String(value || "")
    .trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//, "")
    .replace(/^@/, "")
    .replace(/\/.*$/, "")
    .slice(0, 80);
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    },
    body: JSON.stringify(body)
  };
}
