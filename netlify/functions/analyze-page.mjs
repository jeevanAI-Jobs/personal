// AI-Readiness Page Analyzer — Netlify serverless function.
// Scrapes the primary URL + up to 2 optional extra URLs, sends all content to Claude
// for a brand-specific report with gap analysis, and stores it under a brand slug.

import { getStore } from "@netlify/blobs";

const MODEL = "claude-opus-4-8";
const MAX_HTML_CHARS = 10000; // per page, lower to fit multiple pages in prompt

const SYSTEM_PROMPT_BASE = `You are an AI search visibility analyst writing a client-facing diagnostic report. Your job is to tell a brand exactly how AI engines see them RIGHT NOW, what is costing them citations, and why Jeevan AI would help.

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
The categories array must contain all six factors in order. The gaps array should have 3-5 items; if no extra pages were provided, generate gaps based on what competitor pages in this category would typically cover.`;

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
  } catch (e) {
    return { url, error: "Could not reach URL" };
  }
}

function parseClaudeJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON in response");
  return JSON.parse(text.slice(start, end + 1));
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: corsHeaders(), body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json(500, { error: "Server not configured: ANTHROPIC_API_KEY is missing." });

  let primaryUrl, extraUrls;
  try {
    const body = JSON.parse(event.body || "{}");
    primaryUrl = normalizeUrl(body.url);
    extraUrls = (Array.isArray(body.extra_urls) ? body.extra_urls : [])
      .map(normalizeUrl)
      .filter(Boolean)
      .slice(0, 2);
  } catch {
    return json(400, { error: "Invalid request body." });
  }
  if (!primaryUrl) return json(400, { error: "Please enter a valid website URL." });

  // 1. Scrape all pages in parallel.
  const [primary, ...extras] = await Promise.all([
    scrapePage(primaryUrl),
    ...extraUrls.map(scrapePage),
  ]);

  if (primary.error) {
    return json(200, { error: `Could not load your page: ${primary.error}. Check it is publicly accessible.` });
  }

  // 2. Build the analysis prompt.
  let userContent =
    `Write a brand-specific AI visibility report for the PRIMARY page below.\n` +
    `PRIMARY URL: ${primary.url}\n` +
    `Schema types detected: ${primary.schemaTypes.length ? primary.schemaTypes.join(", ") : "none"}\n\n` +
    `PRIMARY PAGE CONTENT:\n${primary.content}`;

  if (extras.length > 0) {
    userContent += `\n\n--- ADDITIONAL PAGES FOR GAP ANALYSIS ---`;
    extras.forEach((e, i) => {
      if (e.error) {
        userContent += `\n\nADDITIONAL PAGE ${i + 1}: ${e.url} — could not be fetched (${e.error}), skip it.`;
      } else {
        userContent +=
          `\n\nADDITIONAL PAGE ${i + 1}: ${e.url}\n` +
          `Schema types: ${e.schemaTypes.length ? e.schemaTypes.join(", ") : "none"}\n` +
          `CONTENT:\n${e.content}`;
      }
    });
    userContent += `\n\nIdentify topics, questions, and evidence in the ADDITIONAL PAGES that the PRIMARY page is missing. These become the gaps array.`;
  }

  // 3. Ask Claude.
  let data;
  try {
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
        system: SYSTEM_PROMPT_BASE,
        messages: [{ role: "user", content: userContent }],
      }),
    });
    const payload = await res.json();
    if (!res.ok) return json(502, { error: `Analysis service error (${res.status}). Please try again.` });
    const textBlock = (payload.content || []).find((b) => b.type === "text");
    if (!textBlock) return json(502, { error: "Empty analysis response. Please try again." });
    data = parseClaudeJson(textBlock.text);
  } catch {
    return json(502, { error: "Could not complete the analysis. Please try again." });
  }

  // 4. Build slug: "{brand}-ai-search-visibility"
  const slug = brandToSlug(data.brand || data.domain || "brand");
  const reportPayload = {
    url: primaryUrl,
    extra_urls: extraUrls,
    analyzedAt: new Date().toISOString(),
    slug,
    ...data,
  };

  // 5. Save to Netlify Blobs under the slug.
  try {
    const store = getStore("audit-reports");
    await store.setJSON(slug, reportPayload, { ttl: 90 * 24 * 60 * 60 });
  } catch {
    return json(200, { url: primaryUrl, ...data, slug });
  }

  return json(200, { url: primaryUrl, ...data, slug, reportSlug: slug });
}
