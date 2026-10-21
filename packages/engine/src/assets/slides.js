/* Diaporama : ajustement du texte, échelle, navigation, transitions, vue présentateur et vue d'ensemble. */
(function () {
  var d = document, body = d.body;
  var deck = d.querySelector('.sd-deck');
  var slides = [].slice.call(d.querySelectorAll('.sd-slide'));
  var bar = d.querySelector('.sd-deck-progress span');
  // Taille de la toile lue dans son style : offsetWidth vaut 0 si le cadre n'est pas encore mis en page.
  var W = parseFloat(deck.style.width) || 1920, H = parseFloat(deck.style.height) || 1080;
  var i = 0, presenter = null, startedAt = null;

  // 1. Ajustement : réduction par paliers jusqu'à 70 %, puis signalement.
  function fit(s) {
    var inner = s.querySelector('.sd-slide-inner');
    s.style.visibility = 'visible';
    s.style.removeProperty('--fit');
    var f = 1;
    var over = function () { return inner.scrollHeight > inner.clientHeight + 2 || inner.scrollWidth > inner.clientWidth + 2; };
    while (over() && f > 0.7) { f = Math.round((f - 0.05) * 100) / 100; s.style.setProperty('--fit', f); }
    if (over()) s.dataset.overflow = '1'; else delete s.dataset.overflow;
    // Diapositive clairsemée : on agrandit le texte (jusqu'à 130 %) tant qu'il reste de la place.
    var grow = /sd-layout-(default|split)/.test(s.className) && f === 1;
    var room = function () { var l = inner.lastElementChild; return !!l && l.offsetTop + l.offsetHeight < inner.clientHeight * 0.62; };
    while (grow && room() && f < 1.3) {
      f = Math.round((f + 0.05) * 100) / 100; s.style.setProperty('--fit', f);
      if (over()) { f = Math.round((f - 0.05) * 100) / 100; s.style.setProperty('--fit', f); break; }
    }
    s.dataset.fit = f;
    s.style.visibility = '';
  }
  function fitAll() { slides.forEach(fit); }

  // 2. Échelle
  function scale() {
    if (body.classList.contains('sd-overview')) return;
    var k = Math.min(innerWidth / W, innerHeight / H);
    if (k > 0 && isFinite(k)) deck.style.transform = 'scale(' + k + ')';
  }

  // 3. Navigation
  function go(n, silent) {
    i = Math.max(0, Math.min(slides.length - 1, n));
    slides.forEach(function (s, k) { s.classList.toggle('sd-active', k === i); s.classList.toggle('sd-before', k < i); });
    if (bar) bar.style.width = ((i + 1) / slides.length * 100) + '%';
    if (!window.__SD_PREVIEW) try { history.replaceState(null, '', '#' + (i + 1)); } catch (e) {}
    updatePresenter();
    if (!silent) d.dispatchEvent(new CustomEvent('sd:slide', { detail: { index: i, count: slides.length } }));
  }
  function toggleFull() {
    if (d.fullscreenElement) d.exitFullscreen(); else if (d.documentElement.requestFullscreen) d.documentElement.requestFullscreen();
  }
  function toggleOverview() {
    var on = body.classList.toggle('sd-overview');
    if (on) {
      deck.style.transform = 'none';
      var k = 320 / W;
      d.documentElement.style.setProperty('--sd-thumb', k);
      slides[i].scrollIntoView({ block: 'center' });
    } else scale();
  }
  addEventListener('keydown', function (e) {
    if (e.target.closest && e.target.closest('input, textarea, [contenteditable]')) return;
    var k = e.key;
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter', 'n'].indexOf(k) >= 0) { e.preventDefault(); go(i + 1); }
    else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].indexOf(k) >= 0) { e.preventDefault(); go(i - 1); }
    else if (k === 'Home') go(0);
    else if (k === 'End') go(slides.length - 1);
    else if (k === 'f' || k === 'F') toggleFull();
    else if (k === 'o' || k === 'O' || k === 'Escape' && body.classList.contains('sd-overview')) toggleOverview();
    else if (k === 'p' || k === 'P') openPresenter();
  });
  deck.addEventListener('click', function (e) {
    if (body.classList.contains('sd-overview')) {
      var s = e.target.closest('.sd-slide');
      if (s) { go(slides.indexOf(s)); toggleOverview(); }
      return;
    }
    if (window.__SD_PREVIEW || e.target.closest('a, button, video, summary')) return;
    go(i + (e.clientX > innerWidth / 3 ? 1 : -1));
  });
  var x0 = null;
  addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
  addEventListener('touchend', function (e) {
    if (x0 === null) return;
    var dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 40) go(i + (dx < 0 ? 1 : -1));
    x0 = null;
  });

  // 4. Vue présentateur : fenêtre pilotée par celle-ci (diapositive courante, suivante, notes, chrono).
  function openPresenter() {
    if (presenter && !presenter.closed) { presenter.focus(); return; }
    presenter = window.open('', 'sd-presenter', 'width=1200,height=760');
    if (!presenter) return;
    startedAt = Date.now();
    var styles = [].map.call(d.querySelectorAll('style'), function (s) { return s.outerHTML; }).join('');
    presenter.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Présentateur</title>' + styles +
      '<style>body{margin:0;background:#16171a;color:#eee;font:15px/1.5 system-ui,sans-serif;display:grid;grid-template-columns:1.6fr 1fr;grid-template-rows:auto 1fr;gap:16px;padding:16px;height:100vh;box-sizing:border-box;overflow:hidden}' +
      '.bar{grid-column:1/3;display:flex;gap:24px;align-items:center}.bar b{font-size:28px;font-variant-numeric:tabular-nums}.bar button{background:#2a2c31;color:#eee;border:0;border-radius:6px;padding:8px 14px;font:inherit;cursor:pointer}' +
      '.cur,.next{position:relative;overflow:hidden;border-radius:6px;background:#000}.cur{grid-row:2}.side{display:grid;grid-template-rows:auto 1fr;gap:16px;min-height:0}.next{aspect-ratio:' + W + '/' + H + '}' +
      '.frame{position:absolute;left:0;top:0;width:' + W + 'px;height:' + H + 'px;transform-origin:0 0}.frame .sd-slide{opacity:1;visibility:visible;transform:none;transition:none}' +
      '.notes{overflow:auto;background:#1f2125;border-radius:6px;padding:16px 20px;font-size:20px;line-height:1.5}.notes:empty::before{content:"Pas de notes pour cette diapositive.";color:#777}.notes *{color:#eee!important}</style></head>' +
      '<body class="sd"><div class="bar"><b class="clock">00:00</b><span class="pos"></span><button data-a="prev">←</button><button data-a="next">→</button><button data-a="reset">Remettre le chrono à zéro</button></div>' +
      '<div class="cur"><div class="frame"></div></div><div class="side"><div class="next"><div class="frame"></div></div><div class="notes"></div></div></body></html>');
    presenter.document.close();
    presenter.document.body.className = body.className + ' sd-presenter-view';
    presenter.document.addEventListener('click', function (e) {
      var a = e.target.dataset && e.target.dataset.a;
      if (a === 'prev') go(i - 1); else if (a === 'next') go(i + 1); else if (a === 'reset') startedAt = Date.now();
    });
    presenter.addEventListener('keydown', function (e) {
      if (['ArrowRight', ' ', 'PageDown'].indexOf(e.key) >= 0) { e.preventDefault(); go(i + 1); }
      if (['ArrowLeft', 'PageUp'].indexOf(e.key) >= 0) { e.preventDefault(); go(i - 1); }
    });
    presenter.addEventListener('resize', updatePresenter);
    setInterval(function () {
      if (!presenter || presenter.closed) return;
      var s = Math.floor((Date.now() - startedAt) / 1000);
      presenter.document.querySelector('.clock').textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
    }, 1000);
    updatePresenter();
  }
  function place(box, slide) {
    var frame = box.querySelector('.frame');
    frame.innerHTML = '';
    if (!slide) return;
    var c = slide.cloneNode(true);
    c.classList.add('sd-active');
    var n = c.querySelector('.sd-notes'); if (n) n.remove();
    frame.appendChild(c);
    frame.style.transform = 'scale(' + Math.min(box.clientWidth / W, box.clientHeight / H) + ')';
  }
  function updatePresenter() {
    if (!presenter || presenter.closed) return;
    var pd = presenter.document;
    place(pd.querySelector('.cur'), slides[i]);
    place(pd.querySelector('.next'), slides[i + 1]);
    var notes = slides[i].querySelector('.sd-notes');
    pd.querySelector('.notes').innerHTML = notes ? notes.innerHTML : '';
    pd.querySelector('.pos').textContent = 'Diapositive ' + (i + 1) + ' / ' + slides.length;
  }

  addEventListener('resize', scale);
  window.SD = { go: go, get index() { return i; }, count: slides.length, overflows: function () { return slides.map(function (s, k) { return s.dataset.overflow ? k : -1; }).filter(function (k) { return k >= 0; }); }, refit: fitAll };
  var start = Math.max(0, (parseInt(location.hash.slice(1), 10) || 1) - 1);
  var boot = function () { fitAll(); scale(); go(start, false); d.documentElement.dataset.ready = '1'; d.dispatchEvent(new CustomEvent('sd:fitted')); };
  scale();
  if (d.fonts && d.fonts.ready) d.fonts.ready.then(boot); else boot();
  if (!window.__SD_PREVIEW && !sessionStorageGet()) { body.classList.add('sd-show-hint'); setTimeout(function () { body.classList.remove('sd-show-hint'); }, 3500); }
  function sessionStorageGet() { try { var v = sessionStorage.getItem('sd-hint'); sessionStorage.setItem('sd-hint', '1'); return v; } catch (e) { return '1'; } }
})();
