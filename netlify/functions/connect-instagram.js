exports.handler = async () => {
  const clientId = process.env.META_CLIENT_ID;
  const redirectUri = process.env.META_REDIRECT_URI;
  const scopes = process.env.META_SCOPES || "instagram_basic,instagram_manage_insights,pages_show_list,pages_read_engagement";

  if (!clientId || !redirectUri) {
    return json(200, {
      configured: false,
      message: "Meta OAuth is not configured yet. Add META_CLIENT_ID and META_REDIRECT_URI in Netlify.",
      authorizationUrl: null
    });
  }

  const url = new URL("https://www.facebook.com/v20.0/dialog/oauth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", scopes);
  url.searchParams.set("response_type", "code");

  return json(200, {
    configured: true,
    authorizationUrl: url.toString()
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
