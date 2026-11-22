/* Jeevan AI modern interactions */
(function(){
  // Scroll reveal
  var els = document.querySelectorAll('.step,.plan,.preview-card,.stat,.factor-item,.section-title,.platform-chip,.audit-card');
  els.forEach(function(el){ el.classList.add('reveal'); });
  var io = new IntersectionObserver(function(entries){
    entries.forEach(function(e){
      if(e.isIntersecting){ e.target.classList.add('revealed'); io.unobserve(e.target); }
    });
  },{threshold:0.12});
  els.forEach(function(el){ io.observe(el); });

  // Counter animation on stat numbers
  function counter(el){
    var t=el.textContent.trim(), m=t.match(/^([\d,]+)(\S*)$/);
    if(!m) return;
    var end=parseInt(m[1].replace(/,/g,'')), suf=m[2]||'', cur=0, dur=1600, step=16;
    var tm=setInterval(function(){
      cur+=Math.ceil(end/(dur/step));
      if(cur>=end){cur=end;clearInterval(tm);}
      el.textContent=cur.toLocaleString('en-IN')+suf;
    },step);
  }
  var io2=new IntersectionObserver(function(entries){
    entries.forEach(function(e){ if(e.isIntersecting){counter(e.target);io2.unobserve(e.target);} });
  },{threshold:0.5});
  document.querySelectorAll('.stat__num').forEach(function(el){ io2.observe(el); });
})();


// ── Hamburger menu (mobile nav) ──────────────────────────────
(function() {
  if (window.innerWidth > 768) return;

  // Find nav links container
  var navLinks = document.querySelector(
    '.nav__links, .nav-links, .header__links, header nav ul, header ul'
  );
  if (!navLinks) return;

  // Create hamburger button
  var btn = document.createElement('button');
  btn.className = 'nav-hamburger';
  btn.setAttribute('aria-label', 'Toggle menu');
  btn.innerHTML = '<span></span><span></span><span></span>';
  btn.style.cssText = [
    'display:flex','flex-direction:column','gap:5px',
    'cursor:pointer','padding:8px','background:none',
    'border:none','margin-left:auto','z-index:10001'
  ].join(';');

  // Insert into nav
  var nav = document.querySelector('nav, header');
  if (nav) {
    nav.style.position = 'relative';
    nav.appendChild(btn);
  }

  // Toggle on click
  btn.addEventListener('click', function() {
    var open = navLinks.classList.toggle('open');
    // Animate hamburger to X
    var spans = btn.querySelectorAll('span');
    if (open) {
      spans[0].style.cssText = 'transform:rotate(45deg) translate(5px,5px);display:block;width:22px;height:2px;background:#f1f5f9;border-radius:2px;transition:0.25s';
      spans[1].style.cssText = 'opacity:0;display:block;width:22px;height:2px;background:#f1f5f9;border-radius:2px;transition:0.25s';
      spans[2].style.cssText = 'transform:rotate(-45deg) translate(5px,-5px);display:block;width:22px;height:2px;background:#f1f5f9;border-radius:2px;transition:0.25s';
    } else {
      spans[0].style.transform = spans[2].style.transform = '';
      spans[1].style.opacity = '';
    }
  });

  // Close menu on link click
  navLinks.querySelectorAll('a').forEach(function(a) {
    a.addEventListener('click', function() {
      navLinks.classList.remove('open');
    });
  });
})();

// ── Readable text guard (2026-11-18) ─────────────────────────────────
// Every page carries its own inline CSS and modern.css layers a dark theme on
// top, so some text ends up light-on-light or dark-on-dark. This walks every
// element that holds text, finds the colour actually behind it (walking up to
// the first opaque background or gradient), and if the WCAG contrast ratio is
// below 3.5 it switches the text to light or dark, whichever reads better.
// It runs on load, again after late content renders, and on DOM changes
// (tool results, FAQ toggles).
(function () {
  var MIN = 3.5, LIGHT = [241, 245, 249], DARK = [17, 24, 39];
  function parse(s) {
    var m = s && s.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    var p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number);
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  }
  function lum(c) {
    function f(v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  }
  function ratio(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  function blend(fg, bg) { return [0, 1, 2].map(function (i) { return fg[i] * fg[3] + bg[i] * (1 - fg[3]); }); }
  function backdrop(el) {
    for (var e = el; e && e.nodeType === 1; e = e.parentElement) {
      var s = getComputedStyle(e);
      if (s.backgroundImage && s.backgroundImage !== 'none') {
        var m = s.backgroundImage.match(/rgba?\([^)]+\)/g);
        if (!m) return null; // a real image: leave text alone
        var cols = m.map(parse).filter(function (c) { return c[3] > 0.3; });
        if (cols.length) return cols;
      }
      var b = parse(s.backgroundColor);
      if (b && b[3] > 0.5) return [b];
    }
    return [parse(getComputedStyle(document.body).backgroundColor) || [13, 17, 23, 1]];
  }
  function fix(root) {
    var w = document.createTreeWalker(root || document.body, NodeFilter.SHOW_TEXT), n, seen = new Set();
    while ((n = w.nextNode())) {
      if (n.nodeValue.trim().length < 2) continue;
      var el = n.parentElement;
      if (!el || seen.has(el) || /^(SCRIPT|STYLE|NOSCRIPT|OPTION|TEXTAREA|CODE|PRE)$/.test(el.tagName)) continue;
      seen.add(el);
      var cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      var tf = cs.webkitTextFillColor;
      if (tf && /rgba\(0, 0, 0, 0\)|transparent/.test(tf)) continue; // gradient text
      // -webkit-text-fill-color wins over color when set, so measure what is painted
      var fg = parse(tf && tf !== cs.color ? tf : cs.color), bgs = backdrop(el);
      if (!fg || !bgs) continue;
      var best = 0;
      bgs.forEach(function (c) { best = Math.max(best, ratio(fg[3] < 1 ? blend(fg, c) : fg, c)); });
      if (best >= MIN) continue;
      var avg = [0, 1, 2].map(function (i) { return bgs.reduce(function (s, c) { return s + c[i]; }, 0) / bgs.length; });
      var pick = ratio(LIGHT, avg) >= ratio(DARK, avg) ? LIGHT : DARK;
      var c = 'rgb(' + pick.join(',') + ')';
      el.style.setProperty('color', c, 'important');
      el.style.setProperty('-webkit-text-fill-color', c, 'important');
    }
  }
  function run() { try { fix(document.body); } catch (e) {} }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
  window.addEventListener('load', function () { run(); setTimeout(run, 1200); });
  var t;
  new MutationObserver(function () { clearTimeout(t); t = setTimeout(run, 250); })
    .observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'open'] });
})();
