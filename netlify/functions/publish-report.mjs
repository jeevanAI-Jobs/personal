// Reads an existing report from Netlify Blobs, renders it as a static HTML page,
// pushes it to GitHub at report/{slug}/index.html, and updates sitemap.xml.
//
// POST /.netlify/functions/publish-report
// Body: { "brand": "hubspot-com" }
//
// Called by the dashboard after a scan completes, or manually.

import { getStore } from "@netlify/blobs";

const REPO = "jeevanAI-Jobs/personal";
const GITHUB_PAT = process.env.GITHUB_PAT;
const BASE_URL = "https://jeevanai.co.in";

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };
}

function json(status, body) {
  return { statusCode: status, headers: cors(), body: JSON.stringify(body) };
}

// ── GitHub helpers ──────────────────────────────────────────────────────────

async function ghGet(path) {
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
    headers: { Authorization: `token ${GITHUB_PAT}`, Accept: "application/vnd.github.v3+json", "User-Agent": "jeevanai-publish" },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub GET ${path} → ${res.status}`);
  return res.json();
}

async function ghPut(path, content, message, sha) {
  const body = { message, content: Buffer.from(content).toString("base64") };
  if (sha) body.sha = sha;
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
    method: "PUT",
    headers: { Authorization: `token ${GITHUB_PAT}`, Accept: "application/vnd.github.v3+json", "Content-Type": "application/json", "User-Agent": "jeevanai-publish" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GitHub PUT ${path} → ${res.status}: ${err}`);
  }
  return res.json();
}

// ── Sitemap helper ──────────────────────────────────────────────────────────

async function updateSitemap(slug, analyzedAt) {
  const entry = ghGet("sitemap.xml");
  const sitemapFile = await entry;
  if (!sitemapFile) return;

  const existing = Buffer.from(sitemapFile.content, "base64").toString("utf-8");
  const reportUrl = `${BASE_URL}/report/${slug}/`;
  const lastmod = analyzedAt ? analyzedAt.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const newEntry = `  <url>\n    <loc>${reportUrl}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.7</priority>\n  </url>`;

  // Skip if already present
  if (existing.includes(`/report/${slug}/`)) {
    // Update lastmod by replacing the existing entry
    const updated = existing.replace(
      new RegExp(`<url>\\s*<loc>${BASE_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/report/${slug}/</loc>[^<]*<lastmod>[^<]*</lastmod>`, ""),
      `<url>\n    <loc>${reportUrl}</loc>\n    <lastmod>${lastmod}</lastmod>`
    );
    if (updated !== existing) {
      await ghPut("sitemap.xml", updated, `chore: update report sitemap entry for ${slug}`, sitemapFile.sha);
    }
    return;
  }

  // Insert before </urlset>
  const updated = existing.replace("</urlset>", `${newEntry}\n</urlset>`);
  await ghPut("sitemap.xml", updated, `chore: add report sitemap entry for ${slug}`, sitemapFile.sha);
}

// ── HTML renderer ───────────────────────────────────────────────────────────

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function colorFor(s) {
  return s >= 70 ? "#059669" : s >= 40 ? "#d97706" : "#dc2626";
}
function tintFor(s) {
  return s >= 70 ? "#d1fae5" : s >= 40 ? "#fef3c7" : "#fee2e2";
}
function fmtDate(iso) {
  if (!iso) return "";
  try { return "Analyzed " + new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
  catch { return ""; }
}

function renderCatHTML(c) {
  const s = Math.max(0, Math.min(100, parseInt(c.score, 10) || 0));
  return `<div class="cat">
  <div class="cat__top"><span class="cat__name">${esc(c.name)}</span><span class="cat__score" style="color:${colorFor(s)};background:${tintFor(s)}">${s}/100</span></div>
  <div class="bar"><i style="width:${s}%;background:${colorFor(s)}"></i></div>
  <div class="cat__finding">${esc(c.finding)}</div>
  <div class="cat__fix"><b>Fix:</b> ${esc(c.fix)}</div>
</div>`;
}

function renderGapHTML(g) {
  return `<div class="gap-card">
  <div class="gap-card__topic">${esc(g.topic)}</div>
  <div class="gap-card__why">${esc(g.why)}</div>
  <div class="gap-card__fix"><b>Add:</b> ${esc(g.fix)}</div>
</div>`;
}

function renderCompareCardHTML(cr, isCompetitor) {
  const s = Math.max(0, Math.min(100, parseInt(cr.score, 10) || 0));
  const href = `${BASE_URL}/report/${esc(cr.slug || "")}/`;
  const label = isCompetitor ? `See ${esc(cr.brand || "this brand")} AI visibility report &rarr;` : `See ${esc(cr.brand || "competitor")} AI visibility report &rarr;`;
  return `<a href="${href}" class="compare-card">
  <div class="compare-card__left">
    <div class="compare-card__ring" style="background:${colorFor(s)}">${s}</div>
    <div>
      <div class="compare-card__brand">${esc(cr.brand || cr.domain)}</div>
      <div class="compare-card__domain">${esc(cr.domain || cr.url || "")}</div>
    </div>
  </div>
  <span class="compare-card__cta">${label}</span>
</a>`;
}

function buildHTML(data, slug) {
  const score = Math.max(0, Math.min(100, parseInt(data.score, 10) || 0));
  const brand = esc(data.brand || data.domain || "This brand");
  const reportUrl = `${BASE_URL}/report/${slug}/`;

  const gaps = (data.gaps || []).slice(0, 3).map(renderGapHTML).join("\n");
  const gapsSectionDisplay = data.gaps && data.gaps.length > 0 ? "block" : "none";
  const gapsCountText = data.gaps && data.gaps.length > 0 ? `${data.gaps.length} identified` : "";

  const cats = data.categories || [];
  const visibleCats = cats.slice(0, 2).map(renderCatHTML).join("\n");
  const lockedCats = cats.slice(2).map(renderCatHTML).join("\n");

  const topFix = (data.top_fixes || [])[0]
    ? `<div class="fix-item"><span class="fix-num">1</span><span class="fix-text">${esc(data.top_fixes[0])}</span></div>`
    : "";

  const compReports = data.competitor_reports || [];
  const compareHTML = compReports.length > 0
    ? `<div class="compare-section">
  <div class="section-head">
    <h2>${brand} vs Competitors &mdash; AI Visibility</h2>
    <span class="section-tag tag-purple">${compReports.length} competitor${compReports.length > 1 ? "s" : ""} analyzed</span>
  </div>
  <div class="compare-grid">${compReports.map(cr => renderCompareCardHTML(cr, false)).join("\n")}</div>
</div>` : "";

  const comparedTo = data.compared_to || [];
  const comparedToHTML = comparedTo.length > 0
    ? `<div class="compare-section">
  <div class="section-head">
    <h2>Also in this comparison</h2>
    <span class="section-tag tag-purple">Related report</span>
  </div>
  <div class="compare-grid">${comparedTo.map(cr => renderCompareCardHTML(cr, true)).join("\n")}</div>
</div>` : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<script async src="https://www.googletagmanager.com/gtag/js?id=G-S6X8Q5EY8E"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-S6X8Q5EY8E');</script>
<meta charset="UTF-8">
<link rel="icon" type="image/png" href="/logo.png">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${brand} AI Search Visibility Report | Jeevan AI</title>
<meta name="description" content="${esc(data.verdict || "")} Full AI search visibility report by Jeevan AI.">
<meta property="og:title" content="${brand} AI Search Visibility Report | Jeevan AI">
<meta property="og:description" content="${esc(data.verdict || "")} See how AI engines like ChatGPT, Gemini, and Perplexity currently cite ${brand}.">
<meta property="og:type" content="article">
<meta property="og:url" content="${reportUrl}">
<meta property="og:site_name" content="Jeevan AI">
<link rel="canonical" href="${reportUrl}">
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "${brand} AI Search Visibility Report",
  "description": "${esc(data.verdict || "AI visibility report for " + (data.brand || ""))}",
  "url": "${reportUrl}",
  "publisher": {"@type": "Organization", "name": "Jeevan AI", "url": "https://jeevanai.co.in"},
  "datePublished": "${data.analyzedAt || new Date().toISOString()}",
  "about": {"@type": "Organization", "name": "${brand}", "url": "${esc(data.url || "")}"}
}
</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=DM+Serif+Display&display=swap" rel="stylesheet">
<style>
:root{--accent:#6366f1;--accent-dim:rgba(99,102,241,0.1);--text:#111827;--muted:#6b7280;--bg:#fafafa;--card:#fff;--border:#e5e7eb;--good:#059669;--warn:#d97706;--bad:#dc2626;--font-sans:'DM Sans',system-ui,sans-serif;--font-serif:'DM Serif Display',Georgia,serif;--max-w:800px}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{background:var(--bg);color:var(--text);font-family:var(--font-sans);-webkit-font-smoothing:antialiased;line-height:1.6}
a{color:inherit;text-decoration:none}
.nav{position:sticky;top:0;z-index:100;background:rgba(250,250,250,0.95);backdrop-filter:blur(16px);border-bottom:1px solid var(--border);padding:0 24px}
.nav__inner{max-width:var(--max-w);margin:0 auto;display:flex;align-items:center;justify-content:space-between;height:64px}
.nav__logo{display:flex;align-items:center;gap:10px;font-weight:700;font-size:1.05rem}
.nav__cta{padding:8px 18px;border-radius:8px;background:var(--accent);color:#fff;font-size:0.875rem;font-weight:600}
.report-wrap{max-width:var(--max-w);margin:0 auto;padding:36px 24px 80px}
.report-header{background:linear-gradient(135deg,#0f172a 0%,#1e1b4b 50%,#1e3a8a 100%);border-radius:16px;padding:32px;margin-bottom:20px;color:#fff}
.report-header__top-row{display:flex;align-items:center;gap:12px;margin-bottom:20px;flex-wrap:wrap}
.report-badge{font-size:0.7rem;font-weight:700;letter-spacing:0.09em;text-transform:uppercase;background:rgba(165,180,252,0.15);border:1px solid rgba(165,180,252,0.3);padding:4px 12px;border-radius:100px;color:#a5b4fc}
.brand-domain-link{font-size:0.85rem;color:rgba(165,180,252,0.85);text-decoration:underline;text-underline-offset:3px}
.report-header__score-row{display:flex;align-items:flex-start;gap:24px;flex-wrap:wrap}
.score-ring{flex-shrink:0;width:80px;height:80px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:1.7rem;font-weight:700;color:#fff}
.report-header__score-label{font-size:0.68rem;font-weight:700;letter-spacing:0.09em;text-transform:uppercase;color:rgba(165,180,252,0.7);margin-bottom:4px}
.report-header__verdict{font-family:var(--font-serif);font-size:1.2rem;color:#fff;line-height:1.4;margin-bottom:6px}
.report-header__date{font-size:0.78rem;color:rgba(255,255,255,0.4)}
.ai-summary-block{background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.12);border-radius:12px;padding:18px 20px;margin-top:20px}
.ai-summary-label{font-size:0.68rem;font-weight:700;letter-spacing:0.09em;text-transform:uppercase;color:#a5b4fc;margin-bottom:8px}
.ai-summary-text{font-size:0.92rem;color:rgba(255,255,255,0.82);line-height:1.65}
.gaps-section{margin-bottom:20px}
.section-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
.section-head h2{font-family:var(--font-serif);font-size:1.1rem;color:var(--text)}
.section-tag{font-size:0.7rem;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;padding:3px 9px;border-radius:100px}
.tag-red{background:#fee2e2;color:#991b1b}
.tag-purple{background:#ede9fe;color:#5b21b6}
.gap-card{background:var(--card);border:1px solid var(--border);border-left:3px solid var(--bad);border-radius:10px;padding:16px 18px;margin-bottom:10px}
.gap-card__topic{font-weight:600;font-size:0.9rem;color:var(--text);margin-bottom:4px}
.gap-card__why{font-size:0.84rem;color:var(--muted);line-height:1.5;margin-bottom:6px}
.gap-card__fix{font-size:0.84rem;color:var(--text);line-height:1.5}
.gap-card__fix b{color:var(--accent)}
.jeevanai-block{background:linear-gradient(135deg,#312e81 0%,#4338ca 100%);border-radius:14px;padding:24px 26px;margin-bottom:20px;position:relative;overflow:hidden}
.jeevanai-block::before{content:"";position:absolute;top:-30px;right:-30px;width:120px;height:120px;border-radius:50%;background:rgba(255,255,255,0.05)}
.jeevanai-label{font-size:0.68rem;font-weight:700;letter-spacing:0.09em;text-transform:uppercase;color:#a5b4fc;margin-bottom:8px}
.jeevanai-title{font-family:var(--font-serif);font-size:1.1rem;color:#fff;margin-bottom:10px}
.jeevanai-text{font-size:0.9rem;color:rgba(255,255,255,0.82);line-height:1.65;margin-bottom:18px}
.btn-white{display:inline-block;padding:10px 22px;border-radius:9px;background:#fff;color:#4338ca;font-weight:700;font-size:0.88rem}
.btn-primary{display:inline-block;padding:11px 24px;border-radius:9px;background:var(--accent);color:#fff;font-weight:700;font-size:0.88rem}
.cats{display:flex;flex-direction:column;gap:10px}
.cat{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:18px 20px}
.cat__top{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
.cat__name{font-weight:600;font-size:0.9rem}
.cat__score{font-size:0.8rem;font-weight:700;padding:2px 8px;border-radius:6px}
.bar{height:5px;background:#f3f4f6;border-radius:3px;margin-bottom:10px;overflow:hidden}
.bar i{display:block;height:100%;border-radius:3px}
.cat__finding{font-size:0.85rem;color:var(--muted);margin-bottom:5px;line-height:1.5}
.cat__fix{font-size:0.85rem;color:var(--text);line-height:1.5}
.cat__fix b{color:var(--accent)}
.lock-section{position:relative;margin-bottom:20px}
.lock-blur{filter:blur(5px);pointer-events:none;user-select:none;opacity:0.55}
.lock-overlay{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;z-index:2;background:radial-gradient(ellipse at center,rgba(250,250,250,0.97) 20%,rgba(250,250,250,0.88) 100%);border-radius:12px;padding:24px;text-align:center}
.lock-title{font-family:var(--font-serif);font-size:1.05rem;color:var(--text)}
.lock-sub{font-size:0.84rem;color:var(--muted);max-width:360px;line-height:1.5}
.fix-item{display:flex;align-items:flex-start;gap:12px;padding:14px 16px;background:var(--card);border:1px solid var(--border);border-radius:10px;margin-bottom:8px}
.fix-num{flex-shrink:0;width:24px;height:24px;border-radius:6px;background:var(--accent-dim);color:var(--accent);font-size:0.78rem;font-weight:700;display:flex;align-items:center;justify-content:center}
.fix-text{font-size:0.87rem;color:var(--text);line-height:1.55}
.compare-section{margin-bottom:20px}
.compare-grid{display:flex;flex-direction:column;gap:10px}
.compare-card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px 18px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.compare-card:hover{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent-dim)}
.compare-card__left{display:flex;align-items:center;gap:12px}
.compare-card__ring{flex-shrink:0;width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:1rem;font-weight:700;color:#fff}
.compare-card__brand{font-weight:600;font-size:0.9rem;color:var(--text)}
.compare-card__domain{font-size:0.78rem;color:var(--muted)}
.compare-card__cta{font-size:0.82rem;font-weight:600;color:var(--accent);white-space:nowrap}
.share-bar{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px 20px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:20px}
.share-bar__text{font-weight:600;font-size:0.9rem}
.share-bar__sub{font-size:0.78rem;color:var(--muted)}
.btn-copy{padding:9px 16px;border-radius:8px;background:var(--accent-dim);color:var(--accent);font-weight:600;font-size:0.83rem;border:none;cursor:pointer;white-space:nowrap;font-family:var(--font-sans)}
.btn-copy.copied{background:#dcfce7;color:#059669}
.footer-simple{text-align:center;padding:24px;font-size:0.8rem;color:var(--muted);border-top:1px solid var(--border)}
@media(max-width:600px){.report-header{padding:22px}.report-header__score-row{gap:16px}.score-ring{width:64px;height:64px;font-size:1.4rem}}
</style>
</head>
<body>

<nav class="nav">
  <div class="nav__inner">
    <a href="/index.html" class="nav__logo">
      <img src="/logo.png" alt="Jeevan AI" style="width:36px;height:36px;border-radius:8px;object-fit:cover"><span>Jeevan AI</span>
    </a>
    <a href="https://dashboard.jeevanai.co.in/auth/login" class="nav__cta">Sign In</a>
  </div>
</nav>

<div class="report-wrap">

  <div class="report-header">
    <div class="report-header__top-row">
      <span class="report-badge">AI Search Visibility Report</span>
      <a href="${esc(data.url || "#")}" class="brand-domain-link" target="_blank" rel="noopener">${esc(data.domain || data.url || "")}</a>
    </div>
    <div class="report-header__score-row">
      <div class="score-ring" style="background:${colorFor(score)}">${score}</div>
      <div>
        <div class="report-header__score-label">Overall AI Visibility Score</div>
        <div class="report-header__verdict">${esc(data.verdict || "")}</div>
        <div class="report-header__date">${fmtDate(data.analyzedAt)}</div>
      </div>
    </div>
    <div class="ai-summary-block">
      <div class="ai-summary-label">What AI engines see today</div>
      <p class="ai-summary-text">${esc(data.ai_summary || "")}</p>
    </div>
  </div>

  <div class="gaps-section" style="display:${gapsSectionDisplay}">
    <div class="section-head">
      <h2>Content Gaps Costing Citations</h2>
      <span class="section-tag tag-red">${gapsCountText}</span>
    </div>
    ${gaps}
  </div>

  <div class="jeevanai-block">
    <div class="jeevanai-label">Where Jeevan AI comes in</div>
    <h3 class="jeevanai-title">How Jeevan AI would help ${brand}</h3>
    <p class="jeevanai-text">${esc(data.jeevanai_value || `Jeevan AI tracks how often AI engines cite ${data.brand || data.domain || "this brand"} across ChatGPT, Gemini, and Perplexity, scores it against competitors on each buying factor, and surfaces content gaps before they cost leads.`)}</p>
    <a href="https://dashboard.jeevanai.co.in/auth/login" class="btn-white">Start free brand scan</a>
  </div>

  <div style="margin-bottom:20px">
    <div class="section-head">
      <h2>Factor Breakdown</h2>
      <span class="section-tag tag-purple">2 of ${cats.length} shown</span>
    </div>
    <div class="cats">${visibleCats}</div>
  </div>

  ${lockedCats ? `<div class="lock-section">
    <div class="lock-blur cats">${lockedCats}</div>
    <div class="lock-overlay">
      <div class="lock-title">${cats.length - 2} more scored factors in the full report</div>
      <div class="lock-sub">Sign up free to see all ${cats.length} factors, a competitor comparison, and a content plan for your brand.</div>
      <a href="https://dashboard.jeevanai.co.in/auth/login" class="btn-primary">See full report free</a>
    </div>
  </div>` : ""}

  ${topFix ? `<div style="margin-bottom:20px">
    <div class="section-head"><h2>Top Priority Fix</h2></div>
    ${topFix}
  </div>` : ""}

  ${compareHTML}
  ${comparedToHTML}

  <div class="share-bar">
    <div>
      <div class="share-bar__text">Share this report</div>
      <div class="share-bar__sub">Anyone with this link can view it</div>
    </div>
    <button class="btn-copy" id="copyBtn" onclick="copyLink()">Copy link</button>
  </div>

  <div style="text-align:center;padding:4px 0 12px">
    <a href="/tools/ai-readiness-analyzer.html" style="font-size:0.85rem;color:var(--accent);font-weight:600">Analyze a different page &rarr;</a>
  </div>

</div>

<div class="footer-simple">
  <a href="/index.html" style="color:inherit">Jeevan AI</a> &middot; AI visibility platform &middot;
  <a href="/tools/ai-readiness-analyzer.html" style="color:var(--accent)">Run your own analysis</a>
</div>

<script>
function copyLink(){
  var btn=document.getElementById('copyBtn');
  navigator.clipboard.writeText(window.location.href).then(function(){
    btn.textContent='Copied!';btn.classList.add('copied');
    setTimeout(function(){btn.textContent='Copy link';btn.classList.remove('copied');},2200);
  }).catch(function(){
    var inp=document.createElement('input');inp.value=window.location.href;
    document.body.appendChild(inp);inp.select();document.execCommand('copy');document.body.removeChild(inp);
    btn.textContent='Copied!';setTimeout(function(){btn.textContent='Copy link';},2200);
  });
}
</script>
</body>
</html>`;
}

// ── Main handler ────────────────────────────────────────────────────────────

export async function handler(event, context) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors(), body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  if (!GITHUB_PAT) return json(500, { error: "GITHUB_PAT not configured" });

  let brand;
  try {
    const body = JSON.parse(event.body || "{}");
    brand = (body.brand || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  if (!brand) return json(400, { error: "Missing brand parameter" });

  // 1. Use report data from body if provided, else read from Netlify Blobs
  let data;
  try {
    const body2 = JSON.parse(event.body || "{}");
    if (body2.report && typeof body2.report === "object") {
      data = body2.report;
    } else {
      const store = getStore({ name: "audit-reports", context });
      data = await store.get(brand, { type: "json" });
      if (!data) return json(404, { error: `No report found for brand: ${brand}. Run a scan first.` });
    }
  } catch (err) {
    return json(500, { error: `Failed to read report: ${err.message}` });
  }

  // 2. Render static HTML
  const html = buildHTML(data, brand);
  const repoPath = `report/${brand}/index.html`;

  // 3. Push to GitHub
  try {
    const existing = await ghGet(repoPath);
    await ghPut(
      repoPath,
      html,
      `feat: publish AI visibility report for ${brand}`,
      existing ? existing.sha : undefined
    );
  } catch (err) {
    return json(500, { error: `GitHub push failed: ${err.message}` });
  }

  // 4. Update sitemap.xml
  try {
    await updateSitemap(brand, data.analyzedAt);
  } catch {
    // sitemap update failure is non-fatal
  }

  const reportUrl = `${BASE_URL}/report/${brand}/`;
  return json(200, { ok: true, url: reportUrl, brand, score: data.score });
}
