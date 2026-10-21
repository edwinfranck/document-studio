/* Page de lecture : progression, sommaire actif, recherche, onglets, copie du code, thème. */
(function () {
  var d = document, root = d.documentElement, body = d.body;
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };

  // Thème clair / sombre
  var saved = store.get('sd-scheme');
  if (saved) root.dataset.scheme = saved;
  var schemeBtn = d.querySelector('.sd-scheme-toggle');
  if (schemeBtn) schemeBtn.addEventListener('click', function () {
    var cur = root.dataset.scheme;
    if (cur === 'auto') {
      // « auto » affiche l'inverse quand le système le demande : on part de ce qui est visible.
      var alt = root.dataset.alt || 'dark';
      cur = matchMedia('(prefers-color-scheme: ' + alt + ')').matches ? 'inverse' : 'template';
    }
    root.dataset.scheme = cur === 'inverse' ? 'template' : 'inverse';
    store.set('sd-scheme', root.dataset.scheme);
  });

  // Largeur de lecture
  var widthBtn = d.querySelector('.sd-width-toggle');
  if (store.get('sd-wide') === '1') body.classList.add('sd-wide-mode');
  if (widthBtn) widthBtn.addEventListener('click', function () {
    body.classList.toggle('sd-wide-mode');
    store.set('sd-wide', body.classList.contains('sd-wide-mode') ? '1' : '0');
  });

  // Progression et titre dans la barre
  var bar = d.querySelector('.sd-progress span');
  var head = d.querySelector('.sd-doc-head');
  function onScroll() {
    var max = root.scrollHeight - innerHeight;
    if (bar) bar.style.width = (max > 0 ? Math.min(100, scrollY / max * 100) : 100) + '%';
    body.classList.toggle('sd-scrolled', head ? head.getBoundingClientRect().bottom < 60 : scrollY > 80);
  }
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // Sommaire : section active, ouverture sur mobile
  var tocLinks = [].slice.call(d.querySelectorAll('.sd-toc a'));
  var targets = tocLinks.map(function (a) { return d.getElementById(decodeURIComponent(a.hash.slice(1))); });
  if ('IntersectionObserver' in window && targets.length) {
    var visible = new Map();
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { visible.set(e.target, e.isIntersecting); });
      var idx = -1;
      for (var i = 0; i < targets.length; i++) if (targets[i] && targets[i].getBoundingClientRect().top < innerHeight * 0.3) idx = i;
      tocLinks.forEach(function (a, i) { a.classList.toggle('sd-active', i === idx); });
    }, { rootMargin: '0px 0px -60% 0px' });
    targets.forEach(function (t) { if (t) io.observe(t); });
  }
  var tocBtn = d.querySelector('.sd-toc-toggle');
  if (tocBtn) tocBtn.addEventListener('click', function () {
    var open = body.classList.toggle('sd-toc-open');
    tocBtn.setAttribute('aria-expanded', open);
  });
  tocLinks.forEach(function (a) { a.addEventListener('click', function () { body.classList.remove('sd-toc-open'); }); });

  // Copie du code
  d.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('.sd-copy');
    if (!btn) return;
    var code = btn.closest('.sd-code').querySelector('pre code');
    var text = code.innerText;
    var done = function () {
      btn.classList.add('sd-copied');
      var label = btn.querySelector('span');
      var before = label && label.textContent;
      if (label) label.textContent = 'Copié';
      setTimeout(function () { btn.classList.remove('sd-copied'); if (label) label.textContent = before; }, 1400);
    };
    var fallback = function () {
      var ta = d.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      body.appendChild(ta); ta.select();
      try { d.execCommand('copy'); done(); } catch (err) {}
      ta.remove();
    };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, fallback); else fallback();
  });

  // Onglets (WAI-ARIA)
  [].forEach.call(d.querySelectorAll('.sd-tabs'), function (tabs) {
    var btns = [].slice.call(tabs.querySelectorAll(':scope > .sd-tablist > [role=tab]'));
    function select(i, focus) {
      btns.forEach(function (b, j) {
        b.setAttribute('aria-selected', i === j); b.tabIndex = i === j ? 0 : -1;
        var p = d.getElementById(b.getAttribute('aria-controls'));
        if (p) p.hidden = i !== j;
      });
      if (focus) btns[i].focus();
    }
    btns.forEach(function (b, i) {
      b.addEventListener('click', function () { select(i); });
      b.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowRight') select((i + 1) % btns.length, true);
        if (e.key === 'ArrowLeft') select((i - 1 + btns.length) % btns.length, true);
      });
    });
  });

  // Recherche dans le document
  var box = d.querySelector('.sd-search');
  var openBtn = d.querySelector('.sd-search-toggle');
  if (box) {
    var input = box.querySelector('input'), count = box.querySelector('.sd-search-count');
    var hits = [], cur = -1, timer;
    var clear = function () {
      hits.forEach(function (m) { var t = d.createTextNode(m.textContent); m.replaceWith(t); t.parentNode && t.parentNode.normalize(); });
      hits = []; cur = -1;
    };
    var norm = function (s) { return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); };
    var run = function () {
      clear();
      var q = norm(input.value.trim());
      if (q.length < 2) { count.textContent = ''; return; }
      var walker = d.createTreeWalker(d.querySelector('.sd-body'), NodeFilter.SHOW_TEXT, {
        acceptNode: function (n) { return n.parentNode.closest('script,style,.sd-anchor') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; }
      });
      var nodes = [], n;
      while ((n = walker.nextNode())) nodes.push(n);
      nodes.forEach(function (node) {
        var text = node.nodeValue, low = norm(text), i = low.indexOf(q);
        if (i < 0 || low.length !== text.length) { if (i >= 0) { var m0 = d.createElement('mark'); m0.className = 'sd-hit'; node.parentNode.insertBefore(m0, node); m0.appendChild(node); hits.push(m0); } return; }
        var frag = d.createDocumentFragment(), last = 0;
        while (i >= 0) {
          frag.appendChild(d.createTextNode(text.slice(last, i)));
          var m = d.createElement('mark'); m.className = 'sd-hit'; m.textContent = text.slice(i, i + q.length);
          frag.appendChild(m); hits.push(m);
          last = i + q.length; i = low.indexOf(q, last);
        }
        frag.appendChild(d.createTextNode(text.slice(last)));
        node.replaceWith(frag);
      });
      count.textContent = hits.length ? '' : '0';
      if (hits.length) go(0);
    };
    var go = function (i) {
      if (!hits.length) return;
      if (cur >= 0 && hits[cur]) hits[cur].classList.remove('sd-current');
      cur = (i + hits.length) % hits.length;
      var h = hits[cur];
      h.classList.add('sd-current');
      var p = h.closest('details'); if (p) p.open = true;
      var panel = h.closest('[role=tabpanel][hidden]');
      if (panel) { var b = d.querySelector('[aria-controls="' + panel.id + '"]'); if (b) b.click(); }
      h.scrollIntoView({ block: 'center' });
      count.textContent = (cur + 1) + ' / ' + hits.length;
    };
    var show = function () { box.hidden = false; input.focus(); input.select(); };
    var hide = function () { box.hidden = true; clear(); count.textContent = ''; };
    if (openBtn) openBtn.addEventListener('click', function () { box.hidden ? show() : hide(); });
    input.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(run, 150); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); go(cur + (e.shiftKey ? -1 : 1)); }
      if (e.key === 'Escape') hide();
    });
    box.querySelector('.sd-search-next').addEventListener('click', function () { go(cur + 1); });
    box.querySelector('.sd-search-prev').addEventListener('click', function () { go(cur - 1); });
    d.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); show(); }
      else if (e.key === '/' && !/INPUT|TEXTAREA/.test(d.activeElement.tagName)) { e.preventDefault(); show(); }
    });
  }
})();
