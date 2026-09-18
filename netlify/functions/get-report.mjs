// Retrieve a previously saved AI-readiness report from Netlify Blobs.
// GET /.netlify/functions/get-report?id=<uuid>

import { getStore } from "@netlify/blobs";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };
}

function json(statusCode, body) {
  return { statusCode, headers: corsHeaders(), body: JSON.stringify(body) };
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: corsHeaders(), body: "" };
  if (event.httpMethod !== "GET") return json(405, { error: "Method not allowed" });

  const id = (event.queryStringParameters || {}).id;
  if (!id || !/^[0-9a-f-]{36}$/.test(id)) return json(400, { error: "Invalid report ID." });

  try {
    const store = getStore("audit-reports");
    const report = await store.get(id, { type: "json" });
    if (!report) return json(404, { error: "Report not found or expired." });
    return json(200, report);
  } catch {
    return json(500, { error: "Could not retrieve report. Please try again." });
  }
}
