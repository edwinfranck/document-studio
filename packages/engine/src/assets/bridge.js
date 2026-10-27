/* Pont d'aperçu (seulement dans l'application) : synchronisation source <-> aperçu, état de pagination. */
(function () {
  var d = document, T = window.__SD_TARGET;
  var zoning = false, zones = [];
  window.__SD_PREVIEW = true;
  var post = function (m) { parent.postMessage(Object.assign({ sdPreview: true }, m), '*'); };

  // Les liens ne quittent jamais l'aperçu ; les ancres internes défilent.
  d.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href]');
    if (a) {
      var h = a.getAttribute('href');
      e.preventDefault();
      if (h.charAt(0) === '#') { var t = d.getElementById(decodeURIComponent(h.slice(1))); if (t) t.scrollIntoView({ block: 'start' }); }
      else post({ type: 'sd:link', href: h });
      return;
    }
    var z = e.target.closest && e.target.closest('.sd-zone');
    if (z) { post({ type: 'sd:zoneClick', id: z.dataset.zone }); return; }
    if (zoning) return;
    var el = e.target.closest && e.target.closest('[data-line]');
    if (el && !e.target.closest('button, summary, [role=tab]')) {
      d.querySelectorAll('.sd-picked').forEach(function (x) { x.classList.remove('sd-picked'); });
      el.classList.add('sd-picked');
      post({ type: 'sd:select', line: +el.dataset.line });
    }
  }, true);

  function nearest(line) {
    var best = null, bl = -1;
    d.querySelectorAll('[data-line]').forEach(function (el) {
      var l = +el.dataset.line;
      if (l <= line && l > bl) { best = el; bl = l; }
    });
    return best;
  }
  var scroller = function () { return d.scrollingElement || d.documentElement; };
  addEventListener('message', function (e) {
    var m = e.data || {};
    if (m.type === 'sd:scrollTo') {
      if (T === 'slides' && window.SD) {
        var idx = 0;
        d.querySelectorAll('.sd-slide').forEach(function (s, k) { if (s.dataset.line && +s.dataset.line <= m.line) idx = k; });
        var inner = nearest(m.line); if (inner) { var s = inner.closest('.sd-slide'); if (s) idx = +s.dataset.index; }
        window.SD.go(idx);
      } else {
        var el = nearest(m.line);
        if (el) el.scrollIntoView({ block: 'center', behavior: m.smooth ? 'smooth' : 'auto' });
      }
    }
    if (m.type === 'sd:restore') scroller().scrollTop = m.y || 0;
    if (m.type === 'sd:goto' && window.SD) window.SD.go(m.index);
    if (m.type === 'sd:zoom') { d.body.style.zoom = m.value; }
    if (m.type === 'sd:zoneMode') { zoning = !!m.on; d.documentElement.classList.toggle('sd-zoning', zoning); }
    if (m.type === 'sd:zones') { zones = m.zones || []; drawZones(); }
    if (m.type === 'sd:zoneGoto') { var t = d.querySelector('.sd-zone[data-zone="' + m.id + '"]'); if (t) t.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  });
  var t;
  addEventListener('scroll', function () { clearTimeout(t); t = setTimeout(function () { post({ type: 'sd:scroll', y: scroller().scrollTop }); }, 80); }, { passive: true });

  var style = d.createElement('style');
  style.textContent = '[data-line]{cursor:default}.sd-picked{outline:2px solid #3b82f6!important;outline-offset:3px}'
    + '.pagedjs_page{position:relative}.sd-zoning .pagedjs_page,.sd-zoning .pagedjs_page *{cursor:crosshair!important}'
    + '.sd-zone,.sd-zone-draft{position:absolute;z-index:60;border:2px solid #f08c00;background:rgba(240,140,0,.10);border-radius:3px;box-sizing:border-box}'
    + '.sd-zone{cursor:pointer}.sd-zone.active{border-color:#e8590c;background:rgba(232,89,12,.18)}.sd-zone-draft{border-style:dashed;pointer-events:none}'
    + '.sd-zone b{position:absolute;top:-11px;left:-11px;width:20px;height:20px;border-radius:50%;background:#f08c00;color:#fff;font:700 11px/20px system-ui,sans-serif;text-align:center}';
  // pas de règle @media print ici : Paged.js l'appliquerait à l'écran ; le pont n'existe que dans l'aperçu
  d.head.appendChild(style);

  /* Commentaires sur une zone de page : rectangle tracé à la souris, en fractions de la page. */
  function drawZones() {
    d.querySelectorAll('.sd-zone').forEach(function (x) { x.remove(); });
    var pages = d.querySelectorAll('.pagedjs_page');
    zones.forEach(function (z) {
      var p = pages[z.page - 1];
      if (!p) return;
      var el = d.createElement('div');
      el.className = 'sd-zone' + (z.active ? ' active' : '');
      el.dataset.zone = z.id;
      el.title = z.title || '';
      el.style.left = z.rect.x * 100 + '%'; el.style.top = z.rect.y * 100 + '%';
      el.style.width = z.rect.w * 100 + '%'; el.style.height = z.rect.h * 100 + '%';
      var b = d.createElement('b'); b.textContent = z.n; el.appendChild(b);
      p.appendChild(el);
    });
  }
  var drag = null;
  d.addEventListener('mousedown', function (e) {
    if (!zoning || e.button !== 0) return;
    var page = e.target.closest && e.target.closest('.pagedjs_page');
    if (!page) return;
    e.preventDefault();
    var r = page.getBoundingClientRect();
    var box = d.createElement('div'); box.className = 'sd-zone-draft'; page.appendChild(box);
    drag = { page: page, r: r, x: e.clientX, y: e.clientY, box: box };
  }, true);
  d.addEventListener('mousemove', function (e) {
    if (!drag) return;
    var r = drag.r, x1 = Math.min(drag.x, e.clientX), y1 = Math.min(drag.y, e.clientY);
    drag.box.style.left = (x1 - r.left) + 'px'; drag.box.style.top = (y1 - r.top) + 'px';
    drag.box.style.width = Math.abs(e.clientX - drag.x) + 'px'; drag.box.style.height = Math.abs(e.clientY - drag.y) + 'px';
  });
  d.addEventListener('mouseup', function (e) {
    if (!drag) return;
    var g = drag; drag = null; g.box.remove();
    var r = g.r, clamp = function (v) { return Math.max(0, Math.min(1, v)); };
    var x1 = clamp((Math.min(g.x, e.clientX) - r.left) / r.width), y1 = clamp((Math.min(g.y, e.clientY) - r.top) / r.height);
    var x2 = clamp((Math.max(g.x, e.clientX) - r.left) / r.width), y2 = clamp((Math.max(g.y, e.clientY) - r.top) / r.height);
    // un simple clic désigne une zone de taille raisonnable autour du point
    if (x2 - x1 < 0.02 || y2 - y1 < 0.01) { x1 = clamp(x1 - 0.1); x2 = clamp(x1 + 0.2); y1 = clamp(y1 - 0.025); y2 = clamp(y1 + 0.05); }
    var abs = { left: r.left + x1 * r.width, right: r.left + x2 * r.width, top: r.top + y1 * r.height, bottom: r.top + y2 * r.height };
    var line = 0, words = [];
    g.page.querySelectorAll('[data-line]').forEach(function (el) {
      var b = el.getBoundingClientRect();
      if (b.right < abs.left || b.left > abs.right || b.bottom < abs.top || b.top > abs.bottom) return;
      if (!line) line = +el.dataset.line;
      if (!el.querySelector('[data-line]') && words.join(' ').length < 200) words.push((el.textContent || '').trim());
    });
    var pages = Array.prototype.indexOf.call(d.querySelectorAll('.pagedjs_page'), g.page);
    post({ type: 'sd:zone', page: pages + 1, rect: { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }, line: line, excerpt: words.join(' ').replace(/\s+/g, ' ').slice(0, 200) });
  });

  if (T === 'print') {
    d.addEventListener('sd:paged', function (e) { drawZones(); post({ type: 'sd:paged', pages: e.detail.pages, overflows: e.detail.overflows || [], error: e.detail.error }); });
  } else if (T === 'slides') {
    var send = function () {
      if (!window.SD) return;
      var all = d.querySelectorAll('.sd-slide');
      post({ type: 'sd:slides', index: window.SD.index, count: window.SD.count, overflows: window.SD.overflows().map(function (i) { return { index: i, line: +(all[i].dataset.line || 0) }; }) });
    };
    d.addEventListener('sd:slide', send);
    d.addEventListener('sd:fitted', send);
  }
  post({ type: 'sd:ready', target: T });
})();
