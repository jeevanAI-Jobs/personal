// AI-Readiness Page Analyzer — Netlify serverless function.
// Checks Netlify Blobs cache by domain before calling Claude.
// Same domain = return saved report (no API cost). Pass force:true to re-analyze.

import { getStore } from "@netlify/blobs";

const MODEL = "claude-opus-4-8";
const MAX_HTML_CHARS = 10000;

const SYSTEM_PROMPT = `You are an AI search visibility analyst writing a client-facing diagnostic report. Your job is to tell a brand exactly how AI engines see them RIGHT NOW, what is costing them citations, and why Jeevan AI would help.

Rules:
- Reference actual content from the page. No generic observations.
- Name the brand in every key field.
- Frame everything from the buyer's perspective: "when someone asks ChatGPT or Perplexity about [category], here is what happens."
- If additional pages are provided, identify specific content gaps — topics or questions those pages answer that the primary page does not.

Score the PRIMARY page on these six factors (0-100 each):
1. Entity Clarity — does the page state in the first 200 words what this brand is, who it serves, and what makes it different?
2. Extractable Structure — are sections self-contained 60-150 word chunks an AI can quote verbatim, or is it wall-to-wall marketing copy?
3. Schema Markup — is JSON-LD structured data present and accurate?
4. FAQ Coverage — does the page directly answer the questions a buyer would ask an AI before choosing this brand?
5. Answer-Led Content — does the page lead with direct, quotable answers and specific claims, or vague slogans?
6. Specificity & Evidence — concrete numbers, named results, certifications, and credibility signals an AI can quote.

Return ONLY valid JSON, no markdown:
{
  "brand": "<actual brand name from the page>",
  "domain": "<root domain without www, e.g. hubspot.com>",
  "category": "<what this brand does in 5-8 words>",
  "score": <int 0-100 overall>,
  "verdict": "<1 sentence naming the brand and its specific AI visibility situation>",
  "ai_summary": "<2 sentences: what happens when a buyer asks ChatGPT or Perplexity about this brand's category. Reference a specific gap or strength from the page.>",
  "categories": [
    {"name":"<factor>","score":<int 0-100>,"finding":"<1-2 sentences, specific to this page content>","fix":"<1 concrete action for this specific page>"}
  ],
  "top_fixes": ["<fix 1, specific and actionable>","<fix 2>","<fix 3>"],
  "gaps": [
    {"topic":"<topic or question missing from primary page>","why":"<why AI engines need this to recommend this brand>","fix":"<specific section or content to add>"}
  ],
  "jeevanai_value": "<2 sentences: what Jeevan AI would specifically track and surface for this brand. Name the brand, the category, and 1-2 specific Jeevan AI features.>"
}
The categories array must contain all six factors in order. The gaps array should have 3-5 items; if no extra pages were provided, generate gaps based on what competitor pages in this category typically cover.`;

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };
}

function json(statusCode, body) {
  return { statusCode, headers: corsHeaders(), body: JSON.stringify(body) };
}

function normalizeUrl(raw) {
  let u = (raw || "").trim();
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  try {
    const parsed = new URL(u);
    if (!/^https?:$/.test(parsed.protocol)) return null;
    return parsed.toString();
  } catch { return null; }
}

// Cache key from domain — same brand, same cache regardless of which page they analyzed.
function domainCacheKey(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").replace(/\./g, "-").toLowerCase();
  } catch { return null; }
}

function brandToSlug(brand) {
  return brand
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    + "-ai-search-visibility";
}

function detectSchemaTypes(html) {
  const types = new Set();
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    (m[1].match(/"@type"\s*:\s*"([^"]+)"/g) || []).forEach((t) => {
      const v = t.match(/"@type"\s*:\s*"([^"]+)"/);
      if (v) types.add(v[1]);
    });
  }
  return [...types];
}

function cleanHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_HTML_CHARS);
}

async function scrapePage(url) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; JeevanAI-Analyzer/1.0; +https://jeevanai.co.in)" },
    });
    clearTimeout(t);
    if (!res.ok) return { url, error: `HTTP ${res.status}` };
    const html = await res.text();
    return { url, schemaTypes: detectSchemaTypes(html), content: cleanHtml(html) };
  } catch {
    return { url, error: "Could not reach URL" };
  }
}

function parseClaudeJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON in response");
  return JSON.parse(text.slice(start, end + 1));
}

async function callClaude(userContent, apiKey) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 3500,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
    }),
  });
  const payload = await res.json();
  if (!res.ok) throw new Error(`Claude API ${res.status}`);
  const textBlock = (payload.content || []).find((b) => b.type === "text");
  if (!textBlock) throw new Error("Empty Claude response");
  return parseClaudeJson(textBlock.text);
}

function buildPrimaryPrompt(primary, extras) {
  let userContent =
    `Write a brand-specific AI visibility report for the PRIMARY page below.\n` +
    `PRIMARY URL: ${primary.url}\n` +
    `Schema types detected: ${primary.schemaTypes.length ? primary.schemaTypes.join(", ") : "none"}\n\n` +
    `PRIMARY PAGE CONTENT:\n${primary.content}`;

  if (extras.length > 0) {
    userContent += `\n\n--- ADDITIONAL PAGES FOR GAP ANALYSIS ---`;
    extras.forEach((e, i) => {
      if (e.error) {
        userContent += `\n\nADDITIONAL PAGE ${i + 1}: ${e.url} — could not be fetched, skip it.`;
      } else {
        userContent +=
          `\n\nADDITIONAL PAGE ${i + 1}: ${e.url}\n` +
          `Schema: ${e.schemaTypes.length ? e.schemaTypes.join(", ") : "none"}\n` +
          `CONTENT:\n${e.content}`;
      }
    });
    userContent += `\n\nIdentify topics, questions, and evidence in the ADDITIONAL PAGES that the PRIMARY page is missing. These become the gaps array.`;
  }
  return userContent;
}

function buildCompetitorPrompt(page) {
  return (
    `Write a brand-specific AI visibility report for this page.\n` +
    `URL: ${page.url}\n` +
    `Schema types detected: ${page.schemaTypes.length ? page.schemaTypes.join(", ") : "none"}\n\n` +
    `PAGE CONTENT:\n${page.content}`
  );
}

async function saveReport(store, payload, TTL) {
  const saves = [store.setJSON(payload.slug, payload, { ttl: TTL })];
  const ck = payload.cacheKey;
  if (ck && ck !== payload.slug) saves.push(store.setJSON(ck, payload, { ttl: TTL }));
  // Also save under domain-based slug (e.g. "atoddlerthing-com-ai-search-visibility")
  // so client-side pre-computed slug always resolves.
  const ckSlug = ck ? ck + "-ai-search-visibility" : null;
  if (ckSlug && ckSlug !== payload.slug) saves.push(store.setJSON(ckSlug, payload, { ttl: TTL }));
  await Promise.all(saves);
}

async function pushSitemapToGithub(entries) {
  const pat = process.env.GITHUB_PAT;
  if (!pat) return;

  const BASE = "https://jeevanai.co.in";
  const urls = entries.map(e => {
    const loc = `${BASE}/report/?brand=${encodeURIComponent(e.slug)}`;
    const lastmod = (e.analyzedAt || new Date().toISOString()).slice(0, 10);
    return `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.7</priority>\n  </url>`;
  }).join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;

  const apiBase = "https://api.github.com/repos/jeevanAI-Jobs/personal/contents/website/sitemap-reports.xml";
  const headers = {
    "Authorization": `Bearer ${pat}`,
    "Accept": "application/vnd.github+json",
    "Content-Type": "application/json",
  };

  // Get current file SHA (needed for update).
  let sha;
  try {
    const r = await fetch(apiBase, { headers });
    if (r.ok) { const d = await r.json(); sha = d.sha; }
  } catch { /* new file */ }

  const body = { message: "chore: update report sitemap [skip ci]", content: Buffer.from(xml).toString("base64") };
  if (sha) body.sha = sha;
  await fetch(apiBase, { method: "PUT", headers, body: JSON.stringify(body) });
}

export async function handler(event, context) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: corsHeaders(), body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json(500, { error: "Server not configured: ANTHROPIC_API_KEY is missing." });

  let primaryUrl, extraUrls, competitorUrls, force;
  try {
    const body = JSON.parse(event.body || "{}");
    primaryUrl = normalizeUrl(body.url);
    // extra_urls = all pages for gap analysis (competitors + reference)
    extraUrls = (Array.isArray(body.extra_urls) ? body.extra_urls : [])
      .map(normalizeUrl).filter(Boolean).slice(0, 3);
    // competitor_urls = subset of extra_urls that get their own report page
    competitorUrls = new Set(
      (Array.isArray(body.competitor_urls) ? body.competitor_urls : [])
        .map(normalizeUrl).filter(Boolean).slice(0, 2)
    );
    force = body.force === true;
  } catch {
    return json(400, { error: "Invalid request body." });
  }
  if (!primaryUrl) return json(400, { error: "Please enter a valid website URL." });

  const cacheKey = domainCacheKey(primaryUrl);
  const TTL = 90 * 24 * 60 * 60;

  // 1. Return cache if no extra pages and no force flag.
  if (!force && extraUrls.length === 0 && cacheKey) {
    try {
      const store = getStore({ name: "audit-reports", context });
      const cached = await store.get(cacheKey, { type: "json" });
      if (cached) return json(200, { ...cached, cached: true, cachedAt: cached.analyzedAt });
    } catch { /* fall through */ }
  }

  // 2. Scrape all pages in parallel.
  const allScraped = await Promise.all([
    scrapePage(primaryUrl),
    ...extraUrls.map(scrapePage),
  ]);
  const primary = allScraped[0];
  const extras = allScraped.slice(1);

  if (primary.error) {
    return json(200, { error: `Could not load your page: ${primary.error}. Check it is publicly accessible.` });
  }

  // extras that are competitors (get own report) vs reference-only (gap analysis only)
  const competitorExtras = extras.filter(e => !e.error && competitorUrls.has(e.url));
  const allValidExtras = extras.filter(e => !e.error);

  // 3. Run Claude analyses in parallel: primary (with all pages for gap analysis) + one per competitor.
  const claudePromises = [
    callClaude(buildPrimaryPrompt(primary, allValidExtras), apiKey),
    ...competitorExtras.map(e => callClaude(buildCompetitorPrompt(e), apiKey)),
  ];

  let analysisResults;
  try {
    analysisResults = await Promise.all(claudePromises);
  } catch {
    return json(502, { error: "Could not complete the analysis. Please try again." });
  }

  const primaryData = analysisResults[0];
  const competitorDataList = analysisResults.slice(1);

  // 4. Build slugs.
  const brandSlug = brandToSlug(primaryData.brand || primaryData.domain || "brand");
  const analyzedAt = new Date().toISOString();

  const competitorMeta = competitorDataList.map((cd, i) => ({
    slug: brandToSlug(cd.brand || cd.domain || "competitor"),
    brand: cd.brand || cd.domain || "Competitor",
    domain: cd.domain || "",
    score: cd.score || 0,
    url: competitorExtras[i].url,
    cacheKey: domainCacheKey(competitorExtras[i].url),
  }));

  // 5. Save all reports to Blobs with cross-links, and update the report index for the sitemap.
  try {
    const store = getStore({ name: "audit-reports", context });

    // Primary report includes competitor_reports for the "Compare with" section.
    const primaryPayload = {
      url: primaryUrl,
      extra_urls: extraUrls,
      analyzedAt,
      slug: brandSlug,
      cacheKey,
      competitor_reports: competitorMeta.map(m => ({ slug: m.slug, brand: m.brand, domain: m.domain, score: m.score, url: m.url })),
      ...primaryData,
    };
    await saveReport(store, primaryPayload, TTL);

    // Each competitor report stores compared_to so it can link back.
    await Promise.all(competitorMeta.map((meta, i) => {
      const payload = {
        url: meta.url,
        extra_urls: [],
        analyzedAt,
        slug: meta.slug,
        cacheKey: meta.cacheKey,
        compared_to: [{ slug: brandSlug, brand: primaryData.brand || primaryData.domain || "the analyzed brand", domain: primaryData.domain || "", url: primaryUrl }],
        ...competitorDataList[i],
      };
      return saveReport(store, payload, TTL);
    }));

    // Update the report index used by the sitemap function.
    // Read existing index, merge new entries, deduplicate by slug, save back.
    const allNewEntries = [
      { slug: brandSlug, brand: primaryData.brand || primaryData.domain || "brand", analyzedAt },
      ...competitorMeta.map(m => ({ slug: m.slug, brand: m.brand, analyzedAt })),
    ];
    try {
      const existing = await store.get("_report-index", { type: "json" }) || [];
      const existingSlugs = new Set(existing.map(e => e.slug));
      const merged = [
        ...allNewEntries.filter(e => !existingSlugs.has(e.slug)),
        ...existing,
      ].slice(0, 5000); // cap at 5000 entries
      await store.setJSON("_report-index", merged);
      // Push updated sitemap to GitHub Pages and ping search engines.
      await pushSitemapToGithub(merged);
      const sitemapUrl = encodeURIComponent("https://jeevanai.co.in/sitemap-reports.xml");
      await Promise.allSettled([
        fetch(`https://www.google.com/ping?sitemap=${sitemapUrl}`),
        fetch(`https://www.bing.com/ping?sitemap=${sitemapUrl}`),
      ]);
    } catch { /* index update is best-effort */ }

  } catch {
    // Blobs write failed — still return the primary result.
    return json(200, { url: primaryUrl, ...primaryData, slug: brandSlug, reportSlug: brandSlug, cached: false,
      competitor_reports: competitorMeta.map(m => ({ slug: m.slug, brand: m.brand, score: m.score, url: m.url })) });
  }

  return json(200, {
    url: primaryUrl,
    ...primaryData,
    slug: brandSlug,
    reportSlug: brandSlug,
    cached: false,
    competitor_reports: competitorMeta.map(m => ({ slug: m.slug, brand: m.brand, domain: m.domain, score: m.score, url: m.url })),
  });
}
