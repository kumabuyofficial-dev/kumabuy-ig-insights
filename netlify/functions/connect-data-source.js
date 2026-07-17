exports.handler = async (event) => {
  try {
    if (!isPhylloConfigured()) {
      return json(503, {
        error: "PHYLLO_NOT_CONFIGURED",
        message: "Phyllo 尚未設定。請先在 Netlify 設定 PHYLLO_CLIENT_ID 與 PHYLLO_CLIENT_SECRET。"
      });
    }

    const params = event.queryStringParameters || {};
    const account = normalizeAccount(params.account || "");
    const industry = String(params.industry || "").trim();
    const externalId = String(params.externalId || "").trim().slice(0, 120);

    if (!account) {
      return json(400, { error: "ACCOUNT_REQUIRED", message: "請先填寫 Instagram 帳號。" });
    }

    if (!industry) {
      return json(400, { error: "INDUSTRY_REQUIRED", message: "請先選擇行業別 / 服務性質。" });
    }

    if (!externalId) {
      return json(400, { error: "EXTERNAL_ID_REQUIRED", message: "缺少連接識別碼，請重新整理後再試。" });
    }

    const user = await getOrCreateUser({ externalId, account });
    const sdkToken = await createSdkToken(user.id);

    return json(200, {
      provider: "phyllo",
      environment: phylloEnvironment(),
      clientDisplayName: process.env.PHYLLO_CLIENT_DISPLAY_NAME || "熊熊跨麥",
      userId: user.id,
      externalId,
      token: sdkToken.sdk_token || sdkToken.token,
      workPlatformId: process.env.PHYLLO_INSTAGRAM_WORK_PLATFORM_ID || null
    });
  } catch (error) {
    return json(500, {
      error: "PHYLLO_CONNECT_FAILED",
      message: error.message
    });
  }
};

async function getOrCreateUser({ externalId, account }) {
  const existing = await phylloFetch(`/v1/users/external_id/${encodeURIComponent(externalId)}`, {
    allowNotFound: true
  });
  if (existing) return existing;

  return phylloFetch("/v1/users", {
    method: "POST",
    body: {
      name: account,
      external_id: externalId
    }
  });
}

async function createSdkToken(userId) {
  const body = {
    user_id: userId,
    products: ["IDENTITY", "ENGAGEMENT"]
  };
  const workPlatformId = process.env.PHYLLO_INSTAGRAM_WORK_PLATFORM_ID;
  if (workPlatformId) body.work_platform_id = workPlatformId;

  return phylloFetch("/v1/sdk-tokens", {
    method: "POST",
    body
  });
}

async function phylloFetch(path, options = {}) {
  const response = await fetch(`${phylloBaseUrl()}${path}`, {
    method: options.method || "GET",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      authorization: `Basic ${Buffer.from(`${process.env.PHYLLO_CLIENT_ID}:${process.env.PHYLLO_CLIENT_SECRET}`).toString("base64")}`
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  if (response.status === 404 && options.allowNotFound) return null;

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(readablePhylloError(payload, response.status));
  }
  return payload;
}

function phylloBaseUrl() {
  const environment = phylloEnvironment();
  if (process.env.PHYLLO_BASE_URL) return process.env.PHYLLO_BASE_URL;
  if (environment === "production") return "https://api.getphyllo.com";
  if (environment === "staging") return "https://api.staging.getphyllo.com";
  return "https://api.sandbox.getphyllo.com";
}

function phylloEnvironment() {
  if (process.env.PHYLLO_ENVIRONMENT === "production") return "production";
  if (process.env.PHYLLO_ENVIRONMENT === "staging") return "staging";
  return "sandbox";
}

function isPhylloConfigured() {
  return Boolean(process.env.PHYLLO_CLIENT_ID && process.env.PHYLLO_CLIENT_SECRET);
}

function normalizeAccount(value) {
  return String(value || "")
    .trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//, "")
    .replace(/^@/, "")
    .replace(/\/.*$/, "")
    .slice(0, 80);
}

function readablePhylloError(payload, status) {
  const detail = payload.message || payload.error || payload.errors || payload;
  if (typeof detail === "string") return detail;
  return `Phyllo API returned ${status}: ${JSON.stringify(detail)}`;
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
