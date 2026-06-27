#!/usr/bin/env node
/**
 * generate-sitemap.js
 * Scans all HTML files in the repo, extracts canonical URLs + dates from
 * JSON-LD, and writes a fresh sitemap.xml.
 *
 * Run: node scripts/generate-sitemap.js
 * Called automatically by .github/workflows/generate-sitemap.yml on every push.
 */

const fs   = require("fs");
const path = require("path");

const SITE_ROOT = path.resolve(__dirname, "..");
const OUT_FILE  = path.join(SITE_ROOT, "sitemap.xml");

// Directories and files to skip entirely
const SKIP_DIRS  = new Set([".git", ".github", "node_modules", "netlify", "scripts"]);
const SKIP_FILES = new Set(["404.html"]);

// ── Priority / changefreq rules (matched against the canonical URL path) ──────
function getMeta(url) {
  const p = new URL(url).pathname;
  if (p === "/" || p === "")               return { priority: "1.0", changefreq: "weekly"  };
  if (p === "/blog-index" || p === "/blog") return { priority: "0.9", changefreq: "weekly"  };
  if (p.startsWith("/ai-visibility-tool")) return { priority: "0.9", changefreq: "weekly"  };
  if (p.startsWith("/blog/"))              return { priority: "0.7", changefreq: "monthly" };
  if (p.startsWith("/compare/"))           return { priority: "0.8", changefreq: "monthly" };
  if (p.startsWith("/alternatives/"))      return { priority: "0.8", changefreq: "monthly" };
  if (p.startsWith("/tools/"))             return { priority: "0.8", changefreq: "monthly" };
  if (p.startsWith("/glossary/"))          return { priority: "0.7", changefreq: "monthly" };
  if (p.startsWith("/use-cases/"))         return { priority: "0.7", changefreq: "monthly" };
  if (p.startsWith("/markets/"))           return { priority: "0.7", changefreq: "monthly" };
  return                                          { priority: "0.7", changefreq: "monthly" };
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function extractCanonical(html) {
  const m = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)
         || html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i);
  return m ? m[1].trim() : null;
}

function extractDate(html) {
  // Prefer dateModified from JSON-LD, fall back to datePublished
  const mod = html.match(/"dateModified"\s*:\s*"(\d{4}-\d{2}-\d{2})"/);
  if (mod) return mod[1];
  const pub = html.match(/"datePublished"\s*:\s*"(\d{4}-\d{2}-\d{2})"/);
  if (pub) return pub[1];
  return new Date().toISOString().slice(0, 10);
}

function walkHtml(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkHtml(full));
    } else if (entry.name.endsWith(".html") && !SKIP_FILES.has(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

// ── Main ───────────────────────────────────────────────────────────────────────
const htmlFiles = walkHtml(SITE_ROOT);
const seen      = new Set();
const entries   = [];

for (const file of htmlFiles) {
  const html      = fs.readFileSync(file, "utf8");
  const canonical = extractCanonical(html);

  if (!canonical) continue;
  if (!canonical.startsWith("https://jeevanai.co.in")) continue;
  if (seen.has(canonical)) continue;
  seen.add(canonical);

  const lastmod              = extractDate(html);
  const { priority, changefreq } = getMeta(canonical);
  entries.push({ canonical, lastmod, priority, changefreq });
}

// Sort: highest priority first, then newest date first
entries.sort((a, b) => {
  const pd = parseFloat(b.priority) - parseFloat(a.priority);
  if (pd !== 0) return pd;
  return b.lastmod.localeCompare(a.lastmod);
});

const urlNodes = entries.map(e =>
  `  <url>\n    <loc>${e.canonical}</loc>\n    <lastmod>${e.lastmod}</lastmod>\n    <changefreq>${e.changefreq}</changefreq>\n    <priority>${e.priority}</priority>\n  </url>`
).join("\n");

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlNodes}
</urlset>
`;

fs.writeFileSync(OUT_FILE, xml, "utf8");
console.log(`sitemap.xml regenerated: ${entries.length} URLs`);
entries.forEach(e => console.log(`  ${e.priority}  ${e.canonical}`));
