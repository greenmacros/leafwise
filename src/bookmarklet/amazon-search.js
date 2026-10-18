// Bookmarklet source. ISOLATED on purpose: it scrapes Amazon's search-results DOM,
// which Amazon changes without notice. If it stops working, fix only this file.
// Runs on an Amazon search page; opens the tool with the results in the URL hash.
// The placeholder __TOOL_URL__ is replaced by install.ts.
(function () {
  var cards = document.querySelectorAll('[data-component-type="s-search-result"]');
  var items = [];
  cards.forEach(function (card) {
    var h = card.querySelector('h2');
    var title = h ? h.textContent.replace(/\s+/g, ' ').trim() : '';
    var priceEl = card.querySelector('.a-price:not(.a-text-price) .a-offscreen') || card.querySelector('.a-price .a-offscreen');
    var price = priceEl ? priceEl.textContent.trim() : '';
    var a = card.querySelector('h2 a') || card.querySelector('a.a-link-normal[href*="dp"]');
    var m = a && /\/dp\/([A-Z0-9]{10})/.exec(decodeURIComponent(a.getAttribute('href') || ''));
    var u = m ? location.origin + '/dp/' + m[1] : '';
    if (title && price) items.push({ t: title, p: price, u: u });
  });
  if (!items.length) { alert('No products found. Amazon\'s layout may have changed.'); return; }
  items = items.slice(0, 20);
  window.open('__TOOL_URL__#bm=' + encodeURIComponent(JSON.stringify(items)), '_blank');
})();
