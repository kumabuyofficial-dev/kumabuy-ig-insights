exports.handler = async () => {
  const phylloConfigured = Boolean(process.env.PHYLLO_CLIENT_ID && process.env.PHYLLO_CLIENT_SECRET);
  return json(200, {
    mode: phylloConfigured ? "configured" : "not_configured",
    dataSource: {
      provider: "phyllo",
      configured: phylloConfigured,
      environment: phylloEnvironment(),
      instagramWorkPlatformConfigured: Boolean(process.env.PHYLLO_INSTAGRAM_WORK_PLATFORM_ID)
    },
    privacy: {
      termsUrl: "/terms.html",
      privacyUrl: "/privacy.html",
      deletionUrl: "/api/delete-data"
    }
  });
};

function phylloEnvironment() {
  if (process.env.PHYLLO_ENVIRONMENT === "production") return "production";
  if (process.env.PHYLLO_ENVIRONMENT === "staging") return "staging";
  return "sandbox";
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
