// Photo gallery. A random photo sits on the homepage as a thumbnail;
// clicking it opens a full-screen viewer that can be minimized to a grid.
// Photo list lives in photos.json as Cloudinary public IDs — add a new ID
// there to add a photo.
(function () {
  var CLOUD = 'https://res.cloudinary.com/do45g1bvk/image/upload/';
  var thumb = document.getElementById('gallery_thumb');
  var dialog = document.getElementById('gallery');
  if (!thumb || !dialog) return;

  var single = dialog.querySelector('.gallery-single');
  var grid = dialog.querySelector('.gallery-grid');
  var photo = dialog.querySelector('.gallery-photo');
  var counter = dialog.querySelector('.gallery-counter');
  var toggle = dialog.querySelector('.gallery-toggle');
  var prev = dialog.querySelector('.gallery-prev');
  var next = dialog.querySelector('.gallery-next');

  var ids = [];
  var index = 0;

  function url(id, t) { return CLOUD + t + '/' + id; }
  var THUMB = 'c_fill,g_auto,w_300,h_300,f_auto,q_auto';
  var PREVIEW = 'c_limit,w_400,h_400,f_auto,q_auto';
  var FULL = 'c_limit,w_2000,h_2000,f_auto,q_auto';

  // Bumped on every photo change so a slow load for a photo we've already
  // moved past doesn't overwrite the current one.
  var token = 0;

  function showPhoto(i) {
    index = (i + ids.length) % ids.length;
    var t = ++token;
    var full = url(ids[index], FULL);

    // Swap in a fresh <img> so the old photo disappears straight away instead
    // of lingering until the new one has downloaded.
    var img = document.createElement('img');
    img.className = 'gallery-photo';
    img.alt = '';
    var probe = new Image();
    probe.src = full;
    if (probe.complete && probe.naturalWidth) {
      img.src = full;
      single.classList.remove('loading');
    } else {
      // Small copy first (loads fast), full size once it arrives.
      img.src = url(ids[index], PREVIEW);
      img.classList.add('preview');
      single.classList.add('loading');
      probe.onload = function () {
        if (t !== token) return;
        img.src = full;
        img.classList.remove('preview');
        single.classList.remove('loading');
      };
      probe.onerror = function () {
        if (t === token) single.classList.remove('loading');
      };
    }
    photo.replaceWith(img);
    photo = img;

    counter.textContent = (index + 1) + '/' + ids.length;
    single.hidden = false;
    grid.hidden = true;
    toggle.hidden = false;
    // Warm the cache for the neighbours so arrowing feels instant.
    [index - 1, index + 1].forEach(function (j) {
      var id = ids[(j + ids.length) % ids.length];
      new Image().src = url(id, PREVIEW);
      new Image().src = url(id, FULL);
    });
  }

  function showGrid() {
    single.hidden = true;
    grid.hidden = false;
    counter.textContent = ids.length + ' photos';
    toggle.hidden = true;
    var cur = grid.children[index];
    if (cur) cur.scrollIntoView({ block: 'nearest' });
  }

  function open(i) {
    showPhoto(i);
    if (!dialog.open) dialog.showModal();
  }

  fetch('hpi/gallery/photos.json', { cache: 'no-cache' })
    .then(function (r) { return r.json(); })
    .then(function (list) {
      ids = list;
      if (!ids.length) return;
      var start = Math.floor(Math.random() * ids.length);
      var img = thumb.querySelector('img');
      img.addEventListener('load', place);
      img.src = url(ids[start], PREVIEW);
      thumb.hidden = false;
      thumb.addEventListener('click', function (e) { e.preventDefault(); open(start); });

      grid.innerHTML = ids.map(function (id, i) {
        return '<button data-i="' + i + '" aria-label="photo ' + (i + 1) + '">' +
          '<img loading="lazy" alt="" src="' + url(id, THUMB) + '"></button>';
      }).join('');
    })
    .catch(function () {});

  // Centre the thumbnail between the balloons' bottom-right corner and the
  // salmon's top-left corner, keeping it on screen and off the blog list.
  function place() {
    if (thumb.hidden) return;
    var balloons = document.getElementById('balloons');
    var salmon = document.getElementById('video_wrapper');
    var list = document.getElementById('rss-link');
    if (!balloons || !salmon) return;
    var sx = window.scrollX, sy = window.scrollY;
    var b = balloons.getBoundingClientRect();
    var s = salmon.getBoundingClientRect();
    var w = thumb.offsetWidth, h = thumb.offsetHeight;
    var vw = document.documentElement.clientWidth;

    var cx = (Math.min(b.right, vw) + s.left) / 2 + sx;
    var cy = (b.bottom + s.top) / 2 + sy;
    var left = Math.min(Math.max(cx - w / 2, 5), vw - w - 5);
    var top = cy - h / 2;

    // On narrow screens the midpoint can land on the blog list; drop below it.
    if (list) {
      var l = list.parentNode.getBoundingClientRect();
      var listBottom = list.getBoundingClientRect().bottom + sy;
      if (left < l.left + sx + 320 && top < listBottom + 10) top = listBottom + 10;
    }
    thumb.style.left = left + 'px';
    thumb.style.top = top + 'px';
  }
  window.addEventListener('resize', place);
  window.addEventListener('load', place);

  grid.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-i]');
    if (b) showPhoto(+b.dataset.i);
  });
  toggle.addEventListener('click', showGrid);
  prev.addEventListener('click', function () { showPhoto(index - 1); });
  next.addEventListener('click', function () { showPhoto(index + 1); });
  dialog.querySelector('.gallery-close').addEventListener('click', function () { dialog.close(); });

  // Listen on the document, not the dialog: clicking a blank spot can leave
  // focus on <body>, and key presses would then never reach the dialog.
  document.addEventListener('keydown', function (e) {
    if (!dialog.open) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    // First Esc minimizes to the grid; Esc from the grid closes the dialog
    // (the browser's default).
    if (e.key === 'Escape' && !single.hidden) { e.preventDefault(); showGrid(); return; }
    if (!single.hidden) {
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') { e.preventDefault(); showPhoto(index - 1); }
      else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') { e.preventDefault(); showPhoto(index + 1); }
    }
    if (e.key === 'g' || e.key === 'G') { e.preventDefault(); if (grid.hidden) showGrid(); else showPhoto(index); }
  });

  // Swipe between photos on touch screens.
  var touchX = null, touchY = null;
  single.addEventListener('touchstart', function (e) {
    touchX = e.touches[0].clientX;
    touchY = e.touches[0].clientY;
  }, { passive: true });
  single.addEventListener('touchend', function (e) {
    if (touchX === null) return;
    var dx = e.changedTouches[0].clientX - touchX;
    var dy = e.changedTouches[0].clientY - touchY;
    touchX = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) showPhoto(index + (dx < 0 ? 1 : -1));
  });
})();
