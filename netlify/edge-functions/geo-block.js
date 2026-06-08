const ACCESS_CODE = "jeevanai2026";

const BOT_PATTERNS = [
  "googlebot", "bingbot", "yandexbot", "baiduspider",
  "gptbot", "chatgpt-user", "oai-searchbot",
  "claudebot", "anthropic",
  "perplexitybot",
  "google-extended", "google-inspectiontool",
  "facebookexternalhit", "twitterbot", "linkedinbot",
  "slurp", "duckduckbot", "applebot",
  "semrushbot", "ahrefsbot", "mj12bot",
  "bytespider", "petalbot", "ia_archiver",
  "uptimerobot", "pingdom", "statuscake",
  "netlify"
];

// ── Logging helper ──────────────────────────────────────────────
function log(action, request, context, extra = {}) {
  const url = new URL(request.url);
  const rawUA = request.headers.get("user-agent") || "";
  const country = context.geo?.country?.code || "XX";
  const city = context.geo?.city || "";
  const ip = request.headers.get("x-nf-client-connection-ip")
           || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
           || "unknown";

  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    action,           // "ALLOW" | "BLOCK_GEO" | "SKIP_BOT" | "SKIP_ASSET" | "SKIP_COOKIE" | "SKIP_CODE"
    path: url.pathname,
    country,
    city,
    ip,
    ua: rawUA,
    ref: request.headers.get("referer") || "",
    ...extra
  }));
}

export default async (request, context) => {
  const url = new URL(request.url);
  const ua = (request.headers.get("user-agent") || "").toLowerCase();

  // 1. Always allow bots (skip logging — too noisy)
  if (BOT_PATTERNS.some(bot => ua.includes(bot))) {
    return context.next();
  }

  // 2. Allow static assets (css, js, images, fonts)
  const ext = url.pathname.split(".").pop().toLowerCase();
  const staticExts = ["css", "js", "png", "jpg", "jpeg", "gif", "svg", "ico", "woff", "woff2", "ttf", "eot", "webp", "avif"];
  if (staticExts.includes(ext)) {
    return context.next();
  }

  // 3. Check if user has access cookie (already granted)
  const cookies = request.headers.get("cookie") || "";
  if (cookies.includes("jeevan_access=granted")) {
    log("SKIP_COOKIE", request, context);
    return context.next();
  }

  // 4. Check if access code is in URL — grant access + set cookie
  if (url.searchParams.get("access") === ACCESS_CODE) {
    log("SKIP_CODE", request, context);
    const response = await context.next();
    const newResponse = new Response(response.body, response);
    newResponse.headers.set(
      "set-cookie",
      "jeevan_access=granted; path=/; max-age=31536000; SameSite=Lax"
    );
    return newResponse;
  }

  // 5. Check country — block India
  const country = context.geo?.country?.code || "";
  if (country === "IN") {
    log("BLOCK_GEO", request, context);
    return new Response(getBlockedPage(), {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  // 6. Everyone else — allow + log
  log("ALLOW", request, context);
  return context.next();
};

export const config = {
  path: "/*",
};

function getBlockedPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Jeevan AI — Coming Soon to India</title>
<style>
:root{--bg:#0d0d14;--accent:#4f8ef7;--text:#e8e8f0;--text-dim:#8888aa;--text-muted:#555577}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--text);font-family:'DM Sans','Inter',system-ui,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;-webkit-font-smoothing:antialiased}
.container{max-width:520px;text-align:center}
.logo{display:inline-flex;align-items:center;gap:10px;margin-bottom:40px}
.logo-mark{width:36px;height:36px;border-radius:8px;background:var(--accent);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:1rem}
.logo-text{font-weight:700;font-size:1.1rem}
.badge{display:inline-block;padding:5px 14px;border-radius:100px;background:rgba(79,142,247,0.12);border:1px solid rgba(79,142,247,0.3);font-size:0.78rem;font-weight:600;color:var(--accent);letter-spacing:0.05em;text-transform:uppercase;margin-bottom:28px}
h1{font-size:clamp(1.8rem,4vw,2.6rem);line-height:1.2;letter-spacing:-0.02em;color:#fff;margin-bottom:16px}
h1 em{font-style:normal;color:var(--accent)}
p{font-size:1.05rem;color:var(--text-dim);line-height:1.7;margin-bottom:32px}
.notify-form{display:flex;gap:10px;max-width:400px;margin:0 auto 20px}
input{flex:1;padding:12px 16px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:#fff;font-size:0.95rem;outline:none;font-family:inherit}
input:focus{border-color:var(--accent)}
button{padding:12px 24px;border-radius:8px;background:var(--accent);color:#fff;font-size:0.95rem;font-weight:600;border:none;cursor:pointer;white-space:nowrap}
button:hover{opacity:0.88}
.note{font-size:0.82rem;color:var(--text-muted)}
.platforms{margin-top:48px;padding-top:32px;border-top:1px solid rgba(255,255,255,0.07)}
.platforms-label{font-size:0.75rem;color:var(--text-muted);margin-bottom:12px}
.chips{display:flex;gap:8px;justify-content:center;flex-wrap:wrap}
.chip{padding:6px 14px;border-radius:100px;border:1px solid rgba(255,255,255,0.07);font-size:0.8rem;color:var(--text-dim);background:rgba(255,255,255,0.03)}
</style>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
</head>
<body>
<div class="container">
  <div class="logo">
    <img src="/logo.png" alt="Jeevan AI" style="width:36px;height:36px;border-radius:8px;object-fit:cover">
    <div class="logo-text">Jeevan AI</div>
  </div>
  <div class="badge">Coming Soon to India</div>
  <h1>We're launching in <em>India</em> soon.</h1>
  <p>Jeevan AI is currently available for international users. We're preparing something special for the Indian market. Drop your email and we'll notify you the moment we go live.</p>
  <form id="notify-form" action="https://formspree.io/f/mjgzozqa" method="POST" class="notify-form" style="flex-direction:column;align-items:center">
    <div style="display:flex;gap:10px;width:100%;max-width:400px">
      <input type="email" name="email" placeholder="your@email.com" id="email-input" required>
      <button type="submit" id="notify-btn">Notify Me</button>
    </div>
  </form>
  <div id="success-msg" style="display:none;padding:16px 24px;background:rgba(79,247,158,0.1);border:1px solid rgba(79,247,158,0.3);border-radius:8px;max-width:400px;margin:0 auto">
    <p style="color:#4ff79e;font-weight:600;font-size:0.95rem;margin-bottom:4px">You're on the list!</p>
    <p style="font-size:0.85rem;margin:0">We'll email you when we launch in India.</p>
  </div>
  <p class="note">No spam. Just one email when we launch.</p>
  <script>
  document.getElementById('notify-form').addEventListener('submit',function(e){
    e.preventDefault();
    var f=this,b=document.getElementById('notify-btn');
    b.textContent='Sending...';b.disabled=true;
    fetch('https://formspree.io/f/mjgzozqa',{method:'POST',body:new FormData(f),headers:{'Accept':'application/json'}})
    .then(function(r){if(r.ok){f.style.display='none';document.getElementById('success-msg').style.display='block';}else{b.textContent='Notify Me';b.disabled=false;alert('Something went wrong. Please try again.');}})
    .catch(function(){b.textContent='Notify Me';b.disabled=false;alert('Something went wrong. Please try again.');});
  });
  </script>
  <div class="platforms">
    <div class="platforms-label">AI platforms we scan</div>
    <div class="chips">
      <span class="chip">ChatGPT</span>
      <span class="chip">Gemini</span>
      <span class="chip">Perplexity</span>
      <span class="chip">Claude</span>
      <span class="chip">Google AI Mode</span>
    </div>
  </div>
</div>
</body>
</html>`;
}
