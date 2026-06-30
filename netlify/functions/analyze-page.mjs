// AI-Readiness Page Analyzer — server-side function.
// Fetches the visitor's URL, then asks Claude to score it for AI search visibility.
// The Claude API key lives ONLY here, in the ANTHROPIC_API_KEY environment variable
// (set in Netlify → Site settings → Environment variables). It never reaches the browser.

const MODEL = "claude-opus-4-8"; // swap to "claude-sonnet-4-6" for faster/cheaper responses
const MAX_HTML_CHARS = 12000;

const SYSTEM_PROMPT = `You are an AI search visibility (GEO) analyst. You evaluate a web page for how well AI engines like ChatGPT, Claude, Perplexity, and Gemini can understand, extract, and cite it.

Score the page (0-100 each) on these six factors:
1. Entity Clarity — does the page state, early and unambiguously, what the brand/page is, who it is for, and its primary purpose?
2. Extractable Structure — are sections self-contained and answer-led (50-150 word chunks an AI can lift), with descriptive headings?
3. Schema Markup — is JSON-LD structured data present and relevant (Organization, FAQPage, Article, Product, LocalBusiness, etc.)?
4. FAQ Coverage — does the page answer the specific questions a buyer would ask, ideally as question/answer pairs?
5. Answer-Led Content — does content lead with direct answers and specific, verifiable claims rather than vague marketing copy?
6. Specificity & Evidence — concrete facts, numbers, named entities, and credibility signals an AI can quote.

For each factor give a short finding (what you see) and a concrete fix (what to change).

Respond with ONLY valid JSON, no markdown fences, matching exactly:
{"score": <int 0-100 overall>, "verdict": "<one sentence, <=160 chars>", "categories": [{"name": "<factor>", "score": <int 0-100>, "finding": "<1 sentence>", "fix": "<1 sentence>"}], "top_fixes": ["<fix 1>", "<fix 2>", "<fix 3>"]}
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

// Detect JSON-LD schema @type values without removing the script content first.
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

// Strip script/style blocks (keeps tags so Claude can see headings/structure), then cap length.
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

  // 1. Fetch the live page (with a timeout so we stay within the function limit).
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
  } catch (e) {
    return json(200, { error: "Could not reach that URL. It may be down, blocking automated requests, or behind a login." });
  }

  const schemaTypes = detectSchemaTypes(html);
  const cleaned = cleanHtml(html);

  // 2. Ask Claude to score it.
  const userContent =
    `Analyze this page for AI search visibility.\n\nURL: ${url}\n` +
    `Detected JSON-LD schema types: ${schemaTypes.length ? schemaTypes.join(", ") : "none found"}\n\n` +
    `PAGE CONTENT (scripts/styles stripped, truncated):\n${cleaned}`;

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
        max_tokens: 2500,
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
  } catch (e) {
    return json(502, { error: "Could not complete the analysis. Please try again." });
  }

  return json(200, { url, ...data });
}
