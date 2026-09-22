// AI-Readiness Page Analyzer — Netlify serverless function.
// Checks Netlify Blobs cache by domain before calling Claude.
// Same domain = return saved report (no API cost). Pass force:true to re-analyze.

import { getStore } from "@netlify/blobs";

const MODEL = "claude-haiku-4-5-20251001";
const MAX_HTML_CHARS = 4000;

const SYSTEM_PROMPT = `You are an AI search visibility analyst. Score a brand page and return ONLY valid JSON, no markdown.

Score these six factors (0-100): Entity Clarity, Extractable Structure, Schema Markup, FAQ Coverage, Answer-Led Content, Specificity & Evidence.

Return this exact JSON shape:
{"brand":"<name>","domain":"<domain>","category":"<5-8 words>","score":<0-100>,"verdict":"<1 sentence>","ai_summary":"<2 sentences>","categories":[{"name":"<factor>","score":<0-100>,"finding":"<1 sentence>","fix":"<1 action>"}],"top_fixes":["<fix1>","<fix2>","<fix3>"],"gaps":[{"topic":"<topic>","why":"<why>","fix":"<action>"}],"jeevanai_value":"<2 sentences>"}

Rules: all 6 factors in categories array; 3-5 gaps; reference actual page content; name the brand in verdict.`;

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
    const t = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; JeevanAI-Analyzer/1.0; +https://jeevanai.co.in)" },
    });
    if (!res.ok) { clearTimeout(t); return { url, error: `HTTP ${res.status}` }; }
    const html = await res.text();
    clearTimeout(t);
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
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
    }),
  });
  const payload = await res.json();
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${JSON.stringify(payload)}`);
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

async function pushFileToGithub(pat, repoPath, content, commitMsg) {
  const apiUrl = `https://api.github.com/repos/jeevanAI-Jobs/personal/contents/${repoPath}`;
  const headers = {
    "Authorization": `Bearer ${pat}`,
    "Accept": "application/vnd.github+json",
    "Content-Type": "application/json",
  };
  let sha;
  try {
    const r = await fetch(apiUrl, { headers });
    if (r.ok) { const d = await r.json(); sha = d.sha; }
  } catch { /* new file */ }
  const body = { message: commitMsg, content: Buffer.from(content).toString("base64") };
  if (sha) body.sha = sha;
  await fetch(apiUrl, { method: "PUT", headers, body: JSON.stringify(body) });
}

function buildStaticReportHtml(data) {
  const esc = s => String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  const score = Math.max(0, Math.min(100, parseInt(data.score, 10) || 0));
  const brand = esc(data.brand || data.domain || "This Brand");
  const verdict = esc(data.verdict || "");
  const color = score >= 70 ? "#059669" : score >= 40 ? "#d97706" : "#dc2626";
  const analyzedAt = data.analyzedAt ? new Date(data.analyzedAt).toLocaleDateString("en-US", {month:"short",day:"numeric",year:"numeric"}) : "";
  const gapsHtml = (data.gaps || []).slice(0, 3).map(g =>
    `<div class="gap-card"><div class="gap-topic">${esc(g.topic)}</div><div class="gap-why">${esc(g.why)}</div><div class="gap-fix"><b>Add:</b> ${esc(g.fix)}</div></div>`).join("");
  const catsHtml = (data.categories || []).slice(0, 2).map(c => {
    const cs = Math.max(0, Math.min(100, parseInt(c.score, 10) || 0));
    const cc = cs >= 70 ? "#059669" : cs >= 40 ? "#d97706" : "#dc2626";
    return `<div class="cat"><div class="cat-top"><span class="cat-name">${esc(c.name)}</span><span class="cat-score" style="color:${cc}">${cs}/100</span></div><div class="bar"><i style="width:${cs}%;background:${cc}"></i></div><div class="cat-finding">${esc(c.finding)}</div><div class="cat-fix"><b>Fix:</b> ${esc(c.fix)}</div></div>`;
  }).join("");
  const fix0 = (data.top_fixes || [])[0] ? `<div class="fix-item"><span class="fix-num">1</span><span>${esc(data.top_fixes[0])}</span></div>` : "";
  const canonicalSlug = data.slug || "";
  const descContent = verdict ? `${data.verdict} Full AI search visibility report by Jeevan AI.` : `AI search visibility report for ${data.brand || data.domain || "this brand"} by Jeevan AI.`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<script async src="https://www.googletagmanager.com/gtag/js?id=G-S6X8Q5EY8E"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-S6X8Q5EY8E');</script>
<meta charset="UTF-8"><link rel="icon" type="image/png" href="/logo.png">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${brand} AI Search Visibility Report | Jeevan AI</title>
<meta name="description" content="${esc(descContent)}">
<meta name="robots" content="index,follow">
<link rel="canonical" href="https://jeevanai.co.in/report/${encodeURIComponent(canonicalSlug)}/">
<meta property="og:title" content="${brand} AI Search Visibility Report | Jeevan AI">
<meta property="og:description" content="${esc(descContent)}">
<meta property="og:type" content="article">
<meta property="og:url" content="https://jeevanai.co.in/report/${encodeURIComponent(canonicalSlug)}/">
<script type="application/ld+json">${JSON.stringify({"@context":"https://schema.org","@type":"Article","headline":`${data.brand || data.domain} AI Search Visibility Report`,"description":data.verdict || `AI visibility report for ${data.brand || data.domain}`,"url":`https://jeevanai.co.in/report/${canonicalSlug}/`,"publisher":{"@type":"Organization","name":"Jeevan AI","url":"https://jeevanai.co.in"},"datePublished":data.analyzedAt||new Date().toISOString(),"about":{"@type":"Organization","name":data.brand||data.domain||"","url":data.url||"#"}})}</script>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=DM+Serif+Display&display=swap" rel="stylesheet">
<style>
:root{--accent:#6366f1;--accent-dim:rgba(99,102,241,0.1);--text:#111827;--muted:#6b7280;--bg:#fafafa;--card:#fff;--border:#e5e7eb;--font-sans:'DM Sans',system-ui,sans-serif;--font-serif:'DM Serif Display',Georgia,serif;--max-w:800px}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--text);font-family:var(--font-sans);-webkit-font-smoothing:antialiased;line-height:1.6}
a{color:inherit;text-decoration:none}
.nav{position:sticky;top:0;z-index:100;background:rgba(250,250,250,0.95);backdrop-filter:blur(16px);border-bottom:1px solid var(--border);padding:0 24px}
.nav__inner{max-width:var(--max-w);margin:0 auto;display:flex;align-items:center;justify-content:space-between;height:64px}
.nav__logo{display:flex;align-items:center;gap:10px;font-weight:700;font-size:1.05rem}
.nav__cta{padding:8px 18px;border-radius:8px;background:var(--accent);color:#fff;font-size:0.875rem;font-weight:600}
.wrap{max-width:var(--max-w);margin:0 auto;padding:36px 24px 80px}
.report-header{background:linear-gradient(135deg,#0f172a 0%,#1e1b4b 50%,#1e3a8a 100%);border-radius:16px;padding:32px;margin-bottom:20px;color:#fff}
.report-badge{font-size:0.7rem;font-weight:700;letter-spacing:0.09em;text-transform:uppercase;background:rgba(165,180,252,0.15);border:1px solid rgba(165,180,252,0.3);padding:4px 12px;border-radius:100px;color:#a5b4fc}
.score-row{display:flex;align-items:flex-start;gap:24px;flex-wrap:wrap;margin-top:16px}
.score-ring{flex-shrink:0;width:80px;height:80px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:1.7rem;font-weight:700;color:#fff}
.score-label{font-size:0.68rem;font-weight:700;letter-spacing:0.09em;text-transform:uppercase;color:rgba(165,180,252,0.7);margin-bottom:4px}
.verdict{font-family:var(--font-serif);font-size:1.2rem;color:#fff;line-height:1.4;margin-bottom:6px}
.analyzed-date{font-size:0.78rem;color:rgba(255,255,255,0.4)}
.ai-summary{background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.12);border-radius:12px;padding:18px 20px;margin-top:20px}
.ai-summary-label{font-size:0.68rem;font-weight:700;letter-spacing:0.09em;text-transform:uppercase;color:#a5b4fc;margin-bottom:8px}
.ai-summary-text{font-size:0.92rem;color:rgba(255,255,255,0.82);line-height:1.65}
.section{margin-bottom:20px}
.section-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
.section-head h2{font-family:var(--font-serif);font-size:1.1rem}
.section-tag{font-size:0.7rem;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;padding:3px 9px;border-radius:100px;background:#fee2e2;color:#991b1b}
.section-tag.purple{background:#ede9fe;color:#5b21b6}
.gap-card{background:var(--card);border:1px solid var(--border);border-left:3px solid #dc2626;border-radius:10px;padding:16px 18px;margin-bottom:10px}
.gap-topic{font-weight:600;font-size:0.9rem;margin-bottom:4px}
.gap-why{font-size:0.84rem;color:var(--muted);line-height:1.5;margin-bottom:6px}
.gap-fix{font-size:0.84rem;line-height:1.5}
.gap-fix b{color:var(--accent)}
.jeevanai-block{background:linear-gradient(135deg,#312e81 0%,#4338ca 100%);border-radius:14px;padding:24px 26px;margin-bottom:20px;color:#fff}
.ja-label{font-size:0.68rem;font-weight:700;letter-spacing:0.09em;text-transform:uppercase;color:#a5b4fc;margin-bottom:8px}
.ja-title{font-family:var(--font-serif);font-size:1.1rem;margin-bottom:10px}
.ja-text{font-size:0.9rem;color:rgba(255,255,255,0.82);line-height:1.65;margin-bottom:18px}
.btn-white{display:inline-block;padding:10px 22px;border-radius:9px;background:#fff;color:#4338ca;font-weight:700;font-size:0.88rem}
.cats{display:flex;flex-direction:column;gap:10px}
.cat{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:18px 20px}
.cat-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
.cat-name{font-weight:600;font-size:0.9rem}
.cat-score{font-size:0.8rem;font-weight:700}
.bar{height:5px;background:#f3f4f6;border-radius:3px;margin-bottom:10px;overflow:hidden}
.bar i{display:block;height:100%;border-radius:3px}
.cat-finding{font-size:0.85rem;color:var(--muted);margin-bottom:5px;line-height:1.5}
.cat-fix{font-size:0.85rem;line-height:1.5}
.cat-fix b{color:var(--accent)}
.fix-item{display:flex;align-items:flex-start;gap:12px;padding:14px 16px;background:var(--card);border:1px solid var(--border);border-radius:10px;font-size:0.87rem}
.fix-num{flex-shrink:0;width:24px;height:24px;border-radius:6px;background:var(--accent-dim);color:var(--accent);font-size:0.78rem;font-weight:700;display:flex;align-items:center;justify-content:center}
.lock-section{position:relative;margin-bottom:20px}
.lock-blur{filter:blur(5px);pointer-events:none;user-select:none;opacity:0.55}
.lock-overlay{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;z-index:2;background:radial-gradient(ellipse at center,rgba(250,250,250,0.97) 20%,rgba(250,250,250,0.88) 100%);border-radius:12px;padding:24px;text-align:center}
.lock-title{font-family:var(--font-serif);font-size:1.05rem}
.lock-sub{font-size:0.84rem;color:var(--muted);max-width:360px;line-height:1.5}
.btn-primary{display:inline-block;padding:11px 24px;border-radius:9px;background:var(--accent);color:#fff;font-weight:700;font-size:0.88rem}
.footer{text-align:center;padding:24px;font-size:0.8rem;color:var(--muted);border-top:1px solid var(--border)}
</style>
</head>
<body>
<nav class="nav"><div class="nav__inner">
  <a href="/index.html" class="nav__logo"><img src="/logo.png" alt="Jeevan AI" style="width:36px;height:36px;border-radius:8px;object-fit:cover"><span>Jeevan AI</span></a>
  <a href="https://dashboard.jeevanai.co.in/auth/login" class="nav__cta">Sign In</a>
</div></nav>
<div class="wrap">
  <div class="report-header">
    <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <span class="report-badge">AI Search Visibility Report</span>
      ${data.url ? `<a href="${esc(data.url)}" style="font-size:0.85rem;color:rgba(165,180,252,0.85);text-decoration:underline;text-underline-offset:3px" target="_blank" rel="noopener">${esc(data.domain || data.url)}</a>` : ""}
    </div>
    <div class="score-row">
      <div class="score-ring" style="background:${color}">${score}</div>
      <div>
        <div class="score-label">Overall AI Visibility Score</div>
        <div class="verdict">${verdict}</div>
        ${analyzedAt ? `<div class="analyzed-date">Analyzed ${analyzedAt}</div>` : ""}
      </div>
    </div>
    ${data.ai_summary ? `<div class="ai-summary"><div class="ai-summary-label">What AI engines see today</div><p class="ai-summary-text">${esc(data.ai_summary)}</p></div>` : ""}
  </div>
  ${gapsHtml ? `<div class="section"><div class="section-head"><h2>Content Gaps Costing Citations</h2><span class="section-tag">${(data.gaps||[]).length} identified</span></div>${gapsHtml}</div>` : ""}
  <div class="jeevanai-block">
    <div class="ja-label">Where Jeevan AI comes in</div>
    <h3 class="ja-title">How Jeevan AI would help ${brand}</h3>
    <p class="ja-text">${esc(data.jeevanai_value || `Jeevan AI tracks how often AI engines cite ${data.brand || data.domain} across ChatGPT, Gemini, and Perplexity, scores it against competitors on each buying factor, and surfaces content gaps before they cost leads.`)}</p>
    <a href="https://dashboard.jeevanai.co.in/auth/login" class="btn-white">Start free brand scan</a>
  </div>
  ${catsHtml ? `<div class="section"><div class="section-head"><h2>Factor Breakdown</h2><span class="section-tag purple">2 of 6 shown</span></div><div class="cats">${catsHtml}</div></div>` : ""}
  <div class="lock-section">
    <div class="lock-blur cats">${(data.categories||[]).slice(2).map(c=>`<div class="cat"><div class="cat-top"><span class="cat-name">${esc(c.name)}</span><span class="cat-score">${c.score}/100</span></div></div>`).join("")}</div>
    <div class="lock-overlay">
      <div class="lock-title">4 more scored factors in the full report</div>
      <div class="lock-sub">Sign up free to see all 6 factors, a competitor comparison, and a content plan for your brand.</div>
      <a href="https://dashboard.jeevanai.co.in/auth/login" class="btn-primary">See full report free</a>
    </div>
  </div>
  ${fix0 ? `<div class="section"><div class="section-head"><h2>Top Priority Fix</h2></div>${fix0}</div>` : ""}
  <div style="text-align:center;padding:4px 0 12px">
    <a href="/tools/ai-readiness-analyzer.html" style="font-size:0.85rem;color:var(--accent);font-weight:600">Analyze a different page &rarr;</a>
  </div>
</div>
<div class="footer"><a href="/index.html" style="color:inherit">Jeevan AI</a> &middot; AI visibility platform &middot; <a href="/tools/ai-readiness-analyzer.html" style="color:var(--accent)">Run your own analysis</a></div>
</body></html>`;
}

async function pushReportJson(slug, data) {
  const pat = process.env.GITHUB_PAT;
  if (!pat) return;
  try {
    const html = buildStaticReportHtml(data);
    // Push static HTML page for clean SEO URL: /report/{slug}/
    await pushFileToGithub(pat, `report/${slug}/index.html`, html, `feat: static report page ${slug} [skip ci]`);
    // Also push JSON for the dynamic fallback route
    const content = JSON.stringify(data);
    await pushFileToGithub(pat, `report-data/${slug}.json`, content, `chore: report data ${slug} [skip ci]`);
  } catch { /* best-effort */ }
}

async function pushSitemapToGithub(entries) {
  const pat = process.env.GITHUB_PAT;
  if (!pat) return;

  const BASE = "https://jeevanai.co.in";
  const urls = entries.map(e => {
    const loc = `${BASE}/report/${encodeURIComponent(e.slug)}/`;
    const lastmod = (e.analyzedAt || new Date().toISOString()).slice(0, 10);
    return `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.7</priority>\n  </url>`;
  }).join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;
  try {
    await pushFileToGithub(pat, "sitemap-reports.xml", xml, "chore: update report sitemap [skip ci]");
  } catch { /* best-effort */ }
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
  } catch (err) {
    console.error("[analyze-page] Claude error:", err.message);
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

  // 5. Build the response payload.
  const responsePayload = {
    url: primaryUrl,
    ...primaryData,
    slug: brandSlug,
    reportSlug: brandSlug,
    cached: false,
    competitor_reports: competitorMeta.map(m => ({ slug: m.slug, brand: m.brand, domain: m.domain, score: m.score, url: m.url })),
  };

  // 6. Fire-and-forget saves/pushes — don't block the response.
  (async () => {
    try {
      const store = getStore({ name: "audit-reports", context });
      const primaryPayload = { url: primaryUrl, extra_urls: extraUrls, analyzedAt, slug: brandSlug, cacheKey,
        competitor_reports: responsePayload.competitor_reports, ...primaryData };
      await saveReport(store, primaryPayload, TTL);
      pushReportJson(brandSlug, primaryPayload);
      await Promise.all(competitorMeta.map((meta, i) => {
        const payload = { url: meta.url, extra_urls: [], analyzedAt, slug: meta.slug, cacheKey: meta.cacheKey,
          compared_to: [{ slug: brandSlug, brand: primaryData.brand || primaryData.domain || "brand", domain: primaryData.domain || "", url: primaryUrl }],
          ...competitorDataList[i] };
        pushReportJson(meta.slug, payload);
        return saveReport(store, payload, TTL);
      }));
      // Update report index + sitemap (best-effort, slow ops)
      const allNewEntries = [
        { slug: brandSlug, brand: primaryData.brand || primaryData.domain || "brand", analyzedAt },
        ...competitorMeta.map(m => ({ slug: m.slug, brand: m.brand, analyzedAt })),
      ];
      const existing = await store.get("_report-index", { type: "json" }) || [];
      const existingSlugs = new Set(existing.map(e => e.slug));
      const merged = [...allNewEntries.filter(e => !existingSlugs.has(e.slug)), ...existing].slice(0, 5000);
      await store.setJSON("_report-index", merged);
      await pushSitemapToGithub(merged);
      const sitemapUrl = encodeURIComponent("https://jeevanai.co.in/sitemap-reports.xml");
      Promise.allSettled([
        fetch(`https://www.google.com/ping?sitemap=${sitemapUrl}`),
        fetch(`https://www.bing.com/ping?sitemap=${sitemapUrl}`),
      ]);
    } catch { /* best-effort */ }
  })();

  return json(200, responsePayload);
}
