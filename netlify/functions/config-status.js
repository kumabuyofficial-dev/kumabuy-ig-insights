exports.handler = async () => {
  const windsorConfigured = Boolean(process.env.WINDSOR_API_KEY && process.env.WINDSOR_API_URL);
  return json(200, {
    mode: windsorConfigured ? "connected" : "not_connected",
    dataSource: {
      configured: windsorConfigured,
      accountIdConfigured: Boolean(process.env.WINDSOR_INSTAGRAM_ACCOUNT_ID)
    },
    privacy: {
      termsUrl: "/terms.html",
      privacyUrl: "/privacy.html",
      deletionUrl: "/api/delete-data"
    }
  });
};

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
