// Paginated post reader. The post body is laid out as CSS columns, each
// exactly one viewport wide and as tall as the space left on screen, so
// long paragraphs split cleanly at line breaks. Pages are turned by sliding
// the column strip sideways.
(function () {
  var viewport = document.getElementById('post-viewport');
  var pages = document.getElementById('post-pages');
  var nav = document.getElementById('post-nav');
  var prev = document.getElementById('page-prev');
  var next = document.getElementById('page-next');
  var indicator = document.getElementById('page-indicator');
  var modal = document.getElementById('img_modal');
  var salmon = document.getElementById('salmon');
  if (!viewport || !pages) return;

  var GAP = 40;
  var page = 0;
  var count = 1;

  function layout() {
    // Keep the reader on roughly the same text after a reflow.
    var progress = count > 1 ? page / (count - 1) : 0;

    // Nav must be visible while measuring so its height is reserved.
    nav.hidden = false;
    var width = viewport.clientWidth;
    var top = viewport.getBoundingClientRect().top;
    var bottom = window.innerHeight;
    // On narrow screens the salmon sits under the text column; end the page
    // (and the nav below it) above the salmon instead of behind it.
    if (salmon) {
      var s = salmon.getBoundingClientRect();
      var v = viewport.getBoundingClientRect();
      if (s.height && s.left < v.right && s.right > v.left && s.top > top) bottom = Math.min(bottom, s.top);
    }
    var height = Math.max(120, Math.floor(bottom - top - nav.offsetHeight - 16));

    viewport.style.height = height + 'px';
    pages.style.height = height + 'px';
    pages.style.columnWidth = width + 'px';
    pages.style.columnGap = GAP + 'px';
    pages.style.setProperty('--page-h', height + 'px');

    count = Math.max(1, Math.round((pages.scrollWidth + GAP) / (width + GAP)));
    page = Math.round(progress * (count - 1));
    nav.hidden = count < 2;
    show();
  }

  function show() {
    page = Math.min(Math.max(page, 0), count - 1);
    pages.style.transform = 'translateX(' + -page * (viewport.clientWidth + GAP) + 'px)';
    indicator.textContent = (page + 1) + '/' + count;
    prev.disabled = page === 0;
    next.disabled = page === count - 1;
  }

  function go(delta) {
    page += delta;
    show();
  }

  prev.addEventListener('click', function () { go(-1); });
  next.addEventListener('click', function () { go(1); });

  // Up/down step between posts in the same order as the homepage list
  // (newest first), so up is the more recent post.
  var siblings = { newer: null, older: null };
  var isLocal = ['localhost', '127.0.0.1', ''].indexOf(location.hostname) !== -1;
  var slugMatch = location.pathname.match(/\/posts\/([^/]+)/);
  if (slugMatch) {
    fetch('../../posts.json', { cache: 'no-cache' })
      .then(function (r) { return r.json(); })
      .then(function (posts) {
        if (!isLocal) posts = posts.filter(function (p) { return p.status !== 'draft'; });
        var i = posts.findIndex(function (p) { return p.slug === slugMatch[1]; });
        if (i === -1) return;
        if (i > 0) siblings.newer = posts[i - 1].slug;
        if (i < posts.length - 1) siblings.older = posts[i + 1].slug;
      })
      .catch(function () {});
  }

  function goPost(which) {
    var slug = siblings[which];
    if (slug) location.href = '../' + slug + '/';
  }

  var BACK = { ArrowLeft: 1, a: 1, A: 1 };
  var FORWARD = { ArrowRight: 1, d: 1, D: 1 };
  var NEWER = { ArrowUp: 1, w: 1, W: 1 };
  var OLDER = { ArrowDown: 1, s: 1, S: 1 };
  document.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (modal && modal.open) return;
    var t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (BACK[e.key]) { e.preventDefault(); go(-1); }
    else if (FORWARD[e.key]) { e.preventDefault(); go(1); }
    else if (NEWER[e.key]) { e.preventDefault(); goPost('newer'); }
    else if (OLDER[e.key]) { e.preventDefault(); goPost('older'); }
  });

  // Horizontal swipe on touch screens.
  var touchX = null, touchY = null;
  viewport.addEventListener('touchstart', function (e) {
    touchX = e.touches[0].clientX;
    touchY = e.touches[0].clientY;
  }, { passive: true });
  viewport.addEventListener('touchend', function (e) {
    if (touchX === null) return;
    var dx = e.changedTouches[0].clientX - touchX;
    var dy = e.changedTouches[0].clientY - touchY;
    touchX = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
  });

  // Images and webfonts change the layout once they arrive.
  pages.querySelectorAll('img').forEach(function (img) {
    if (!img.complete) img.addEventListener('load', layout);
  });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(layout);
  window.addEventListener('resize', layout);
  layout();
})();
