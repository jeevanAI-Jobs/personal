import { getStore } from "@netlify/blobs";
const BASE_URL = "https://jeevanai.co.in";

export async function handler(event, context) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: { "Access-Control-Allow-Origin": "*" }, body: "" };
  let entries = [];
  try {
    const store = getStore({ name: "audit-reports", context });
    entries = await store.get("_report-index", { type: "json" }) || [];
  } catch { entries = []; }
  const urls = entries.map(e => {
    const loc = `${BASE_URL}/report/?brand=${encodeURIComponent(e.slug)}`;
    const lastmod = e.analyzedAt ? e.analyzedAt.slice(0, 10) : new Date().toISOString().slice(0, 10);
    return `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.7</priority>\n  </url>`;
  }).join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;
  return { statusCode: 200, headers: { "Content-Type": "application/xml; charset=utf-8", "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=3600" }, body: xml };
}