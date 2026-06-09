#!/usr/bin/env node
/**
 * generate-feed.js
 * Scans all blog HTML files, extracts content, and generates feed.xml (RSS 2.0).
 * Medium can subscribe to this feed and auto-import every new post.
 *
 * Run: node scripts/generate-feed.js
 * Called automatically by .github/workflows/generate-sitemap.yml on every push.
 */

const fs   = require("fs");
const path = require("path");

const SITE_ROOT  = path.resolve(__dirname, "..");
const OUT_FILE   = path.join(SITE_ROOT, "feed.xml");
const SITE_URL   = "https://jeevanai.co.in";
const SITE_TITLE = "Jeevan AI Blog — AI Visibility & GEO Strategies";
const SITE_DESC  = "Actionable strategies to get your brand cited in ChatGPT, Perplexity, Gemini, and Google AI Mode.";

// ── Helpers ────────────────────────────────────────────────────────────────────
function extractCanonical(html) {
  const m = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)
         || html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i);
  return m ? m[1].trim() : null;
}

function extractTitle(html) {
  // og:title is cleanest, fall back to <title> tag minus site name
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
          || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
  if (og) return og[1].trim();
  const t = html.match(/<title>([^<]+)<\/title>/i);
  if (t) return t[1].replace(/\s*\|\s*Jeevan AI\s*$/i, "").trim();
  return "";
}

function extractDescription(html) {
  const m = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
         || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
  return m ? m[1].trim() : "";
}

function extractDate(html) {
  const mod = html.match(/"dateModified"\s*:\s*"(\d{4}-\d{2}-\d{2})"/);
  if (mod) return mod[1];
  const pub = html.match(/"datePublished"\s*:\s*"(\d{4}-\d{2}-\d{2})"/);
  if (pub) return pub[1];
  return new Date().toISOString().slice(0, 10);
}

function extractArticleContent(html) {
  // Pull the <main> block which contains the article
  const main = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  let body = main ? main[1] : "";

  if (!body) {
    const article = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
    body = article ? article[1] : "";
  }

  if (!body) return "";

  // Strip noise: scripts, styles, nav, aside, CTA strips, related posts
  body = body
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<aside[\s\S]*?<\/aside>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    // Remove CTA strips (divs with class containing "cta")
    .replace(/<div[^>]*class="[^"]*cta[^"]*"[^>]*>[\s\S]*?<\/div>/gi, "")
    // Remove related-posts section
    .replace(/<section[^>]*class="[^"]*related[^"]*"[^>]*>[\s\S]*?<\/section>/gi, "")
    .replace(/<div[^>]*class="[^"]*related[^"]*"[^>]*>[\s\S]*?<\/div>/gi, "");

  // Make relative links absolute
  body = body.replace(/href=["']\/(blog|compare|glossary|use-cases|markets)([^"']*)['"]/gi,
    (_, seg, rest) => `href="${SITE_URL}/${seg}${rest}"`);

  return body.trim();
}

function escapeXml(str) {
  return str
    .replace(/&/g,  "&amp;")
    .replace(/</g,  "&lt;")
    .replace(/>/g,  "&gt;")
    .replace(/"/g,  "&quot;")
    .replace(/'/g,  "&apos;");
}

function toRFC822(dateStr) {
  return new Date(dateStr + "T00:00:00Z").toUTCString();
}

// ── Scan blog/ directory only ──────────────────────────────────────────────────
const blogDir   = path.join(SITE_ROOT, "blog");
const htmlFiles = fs.readdirSync(blogDir)
  .filter(f => f.endsWith(".html"))
  .map(f => path.join(blogDir, f));

const items = [];

for (const file of htmlFiles) {
  const html      = fs.readFileSync(file, "utf8");
  const canonical = extractCanonical(html);

  if (!canonical || !canonical.startsWith(SITE_URL)) continue;
  if (!canonical.includes("/blog/")) continue;

  const title       = extractTitle(html);
  const description = extractDescription(html);
  const date        = extractDate(html);
  const content     = extractArticleContent(html);

  if (!title) continue;

  items.push({ canonical, title, description, date, content });
}

// Newest first
items.sort((a, b) => b.date.localeCompare(a.date));

// ── Build RSS XML ──────────────────────────────────────────────────────────────
const itemsXml = items.map(item => `    <item>
      <title>${escapeXml(item.title)}</title>
      <link>${item.canonical}</link>
      <guid isPermaLink="true">${item.canonical}</guid>
      <description>${escapeXml(item.description)}</description>
      <pubDate>${toRFC822(item.date)}</pubDate>
      <content:encoded><![CDATA[${item.content}]]></content:encoded>
    </item>`).join("\n\n");

const feed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:atom="http://www.w3.org/2005/Atom"
  xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>${escapeXml(SITE_TITLE)}</title>
    <link>${SITE_URL}/blog</link>
    <description>${escapeXml(SITE_DESC)}</description>
    <language>en-us</language>
    <atom:link href="${SITE_URL}/feed.xml" rel="self" type="application/rss+xml"/>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <image>
      <url>${SITE_URL}/logo.png</url>
      <title>${escapeXml(SITE_TITLE)}</title>
      <link>${SITE_URL}/blog</link>
    </image>

${itemsXml}

  </channel>
</rss>
`;

fs.writeFileSync(OUT_FILE, feed, "utf8");
console.log(`feed.xml generated: ${items.length} posts`);
items.forEach(i => console.log(`  ${i.date}  ${i.title}`));
