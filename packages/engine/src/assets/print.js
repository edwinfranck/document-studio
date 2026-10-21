/* Pagination avec Paged.js : en-têtes de tableau répétés, signalement des débordements. */
(function () {
  if (!window.Paged) { document.body.classList.add('sd-paged-missing'); return; }

  class RepeatTableHeaders extends Paged.Handler {
    afterPageLayout(pageElement, page, breakToken, chunker) {
      if (!document.body.classList.contains('sd-repeat-thead')) return;
      pageElement.querySelectorAll('table[data-split-from]').forEach(function (table) {
        if (table.querySelector('thead')) return;
        var ref = table.dataset.ref;
        var source = chunker.source.querySelector('[data-ref="' + ref + '"]');
        var thead = source && source.querySelector('thead');
        if (thead) table.insertBefore(thead.cloneNode(true), table.firstChild);
      });
    }
  }
  Paged.registerHandlers(RepeatTableHeaders);

  function report(pages) {
    var overflows = [];
    pages.forEach(function (p, i) {
      var area = p.element.querySelector('.pagedjs_page_content');
      if (!area) return;
      var limit = area.getBoundingClientRect().right + 1;
      area.querySelectorAll('table, pre, img, .sd-columns, .sd-math, .sd-figure').forEach(function (el) {
        var r = el.getBoundingClientRect();
        var wide = el.scrollWidth > el.clientWidth + 2 && el.tagName !== 'IMG';
        if (r.right > limit || (el.tagName === 'PRE' && wide)) {
          el.classList.add('sd-overflowing');
          var host = el.closest('[data-line]');
          overflows.push({ page: i + 1, line: host ? +host.dataset.line : 0, kind: el.tagName.toLowerCase() });
        }
      });
    });
    return overflows;
  }

  var ready = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
  ready.then(function () {
    var previewer = new Paged.Previewer();
    return previewer.preview().then(function (flow) {
      var overflows = report(flow.pages);
      document.body.classList.add('sd-paged');
      window.__SD_PAGED = { pages: flow.total, overflows: overflows };
      document.dispatchEvent(new CustomEvent('sd:paged', { detail: window.__SD_PAGED }));
    });
  }).catch(function (e) {
    window.__SD_PAGED = { pages: 0, error: String(e && e.message || e) };
    document.dispatchEvent(new CustomEvent('sd:paged', { detail: window.__SD_PAGED }));
  });
})();
