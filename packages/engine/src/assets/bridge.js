/* Pont d'aperçu (seulement dans l'application) : synchronisation source <-> aperçu, état de pagination. */
(function () {
  var d = document, T = window.__SD_TARGET;
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
  });
  var t;
  addEventListener('scroll', function () { clearTimeout(t); t = setTimeout(function () { post({ type: 'sd:scroll', y: scroller().scrollTop }); }, 80); }, { passive: true });

  var style = d.createElement('style');
  style.textContent = '[data-line]{cursor:default}.sd-picked{outline:2px solid #3b82f6!important;outline-offset:3px}';
  d.head.appendChild(style);

  if (T === 'print') {
    d.addEventListener('sd:paged', function (e) { post({ type: 'sd:paged', pages: e.detail.pages, overflows: e.detail.overflows || [], error: e.detail.error }); });
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
