// Shared backend for the AI-powered GEO tools.
// Routes by { task } and returns structured JSON. One Claude API key (env var) powers all of them.
// Tasks: "schema" (URL in -> JSON-LD), "rewrite" (text in -> extractable chunks), "entity" (brand info -> entity definition).

const MODEL = "claude-opus-4-8"; // swap to "claude-sonnet-4-6" for faster/cheaper responses
const MAX_HTML_CHARS = 10000;
const MAX_INPUT_CHARS = 8000;

const PROMPTS = {
  schema: {
    needsUrl: true,
    system: `You generate JSON-LD structured data for AI search visibility. Given a page's content, produce valid schema.org JSON-LD that helps AI engines (ChatGPT, Claude, Perplexity, Gemini) understand and cite the page.

Include the most relevant types based on what the page actually is: Organization (always, if a brand/site), plus FAQPage if there are question/answer pairs, Article if it is editorial/blog content, Product or SoftwareApplication if it is a product, LocalBusiness if it is a local service. Fill every field from the ACTUAL content provided, never placeholders. If a field is unknown, omit it rather than guessing.

Respond with ONLY valid JSON, no markdown fences, matching exactly:
{"jsonld": "<a single string containing one or more complete <script type=\\"application/ld+json\\"> ... </script> blocks, ready to paste into the page head>", "types": ["<type names included>"], "note": "<one sentence on where to place it and what to double-check>"}`,
  },
  rewrite: {
    needsUrl: false,
    system: `You rewrite content to be maximally extractable by AI search engines. AI engines cite self-contained passages of roughly 50-150 words that lead with a direct answer, make specific verifiable claims, and do not depend on surrounding context.

Rewrite the user's text into that format: lead with the direct answer, keep it specific and concrete, break into self-contained chunks with clear sub-points if needed, and remove vague marketing filler. Preserve the facts and meaning; do not invent claims.

Respond with ONLY valid JSON, no markdown fences, matching exactly:
{"rewritten": "<the rewritten, extractable version>", "notes": ["<what you changed and why, 1 short sentence>", "<another>", "<another>"]}`,
  },
  entity: {
    needsUrl: false,
    system: `You write brand entity definitions for AI search visibility. A strong entity definition states, in 1-2 sentences, the brand's category, who it is for, its primary use case, and its key differentiator, in plain extractable language an AI can cite. Consistency of this definition across the website, review sites, and LinkedIn is one of the highest-leverage GEO levers.

From the brand information provided, write the canonical definition plus three platform-tailored versions.

Respond with ONLY valid JSON, no markdown fences, matching exactly:
{"definition": "<the canonical 1-2 sentence entity definition>", "website": "<version for the homepage / about page>", "g2": "<version for a G2 / Capterra product description>", "linkedin": "<version for the LinkedIn company tagline + about>"}`,
  },
};

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
  try { const p = new URL(u); return /^https?:$/.test(p.protocol) ? p.toString() : null; } catch { return null; }
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
  const s = text.indexOf("{"), e = text.lastIndexOf("}");
  if (s === -1 || e === -1) throw new Error("No JSON in response");
  return JSON.parse(text.slice(s, e + 1));
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: corsHeaders(), body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json(500, { error: "Server not configured: ANTHROPIC_API_KEY is missing." });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Invalid request body." }); }

  const task = body.task;
  const spec = PROMPTS[task];
  if (!spec) return json(400, { error: "Unknown task." });

  let userContent;
  if (spec.needsUrl) {
    const url = normalizeUrl(body.input);
    if (!url) return json(400, { error: "Please enter a valid website URL." });
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(url, { signal: ctrl.signal, redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 (compatible; JeevanAI-Tools/1.0; +https://jeevanai.co.in)" } });
      clearTimeout(t);
      if (!res.ok) return json(200, { error: `Could not load that page (HTTP ${res.status}).` });
      userContent = `URL: ${url}\n\nPAGE CONTENT (scripts/styles stripped, truncated):\n${cleanHtml(await res.text())}`;
    } catch { return json(200, { error: "Could not reach that URL. It may be down or blocking automated requests." }); }
  } else {
    const text = (body.input || "").toString().slice(0, MAX_INPUT_CHARS).trim();
    if (!text) return json(400, { error: "Please enter some text." });
    userContent = text;
  }

  let data;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: 2200, system: spec.system, messages: [{ role: "user", content: userContent }] }),
    });
    const payload = await res.json();
    if (!res.ok) return json(502, { error: `Service error (${res.status}). Please try again.` });
    const textBlock = (payload.content || []).find((b) => b.type === "text");
    if (!textBlock) return json(502, { error: "Empty response. Please try again." });
    data = parseClaudeJson(textBlock.text);
  } catch { return json(502, { error: "Could not complete the request. Please try again." }); }

  return json(200, data);
}
