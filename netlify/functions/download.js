export async function handler(event) {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors, body: "" };
  }

  const url = event.queryStringParameters?.url;
  if (!url || !/^https?:\/\//i.test(url)) {
    return { statusCode: 400, headers: cors, body: "Missing or invalid url" };
  }

  const headers = {};
  const auth = event.headers.authorization || event.headers.Authorization;
  if (auth) {
    headers.Authorization = auth;
  }

  try {
    const upstream = await fetch(url, { headers });
    const buffer = Buffer.from(await upstream.arrayBuffer());
    const contentType = upstream.headers.get("content-type") || "application/octet-stream";
    return {
      statusCode: upstream.status,
      headers: { ...cors, "Content-Type": contentType },
      body: buffer.toString("base64"),
      isBase64Encoded: true,
    };
  } catch (error) {
    return {
      statusCode: 502,
      headers: cors,
      body: error instanceof Error ? error.message : "Proxy failed",
    };
  }
}
