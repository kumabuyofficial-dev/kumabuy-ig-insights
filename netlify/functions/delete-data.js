exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return json(200, {
      status: "manual_request_required",
      message: "To request deletion, send a POST request with your Instagram username or contact KumaBuy support.",
      requiredFields: ["instagramUsername", "email"]
    });
  }

  let payload = {};
  try {
    payload = event.body ? JSON.parse(event.body) : {};
  } catch {
    return json(400, {
      status: "invalid_json",
      message: "Request body must be valid JSON."
    });
  }

  return json(202, {
    status: "accepted",
    message: "Deletion request received. In production this endpoint should delete database records and revoke provider tokens.",
    instagramUsername: payload.instagramUsername || null,
    email: payload.email || null
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
