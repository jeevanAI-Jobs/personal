// AI-Readiness Page Analyzer — server-side function.
// Fetches the visitor's URL, asks Claude for a brand-specific AI visibility report,
// and saves it to Netlify Blobs keyed by brand slug for shareable/indexable URLs.

import { getStore } from "@netlify/blobs";

const MODEL = "claude-opus-4-8";
const MAX_HTML_CHARS = 14000;

const SYSTEM_PROMPT = `You are an AI search visibility analyst writing a client-facing diagnostic report. Your job is to tell a brand exactly how AI engines see them RIGHT NOW, what is costing them citations, and why Jeevan AI would fix it.

Rules:
- Reference actual content from the page, not generic advice.
- Name the brand in every key field.
- Be blunt. If the page is weak, say why specifically.
- Frame everything as: "when a buyer asks ChatGPT or Perplexity about [this brand's category], here is what happens."

Score the page on these six factors (0-100 each):
1. Entity Clarity — does the page state, in the first 200 words, what this brand is, who it serves, and what makes it different? Can an AI engine confidently describe this brand from this page alone?
2. Extractable Structure — are sections self-contained 60-150 word chunks an AI can lift verbatim? Or is the page wall-to-wall marketing copy?
3. Schema Markup — is JSON-LD structured data present and accurate (Organization, FAQPage, Article, Product, SoftwareApplication, etc.)?
4. FAQ Coverage — does the page directly answer the questions a buyer would ask an AI before choosing this brand over a competitor?
5. Answer-Led Content — does the page lead with direct, quotable answers and specific claims, or does it open with vague slogans and hero copy?
6. Specificity & Evidence — concrete numbers, named case results, certifications, and credibility signals an AI can quote as evidence.

Respond with ONLY valid JSON, no markdown fences:
{
  "brand": "<actual brand or company name from the page>",
  "domain": "<root domain without www, e.g. hubspot.com>",
  "slug": "<kebab-case slug from domain, e.g. hubspot-com>",
  "category": "<what this brand does in 5-8 words, e.g. CRM and marketing automation software>",
  "score": <int 0-100 overall>,
  "verdict": "<1 sentence naming the brand and its specific AI visibility situation — is it being cited, ignored, or misrepresented?>",
  "ai_summary": "<2 sentences: what happens when a buyer asks ChatGPT or Perplexity about this brand's category right now. Reference a specific gap or strength you observed on the page.>",
  "categories": [
    {"name": "<factor>", "score": <int 0-100>, "finding": "<1-2 sentences, brand-specific, reference actual page content>", "fix": "<1 concrete action naming what to add or change on this specific page>"}
  ],
  "top_fixes": ["<fix 1 — specific, actionable, references this brand>", "<fix 2>", "<fix 3>"],
  "jeevanai_value": "<2 sentences: what Jeevan AI would specifically track and surface for this brand. Name the brand, name the category, name 1-2 specific Jeevan AI features (citation tracking, competitor comparison, content gap scoring) that address the biggest gap you found.>"
}
The categories array must contain all six factors in the order listed.`;

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
  } catch {
    return null;
  }
}

function domainToSlug(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host.replace(/\./g, "-").replace(/[^a-z0-9-]/gi, "").toLowerCase();
  } catch {
    return null;
  }
}

function detectSchemaTypes(html) {
  const types = new Set();
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const typeMatches = m[1].match(/"@type"\s*:\s*"([^"]+)"/g) || [];
    typeMatches.forEach((t) => {
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

function parseClaudeJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON object in model response");
  return JSON.parse(text.slice(start, end + 1));
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: corsHeaders(), body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json(500, { error: "Server not configured: ANTHROPIC_API_KEY is missing." });

  let url;
  try {
    url = normalizeUrl(JSON.parse(event.body || "{}").url);
  } catch {
    return json(400, { error: "Invalid request body." });
  }
  if (!url) return json(400, { error: "Please enter a valid website URL." });

  // 1. Fetch the live page.
  let html;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; JeevanAI-Analyzer/1.0; +https://jeevanai.co.in)" },
    });
    clearTimeout(t);
    if (!res.ok) return json(200, { error: `Could not load that page (HTTP ${res.status}). Check the URL and that it is publicly accessible.` });
    html = await res.text();
  } catch {
    return json(200, { error: "Could not reach that URL. It may be down, blocking automated requests, or behind a login." });
  }

  const schemaTypes = detectSchemaTypes(html);
  const cleaned = cleanHtml(html);

  // 2. Ask Claude for a brand-specific report.
  const userContent =
    `Write a brand-specific AI visibility report for this page.\n\nURL: ${url}\n` +
    `Detected JSON-LD schema types: ${schemaTypes.length ? schemaTypes.join(", ") : "none found"}\n\n` +
    `PAGE CONTENT (scripts/styles stripped, truncated to ${MAX_HTML_CHARS} chars):\n${cleaned}`;

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
        max_tokens: 3000,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userContent }],
      }),
    });
    const payload = await res.json();
    if (!res.ok) {
      return json(502, { error: `Analysis service error (${res.status}). Please try again.`, detail: payload?.error?.message });
    }
    const textBlock = (payload.content || []).find((b) => b.type === "text");
    if (!textBlock) return json(502, { error: "Empty analysis response. Please try again." });
    data = parseClaudeJson(textBlock.text);
  } catch {
    return json(502, { error: "Could not complete the analysis. Please try again." });
  }

  // 3. Save to Netlify Blobs under brand slug (overwrites previous report for same brand).
  const slug = data.slug || domainToSlug(url) || crypto.randomUUID();
  const reportPayload = { url, analyzedAt: new Date().toISOString(), slug, ...data };

  try {
    const store = getStore("audit-reports");
    // Save by slug (overwrite) and also by a timestamped key for history.
    await store.setJSON(slug, reportPayload, { ttl: 90 * 24 * 60 * 60 });
  } catch {
    // Non-fatal: return data without shareable URL.
    return json(200, { url, ...data, slug });
  }

  return json(200, { url, ...data, slug, reportSlug: slug });
}
