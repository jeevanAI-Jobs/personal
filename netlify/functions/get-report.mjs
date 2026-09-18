// Retrieve a saved AI visibility report from Netlify Blobs.
// GET /.netlify/functions/get-report?brand=<slug>

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

  const params = event.queryStringParameters || {};
  const brand = (params.brand || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
  if (!brand) return json(400, { error: "Missing brand parameter." });

  try {
    const store = getStore("audit-reports");
    const report = await store.get(brand, { type: "json" });
    if (!report) return json(404, { error: "Report not found. Run a new analysis to generate one." });
    return json(200, report);
  } catch {
    return json(500, { error: "Could not retrieve report. Please try again." });
  }
}
