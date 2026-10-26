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
