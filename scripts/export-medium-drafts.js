#!/usr/bin/env node
/**
 * export-medium-drafts.js
 * Converts all blog HTML files to clean Markdown suitable for pasting into Medium.
 * Output: medium-drafts/ folder, one .md file per post.
 *
 * Run: node scripts/export-medium-drafts.js
 */

const fs   = require("fs");
const path = require("path");

const SITE_ROOT   = path.resolve(__dirname, "..");
const BLOG_DIR    = path.join(SITE_ROOT, "blog");
const OUT_DIR     = path.join(SITE_ROOT, "medium-drafts");
const SITE_URL    = "https://jeevanai.co.in";

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR);

// ── Helpers ────────────────────────────────────────────────────────────────────
function extractCanonical(html) {
  const m = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)
         || html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i);
  return m ? m[1].trim() : null;
}

function extractTitle(html) {
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

function htmlToMarkdown(html) {
  // 1. Extract just the article body — strip nav, aside, scripts, CTAs, related posts
  let body = "";
  const main = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  if (main) body = main[1];

  if (!body) return "";

  body = body
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<aside[\s\S]*?<\/aside>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    // Remove CTA strips
    .replace(/<div[^>]*class="[^"]*cta[^"]*"[\s\S]*?<\/div>/gi, "")
    // Remove related posts section
    .replace(/<section[^>]*class="[^"]*related[^"]*"[\s\S]*?<\/section>/gi, "")
    .replace(/<div[^>]*class="[^"]*related[^"]*"[\s\S]*?<\/div>/gi, "")
    // Remove breadcrumb
    .replace(/<nav[^>]*class="[^"]*breadcrumb[^"]*"[\s\S]*?<\/nav>/gi, "")
    // Remove tag badges
    .replace(/<span[^>]*class="[^"]*badge[^"]*"[^>]*>[\s\S]*?<\/span>/gi, "")
    // Remove article meta rows (date/readtime spans)
    .replace(/<div[^>]*class="[^"]*article-meta[^"]*"[^>]*>[\s\S]*?<\/div>/gi, "");

  // 2. Convert HTML elements to Markdown
  body = body
    // Headings
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, t) => `# ${strip(t)}\n\n`)
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, t) => `## ${strip(t)}\n\n`)
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, t) => `### ${strip(t)}\n\n`)
    .replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, (_, t) => `#### ${strip(t)}\n\n`)
    // Bold / italic
    .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, (_, t) => `**${strip(t)}**`)
    .replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, (_, t) => `**${strip(t)}**`)
    .replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, (_, t) => `*${strip(t)}*`)
    .replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, (_, t) => `*${strip(t)}*`)
    // Links — make absolute
    .replace(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => {
      const absHref = href.startsWith("/") ? `${SITE_URL}${href}` : href;
      return `[${strip(text)}](${absHref})`;
    })
    // Images
    .replace(/<img[^>]+src=["']([^"']+)["'][^>]*(?:alt=["']([^"']*)["'])?[^>]*\/?>/gi,
      (_, src, alt) => `![${alt || ""}](${src.startsWith("/") ? SITE_URL + src : src})\n\n`)
    // Tables
    .replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, convertTable)
    // Lists
    .replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_, items) =>
      items.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (__, t) => `- ${strip(t)}\n`) + "\n")
    .replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, items) => {
      let n = 0;
      return items.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (__, t) => `${++n}. ${strip(t)}\n`) + "\n";
    })
    // Blockquotes
    .replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, t) =>
      strip(t).split("\n").map(l => `> ${l}`).join("\n") + "\n\n")
    // Code
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, t) => `\`${strip(t)}\``)
    .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, t) => "```\n" + strip(t) + "\n```\n\n")
    // Paragraphs and line breaks
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, t) => {
      const clean = strip(t).trim();
      return clean ? `${clean}\n\n` : "";
    })
    // Divs as paragraph separators
    .replace(/<\/div>/gi, "\n")
    .replace(/<div[^>]*>/gi, "")
    // Strip remaining HTML tags
    .replace(/<[^>]+>/g, "")
    // Decode HTML entities
    .replace(/&amp;/g,  "&")
    .replace(/&lt;/g,   "<")
    .replace(/&gt;/g,   ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g,  "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&mdash;/g, ",")
    .replace(/&ndash;/g, "-")
    .replace(/&rarr;/g,  "->")
    // Clean up excessive blank lines
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return body;
}

function convertTable(_, tableContent) {
  const rows = [];
  const rowMatches = tableContent.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [];
  for (const row of rowMatches) {
    const cells = [];
    const cellMatches = row.match(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi) || [];
    for (const cell of cellMatches) {
      cells.push(strip(cell.replace(/<[^>]+>/g, "")).trim());
    }
    rows.push(cells);
  }
  if (!rows.length) return "";
  let md = "\n";
  md += "| " + rows[0].join(" | ") + " |\n";
  md += "| " + rows[0].map(() => "---").join(" | ") + " |\n";
  for (const row of rows.slice(1)) {
    md += "| " + row.join(" | ") + " |\n";
  }
  return md + "\n";
}

function strip(html) {
  return (html || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g,  "&")
    .replace(/&lt;/g,   "<")
    .replace(/&gt;/g,   ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g,  "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

// ── Process each blog post ─────────────────────────────────────────────────────
const files = fs.readdirSync(BLOG_DIR).filter(f => f.endsWith(".html"));
const index = [];

for (const file of files) {
  const html      = fs.readFileSync(path.join(BLOG_DIR, file), "utf8");
  const canonical = extractCanonical(html);
  const title     = extractTitle(html);
  const desc      = extractDescription(html);
  const date      = extractDate(html);

  if (!canonical || !title) continue;

  const markdown  = htmlToMarkdown(html);
  const slug      = path.basename(file, ".html");

  // Medium draft format: title + canonical note + content
  const draft = `# ${title}

*Originally published at: ${canonical}*

---

${markdown}

---

*This article was originally published on [Jeevan AI](${SITE_URL}) — AI visibility and GEO strategies for B2B SaaS and D2C brands.*
`;

  fs.writeFileSync(path.join(OUT_DIR, `${slug}.md`), draft, "utf8");
  index.push({ slug, title, date, canonical });
  console.log(`  ✓ ${slug}.md`);
}

// Sort index newest first
index.sort((a, b) => b.date.localeCompare(a.date));

// Write an index file
const indexMd = `# Medium Drafts — Jeevan AI Blog
${index.length} posts ready to paste into Medium.

| # | Title | Date | File |
|---|-------|------|------|
${index.map((p, i) => `| ${i+1} | ${p.title} | ${p.date} | \`${p.slug}.md\` |`).join("\n")}

## How to post to Medium
1. Open [medium.com/new-story](https://medium.com/new-story)
2. Open the .md file below
3. Copy everything BELOW the \`---\` divider (skip the canonical line)
4. Paste into Medium editor
5. Add the canonical URL: click \`...\` menu → SEO settings → canonical URL → paste the original URL
6. Add tags: AI, SEO, SaaS, Marketing, Content Strategy
7. Publish
`;

fs.writeFileSync(path.join(OUT_DIR, "README.md"), indexMd, "utf8");
console.log(`\nDone. ${index.length} drafts written to medium-drafts/`);
console.log(`Open medium-drafts/README.md for the posting guide.`);
