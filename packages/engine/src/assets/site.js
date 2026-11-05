/* Projet multi-pages : menu de navigation sur mobile, recherche dans toutes les pages (index embarqué ou chargé). */
(function () {
  var d = document, body = d.body;
  var navBtn = d.querySelector('.sd-nav-toggle');
  if (navBtn) navBtn.addEventListener('click', function () { navBtn.setAttribute('aria-expanded', body.classList.toggle('sd-nav-open')); });
  d.addEventListener('click', function (e) { if (body.classList.contains('sd-nav-open') && !e.target.closest('.sd-site-nav, .sd-nav-toggle')) body.classList.remove('sd-nav-open'); });
  var cur = d.querySelector('.sd-site-nav [aria-current]');
  if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });

  var box = d.querySelector('.sd-site-search'), btn = d.querySelector('.sd-site-search-toggle');
  if (!box || !btn) return;
  var input = box.querySelector('input'), list = box.querySelector('.sd-site-results'), hrefs = window.__SD_SITE_HREFS || {};
  var norm = function (s) { return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); };
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var index = null, sel = -1;
  function load(cb) {
    if (index) return cb();
    if (window.__SD_SEARCH) { index = window.__SD_SEARCH; return cb(); }
    var src = box.getAttribute('data-index');
    if (!src) { index = []; return cb(); }
    var s = d.createElement('script'); s.src = src;
    s.onload = function () { index = window.__SD_SEARCH || []; cb(); };
    s.onerror = function () { index = []; cb(); };
    d.head.appendChild(s);
  }
  function snippet(text, q) {
    var i = norm(text).indexOf(q);
    if (i < 0) return esc(text.slice(0, 120));
    var a = Math.max(0, i - 50);
    return (a ? '…' : '') + esc(text.slice(a, i)) + '<mark>' + esc(text.slice(i, i + q.length)) + '</mark>' + esc(text.slice(i + q.length, i + q.length + 80)) + '…';
  }
  function run() {
    var q = norm(input.value.trim());
    sel = -1;
    if (q.length < 2) { list.innerHTML = ''; return; }
    var out = [];
    index.forEach(function (p) {
      var t = norm(p.title), x = norm(p.text), score = t.indexOf(q) >= 0 ? 3 : 0;
      var h = (p.headings || []).filter(function (h) { return norm(h.text).indexOf(q) >= 0; })[0];
      if (h) score += 2;
      if (x.indexOf(q) >= 0) score += 1;
      if (score) out.push({ p: p, h: h, score: score });
    });
    out.sort(function (a, b) { return b.score - a.score; });
    list.innerHTML = out.length ? out.slice(0, 30).map(function (r) {
      var href = (hrefs[r.p.id] || r.p.href || '#') + (r.h ? '#' + r.h.id : '');
      return '<a href="' + esc(href) + '">' + esc(r.p.title) + (r.h ? ' · ' + esc(r.h.text) : '') + '<small>' + snippet(r.p.text, q) + '</small></a>';
    }).join('') : '<div class="sd-site-empty">Aucun résultat dans le projet.</div>';
  }
  function open() { box.hidden = false; load(function () { input.focus(); run(); }); }
  btn.addEventListener('click', function () { box.hidden ? open() : (box.hidden = true); });
  input.addEventListener('input', run);
  input.addEventListener('keydown', function (e) {
    var items = list.querySelectorAll('a');
    if (e.key === 'Escape') { box.hidden = true; btn.focus(); }
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && items.length) {
      e.preventDefault();
      sel = (sel + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
      items.forEach(function (a, i) { a.classList.toggle('sd-current', i === sel); });
    }
    if (e.key === 'Enter' && items.length) { (items[sel < 0 ? 0 : sel]).click(); }
  });
  d.addEventListener('keydown', function (e) { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); open(); } });
})();
