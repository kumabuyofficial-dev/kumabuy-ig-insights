exports.handler = async () => {
  return json(200, {
    configured: Boolean(process.env.WINDSOR_CONNECT_URL),
    authorizationUrl: process.env.WINDSOR_CONNECT_URL || null,
    message: process.env.WINDSOR_CONNECT_URL
      ? "Opening data connection flow."
      : "資料串接尚未開通。請先完成數據連接設定。"
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
