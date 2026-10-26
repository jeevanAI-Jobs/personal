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

// ── Readable text: ensure no element has white-on-white or dark-on-dark ──
(function() {
  // Force body text color
  document.body.style.color = '#f1f5f9';

  // Fix any element with light background getting dark text
  var all = document.querySelectorAll('*');
  all.forEach(function(el) {
    var cs = window.getComputedStyle(el);
    var bg = cs.backgroundColor;
    // If background is near-white but text is near-white too — fix text
    if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
      var rgb = bg.match(/\d+/g);
      if (!rgb) return;
      var brightness = (parseInt(rgb[0])*299 + parseInt(rgb[1])*587 + parseInt(rgb[2])*114) / 1000;
      var textColor = cs.color;
      var textRgb = textColor.match(/\d+/g);
      if (!textRgb) return;
      var textBrightness = (parseInt(textRgb[0])*299 + parseInt(textRgb[1])*587 + parseInt(textRgb[2])*114) / 1000;
      // If both bright (white on white) — fix text to dark
      if (brightness > 180 && textBrightness > 180) {
        el.style.color = '#1a1a2e';
      }
      // If both dark (dark on dark) — fix text to light
      if (brightness < 60 && textBrightness < 60) {
        el.style.color = '#f1f5f9';
      }
    }
  });
})();
