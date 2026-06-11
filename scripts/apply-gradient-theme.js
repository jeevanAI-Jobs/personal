#!/usr/bin/env node
/**
 * apply-gradient-theme.js
 * Applies the "Bold Gradient SaaS" visual theme across all HTML files.
 *
 * Changes:
 *  - Accent: old blue #4f8ef7 → indigo #6366f1
 *  - Hero: deep blue-to-purple gradient on landing pages
 *  - Article hero: same gradient on blog pages
 *  - Cards: box-shadow for depth
 *  - Stats / testimonial / CTA-final: branded section backgrounds
 *  - Blog prose: larger text, better line-height, blockquote styling
 *
 * Run: node scripts/apply-gradient-theme.js
 */

const fs   = require("fs");
const path = require("path");

const SITE_ROOT = path.resolve(__dirname, "..");

const SCAN_DIRS = [
  SITE_ROOT,
  path.join(SITE_ROOT, "blog"),
  path.join(SITE_ROOT, "compare"),
  path.join(SITE_ROOT, "glossary"),
  path.join(SITE_ROOT, "markets"),
  path.join(SITE_ROOT, "use-cases"),
];

function isBlogPage(f) {
  return f.includes(path.sep + "blog" + path.sep) && f.endsWith(".html");
}

// ── CSS injected into EVERY page ──────────────────────────────────────────────
const CSS_ALL = `
/* ═══════════════════════════════════════════════
   GRADIENT THEME INJECTION
   ═══════════════════════════════════════════════ */

/* Card depth */
.step, .plan, .preview-card, .factor-item, .scan-card,
.post-card, .blog-card, .card, .feature-card, .pricing-card {
  box-shadow: 0 1px 3px 0 rgba(0,0,0,0.08), 0 1px 2px -1px rgba(0,0,0,0.05);
}
.step:hover, .preview-card:hover, .post-card:hover, .blog-card:hover {
  box-shadow: 0 4px 8px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.06);
  transform: translateY(-2px);
  transition: box-shadow 0.2s, transform 0.2s;
}

/* Primary button gradient */
.btn-primary {
  background: linear-gradient(135deg, #6366f1 0%, #7c3aed 100%) !important;
  box-shadow: 0 2px 6px rgba(99,102,241,0.38);
}
.btn-primary:hover {
  opacity: 0.93;
  box-shadow: 0 4px 14px rgba(99,102,241,0.42) !important;
}

/* ── LANDING PAGE HERO GRADIENT ── */
.hero {
  background: linear-gradient(135deg, #1e3a8a 0%, #4338ca 45%, #7c3aed 100%) !important;
  overflow: hidden;
  position: relative;
}
.hero::before {
  background: radial-gradient(ellipse at 20% 60%, rgba(255,255,255,0.07) 0%, transparent 55%) !important;
}
.hero h1                 { color: #ffffff !important; }
.hero .hero__sub         { color: rgba(255,255,255,0.87) !important; }
.hero .hero__badge {
  background:   rgba(255,255,255,0.13) !important;
  border-color: rgba(255,255,255,0.22) !important;
  color: #e0e7ff !important;
}
.hero .hero__badge-dot   { background: #a5b4fc !important; }
.hero .hero__note        { color: rgba(255,255,255,0.52) !important; }
.hero .platforms__label  { color: rgba(255,255,255,0.6) !important; }
.hero .platform-chip {
  background:   rgba(255,255,255,0.1) !important;
  border-color: rgba(255,255,255,0.18) !important;
  color: rgba(255,255,255,0.82) !important;
}
/* Hero primary CTA: white button on gradient */
.hero .btn-primary {
  background: #ffffff !important;
  color: #4338ca !important;
  box-shadow: 0 4px 16px rgba(0,0,0,0.22) !important;
}
.hero .btn-primary:hover {
  background: #eef2ff !important;
  box-shadow: 0 6px 22px rgba(0,0,0,0.28) !important;
}
/* Hero outline CTA */
.hero .btn-outline {
  border-color: rgba(255,255,255,0.35) !important;
  color: #ffffff !important;
  background: rgba(255,255,255,0.07) !important;
}
.hero .btn-outline:hover {
  border-color: rgba(255,255,255,0.58) !important;
  background: rgba(255,255,255,0.13) !important;
}

/* ── SECTION BACKGROUNDS (visual rhythm) ── */
/* Stats bar: soft indigo wash */
.stats {
  background: linear-gradient(135deg, #eff6ff 0%, #eef2ff 100%) !important;
  border-top: 1px solid #e0e7ff;
  border-bottom: 1px solid #e0e7ff;
}
.stat { background: transparent !important; }

/* Testimonial: soft purple wash */
.testimonial-strip {
  background: linear-gradient(135deg, #f5f3ff 0%, #eff6ff 100%) !important;
  border-top: 1px solid #e0e7ff !important;
  border-bottom: 1px solid #e0e7ff !important;
}

/* Bottom CTA: matches hero gradient */
.cta-final {
  background: linear-gradient(135deg, #1e3a8a 0%, #4338ca 45%, #7c3aed 100%) !important;
}
.cta-final * { color: #ffffff !important; }
.cta-final .btn-primary {
  background: #ffffff !important;
  color: #4338ca !important;
  box-shadow: 0 4px 14px rgba(0,0,0,0.2) !important;
}
.cta-final .btn-primary:hover { background: #eef2ff !important; }
.cta-final .btn-outline {
  border-color: rgba(255,255,255,0.38) !important;
  color: #ffffff !important;
  background: rgba(255,255,255,0.07) !important;
}
`;

// ── Extra CSS injected into BLOG pages only ───────────────────────────────────
const CSS_BLOG = `
/* ── BLOG ARTICLE HERO GRADIENT ── */
.article-hero {
  background: linear-gradient(135deg, #1e3a8a 0%, #4338ca 45%, #7c3aed 100%) !important;
  padding: 64px 24px 72px !important;
}
.article-hero__title,
.article-hero__subtitle,
.article-hero__breadcrumb,
.article-hero__breadcrumb a,
.article-hero__breadcrumb span {
  color: #ffffff !important;
}
.article-hero__breadcrumb a:hover    { opacity: 0.75; }
.article-hero__subtitle              { color: rgba(255,255,255,0.84) !important; }
.article-hero__meta,
.article-hero__meta span,
.article-hero__meta time            { color: rgba(255,255,255,0.58) !important; }
.article-hero__breadcrumb .sep      { color: rgba(255,255,255,0.35) !important; }

/* ── BLOG PROSE TYPOGRAPHY ── */
.article-prose, .article-section, .article-intro {
  font-size: 1.1rem;
  line-height: 1.85;
  color: #374151;
}
.article-section h2 {
  font-size: 1.5rem;
  color: #111827;
  margin-top: 2.5rem;
  margin-bottom: 0.85rem;
  padding-bottom: 0.5rem;
  border-bottom: 2px solid #e5e7eb;
}
.article-section h3 {
  font-size: 1.2rem;
  color: #1f2937;
  margin-top: 1.75rem;
  margin-bottom: 0.6rem;
}
.article-section p,
.article-intro p {
  margin-bottom: 1.3rem;
}
.article-section blockquote,
.article-intro blockquote {
  border-left: 4px solid #6366f1;
  background: #f5f3ff;
  padding: 0.8rem 1.25rem;
  border-radius: 0 8px 8px 0;
  color: #4b5563;
  font-style: italic;
  margin: 1.5rem 0;
}
.article-section table {
  box-shadow: 0 1px 3px rgba(0,0,0,0.08);
  border-radius: 8px;
  overflow: hidden;
}
.article-section th {
  background: #eef2ff;
  color: #4338ca;
}
.article-divider {
  border-color: #e5e7eb;
  margin: 2.5rem 0;
}
/* Related posts cards */
.related-posts__card, .related-card {
  box-shadow: 0 1px 3px rgba(0,0,0,0.07);
  transition: box-shadow 0.2s, transform 0.2s;
}
.related-posts__card:hover, .related-card:hover {
  box-shadow: 0 4px 8px rgba(0,0,0,0.1);
  transform: translateY(-1px);
}
`;

// ── Value replacements (CSS variables + hardcoded accent colours) ─────────────
const REPLACEMENTS = [
  // Background (was #f6f6fb from previous light theme, go to pure white)
  [/--bg:\s*#f6f6fb/g,                     "--bg: #ffffff"],
  // Card hover
  [/--bg-card-hover:\s*#ededf6/g,          "--bg-card-hover: #f9fafb"],
  // Border: rgba → solid colour
  [/--border:\s*rgba\(0,0,0,0\.08\)/g,     "--border: #e5e7eb"],
  // Border hover
  [/--border-hover:\s*rgba\(79,142,247,0\.4\)/g, "--border-hover: rgba(99,102,241,0.45)"],
  // Accent colour: old blue → indigo
  [/--accent:\s*#4f8ef7/g,                 "--accent: #6366f1"],
  // Accent dim
  [/--accent-dim:\s*rgba\(79,142,247,0\.12\)/g, "--accent-dim: rgba(99,102,241,0.1)"],
  // Accent glow
  [/--accent-glow:\s*rgba\(79,142,247,0\.08\)/g,"--accent-glow: rgba(99,102,241,0.06)"],
  // Body text
  [/--text:\s*#1a1a2e/g,                   "--text: #111827"],
  // Dim text
  [/--text-dim:\s*#4a4a6a/g,               "--text-dim: #6b7280"],
  // Muted text
  [/--text-muted:\s*#7a7a9a/g,             "--text-muted: #9ca3af"],
  // Tag bg
  [/--tag-bg:\s*rgba\(79,142,247,0\.1\)/g, "--tag-bg: rgba(99,102,241,0.1)"],
  // Tag text
  [/--tag-text:\s*#2060d0/g,               "--tag-text: #4f46e5"],
  // --white (heading colour variable)
  [/--white:\s*#1a1a2e/g,                  "--white: #111827"],

  // Nav frosted glass
  [/background:\s*rgba\(246,246,251,0\.95\)/g, "background: rgba(255,255,255,0.95)"],

  // Replace ALL remaining old-blue rgba values with indigo equivalents
  [/rgba\(79,142,247,0\.5\)/g,             "rgba(99,102,241,0.5)"],
  [/rgba\(79,142,247,0\.4\)/g,             "rgba(99,102,241,0.4)"],
  [/rgba\(79,142,247,0\.3\)/g,             "rgba(99,102,241,0.3)"],
  [/rgba\(79,142,247,0\.13\)/g,            "rgba(99,102,241,0.12)"],
  [/rgba\(79,142,247,0\.12\)/g,            "rgba(99,102,241,0.1)"],
  [/rgba\(79,142,247,0\.1\)/g,             "rgba(99,102,241,0.1)"],
  [/rgba\(79,142,247,0\.08\)/g,            "rgba(99,102,241,0.07)"],
  // Catch all remaining 79,142,247 references (inline styles etc.)
  [/79,142,247/g,                          "99,102,241"],

  // Hard-coded hex
  [/#4f8ef7/g,                             "#6366f1"],
  [/#7aabff/g,                             "#818cf8"],
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function collectHtml(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith(".html"))
    .map(f => path.join(dir, f));
}

const INJECT_MARKER = "GRADIENT THEME INJECTION";

// ── Main ──────────────────────────────────────────────────────────────────────
const allFiles = SCAN_DIRS.flatMap(collectHtml);
let changed = 0;

for (const file of allFiles) {
  let html = fs.readFileSync(file, "utf8");

  // Skip if already processed
  if (html.includes(INJECT_MARKER)) {
    console.log(`  ○  ${path.relative(SITE_ROOT, file)}  (already done)`);
    continue;
  }

  let modified = html;

  // 1. Apply value replacements
  for (const [pattern, replacement] of REPLACEMENTS) {
    modified = modified.replace(pattern, replacement);
  }

  // 2. Inject CSS before the first </style>
  const cssInject = isBlogPage(file)
    ? CSS_ALL + CSS_BLOG
    : CSS_ALL;

  modified = modified.replace("</style>", cssInject + "\n</style>");

  if (modified !== html) {
    fs.writeFileSync(file, modified, "utf8");
    console.log(`  ✓  ${path.relative(SITE_ROOT, file)}`);
    changed++;
  } else {
    console.log(`  –  ${path.relative(SITE_ROOT, file)}  (no change)`);
  }
}

console.log(`\nDone — ${changed}/${allFiles.length} files updated.`);
