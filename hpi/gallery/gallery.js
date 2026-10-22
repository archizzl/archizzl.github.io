// Portfolio galleries. Each gallery in galleries.json gets a homepage
// thumbnail (a random image from it) that opens a full-screen viewer, which
// can be minimized to a grid.
//
// Per gallery (id e.g. 'photo'):
// - images: everything tagged with its Cloudinary tag, read live (needs
//   'Resource list' unrestricted in Cloudinary Settings > Security). If that
//   fails, <id>/photos.json is the fallback list of public IDs.
// - <id>/sections.json groups images into titled sections with a
//   description (edit with _gallery-editor/editor.py). Tagged images that
//   aren't in a section go in an untitled group at the end.
// - Sections can also hold items that aren't Cloudinary images:
//   {type: 'embed', src, width, height, title, thumb, url} shows an iframe
//   player (Bandcamp, Spotify, YouTube...), and
//   {type: 'link', url, title, thumb, source} shows a card linking out
//   (articles). `thumb` is a Cloudinary public ID or an image URL.
// - sections.json's "featured" lists starred images, and starred embeds
//   carry featured: true. The homepage thumbnail is a random starred item
//   (an embed shows its thumb); with nothing starred, any image.
//
// ?gallery=<id> in the URL opens that gallery straight to its grid (bare
// ?gallery opens the first). Not a #hash: that's the blog tag filter.
//
// Gallery pages (/photo/, /design/): an element with data-gallery-page="<id>"
// shows just that gallery, open on its grid. Closing it goes to the homepage.
(function () {
  var CLOUD = 'https://res.cloudinary.com/do45g1bvk/image/';
  // Data files sit next to this script, wherever the page is.
  var BASE = new URL('.', document.currentScript.src).href;
  var HOME = new URL('../../', BASE).href;
  var THUMB = 'c_fill,g_auto,w_300,h_300,f_auto,q_auto';
  var PREVIEW = 'c_limit,w_400,h_400,f_auto,q_auto';
  var FULL = 'c_limit,w_2000,h_2000,f_auto,q_auto';

  var anchor; // thumbnails and dialogs go just before this (the salmon)
  var galleries = [];
  var pageMode = false; // on a gallery page: no homepage thumbnail

  function url(id, t) { return CLOUD + 'upload/' + t + '/' + id; }
  // Embed/link thumbnails can be a Cloudinary public ID or any image URL.
  function thumbURL(src, t) { return /^https?:\/\//.test(src) ? src : url(src, t); }
  function isImage(item) { return typeof item === 'string'; }
  function hostOf(u) {
    try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
  }
  // 'sweetumsofthebody.bandcamp.com' -> 'bandcamp.com', for "open on …".
  function siteOf(u) { return hostOf(u).split('.').slice(-2).join('.'); }
  function getJSON(u) {
    return fetch(u, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    });
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  // Descriptions are plain text with [text](url) links, like the blog.
  function renderText(s) {
    return esc(s).replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (m, text, href) {
      return /^(https?:|mailto:|\/|\.)/.test(href)
        ? '<a href="' + href + '" target="_blank">' + text + '</a>' : m;
    });
  }

  // Newest upload first, matching the order of a collection.
  function taggedImages(cfg) {
    return getJSON(CLOUD + 'list/' + encodeURIComponent(cfg.tag) + '.json')
      .then(function (data) {
        var list = data.resources.slice().sort(function (a, b) {
          return a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0;
        }).map(function (r) { return r.public_id; });
        if (!list.length) throw new Error('empty');
        return list;
      })
      .catch(function () { return getJSON(BASE + cfg.id + '/photos.json'); });
  }

  function createGallery(cfg) {
    var thumb = document.createElement('a');
    thumb.className = 'gallery-thumb';
    thumb.href = '#';
    thumb.hidden = true;
    thumb.setAttribute('aria-label', 'open ' + cfg.label);
    thumb.innerHTML = '<img alt=""><span>' + esc(cfg.label) + '</span>';

    var dialog = document.createElement('dialog');
    dialog.className = 'gallery-dialog';
    dialog.tabIndex = -1;
    dialog.setAttribute('aria-label', cfg.label);
    dialog.innerHTML =
      '<div class="gallery-bar">' +
        '<span class="gallery-counter"></span>' +
        '<button class="gallery-toggle" aria-label="minimize to grid">show grid</button>' +
        '<button class="gallery-close" aria-label="close ' + esc(cfg.label) + '">×</button>' +
      '</div>' +
      '<div class="gallery-single">' +
        '<button class="gallery-prev" aria-label="previous">←</button>' +
        '<img class="gallery-photo" alt="">' +
        '<button class="gallery-next" aria-label="next">→</button>' +
      '</div>' +
      '<div class="gallery-grid" hidden></div>';
    anchor.parentNode.insertBefore(thumb, anchor);
    anchor.parentNode.insertBefore(dialog, anchor);

    var single = dialog.querySelector('.gallery-single');
    var grid = dialog.querySelector('.gallery-grid');
    var photo = dialog.querySelector('.gallery-photo');
    var counter = dialog.querySelector('.gallery-counter');
    var toggle = dialog.querySelector('.gallery-toggle');

    var ids = [];     // items in order: image public IDs or embed/link objects
    var groupOf = []; // item index -> its group in `groups`
    var groups = [];  // [{ title, description, items }]
    var index = 0;
    // Bumped on every image change so a slow load for an image we've already
    // moved past doesn't overwrite the current one.
    var token = 0;

    function showPhoto(i) {
      index = (i + ids.length) % ids.length;
      var t = ++token;
      var item = ids[index];
      if (!isImage(item)) {
        showExtra(item);
        single.classList.remove('loading');
      } else {
        showImage(item, t);
      }

      var title = groups[groupOf[index]].title;
      counter.textContent = (index + 1) + '/' + ids.length + (title ? ' \u00b7 ' + title : '');
      single.hidden = false;
      grid.hidden = true;
      toggle.hidden = false;
      fitFrame(); // needs the single view visible to measure it
      // Warm the cache for the neighbours so arrowing feels instant.
      [index - 1, index + 1].forEach(function (j) {
        var n = ids[(j + ids.length) % ids.length];
        if (!isImage(n)) return;
        new Image().src = url(n, PREVIEW);
        new Image().src = url(n, FULL);
      });
    }

    function showImage(id, t) {
      var full = url(id, FULL);

      // Swap in a fresh <img> so the old image disappears straight away
      // instead of lingering until the new one has downloaded.
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
        img.src = url(id, PREVIEW);
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
    }

    // Embeds and link cards take the photo's place in the single view.
    function showExtra(item) {
      var box = document.createElement('div');
      box.className = 'gallery-photo gallery-extra';
      var caption = (item.title ? '<span class="gallery-extra-title">' + esc(item.title) + '</span>' : '');
      var link = item.url
        ? '<a href="' + esc(item.url) + '" target="_blank" rel="noopener">' +
          (item.type === 'link' ? 'read on ' + esc(item.source || hostOf(item.url)) : 'open on ' + esc(siteOf(item.url))) +
          ' \u2197</a>'
        : '';
      if (item.type === 'embed') {
        box.innerHTML = '<div class="gallery-frame"><iframe src="' + esc(item.src) + '" loading="lazy" ' +
          'allow="autoplay; encrypted-media; fullscreen; picture-in-picture; clipboard-write" allowfullscreen></iframe></div>' +
          '<p class="gallery-extra-caption">' + caption + link + '</p>';
      } else {
        box.innerHTML = '<a class="gallery-card" href="' + esc(item.url) + '" target="_blank" rel="noopener">' +
          (item.thumb ? '<img alt="" src="' + esc(thumbURL(item.thumb, FULL)) + '">' : '') + '</a>' +
          '<p class="gallery-extra-caption">' + caption + link + '</p>';
      }
      if (item.type === 'embed') {
        var iframe = box.querySelector('iframe');
        iframe.addEventListener('focus', function () {
          if (!dialog.open) return;
          iframe.blur();
          dialog.focus();
        });
      }
      photo.replaceWith(box);
      photo = box;
    }

    // Remove an embed (stopping anything playing in it) when leaving it.
    function stopExtra() {
      if (!photo.classList.contains('gallery-extra')) return;
      var blank = document.createElement('img');
      blank.className = 'gallery-photo';
      blank.alt = '';
      photo.replaceWith(blank);
      photo = blank;
    }
    dialog.addEventListener('close', stopExtra);

    // Scale an embed to fit the space, keeping its own aspect ratio.
    // Height only (e.g. Spotify's width="100%"): fill the width, keep the
    // height. No size at all: assume 16:9 video.
    function fitFrame() {
      var frameBox = photo.querySelector && photo.querySelector('.gallery-frame');
      if (!frameBox) return;
      var item = ids[index];
      var cap = photo.querySelector('.gallery-extra-caption');
      var availW = photo.clientWidth;
      var availH = photo.clientHeight - (cap ? cap.offsetHeight : 0) - 8;
      var w, h;
      if (!+item.width && +item.height) {
        w = Math.min(availW, 800);
        h = Math.min(+item.height, availH);
      } else {
        var bw = +item.width || 1280, bh = +item.height || 720;
        var scale = Math.min(availW / bw, availH / bh, item.width ? 1.5 : Infinity);
        w = bw * scale;
        h = bh * scale;
      }
      var iframe = frameBox.querySelector('iframe');
      iframe.style.width = Math.floor(w) + 'px';
      iframe.style.height = Math.floor(h) + 'px';
    }
    window.addEventListener('resize', function () { if (dialog.open && !single.hidden) fitFrame(); });

    function showGrid() {
      single.hidden = true;
      grid.hidden = false;
      counter.textContent = cfg.label + ' \u00b7 ' + ids.length;
      toggle.hidden = true;
      stopExtra();
      var cur = grid.querySelector('[data-i="' + index + '"]');
      if (cur) cur.scrollIntoView({ block: 'nearest' });
    }

    function open(i) {
      if (!dialog.open) dialog.showModal();
      showPhoto(i);
    }

    // Lay visible tagged images out into sections. Section images that are no
    // longer tagged or explicitly hidden are skipped, and an image only
    // appears in its first section. Embeds and links always show.
    function arrange(list, config) {
      var hidden = {};
      // Hidden embeds simply aren't in any section; only image IDs matter here.
      (config && config.hidden || []).forEach(function (id) { if (isImage(id)) hidden[id] = true; });
      var tagged = {}, used = {};
      list.forEach(function (id) { if (!hidden[id]) tagged[id] = true; });
      groups = [];
      ((config && config.sections) || []).forEach(function (sec) {
        var items = (sec.items || sec.photos || []).filter(function (item) {
          if (!isImage(item)) return item && (item.type === 'embed' ? !!item.src : item.type === 'link' && !!item.url);
          if (!tagged[item] || used[item]) return false;
          return (used[item] = true);
        });
        if (items.length) groups.push({ title: sec.title || '', description: sec.description || '', items: items });
      });
      var rest = list.filter(function (id) { return tagged[id] && !used[id]; });
      if (rest.length) groups.push({ title: '', description: '', items: rest });

      ids = [];
      groupOf = [];
      groups.forEach(function (g, gi) {
        g.items.forEach(function (item) { ids.push(item); groupOf.push(gi); });
      });
    }

    function renderGrid() {
      var i = 0;
      grid.innerHTML = groups.map(function (g) {
        var tiles = g.items.map(function (item) {
          var n = i++;
          if (isImage(item)) {
            return '<button data-i="' + n + '" aria-label="image ' + (n + 1) + '">' +
              '<img loading="lazy" alt="" src="' + url(item, THUMB) + '"></button>';
          }
          var label = item.title || hostOf(item.url || item.src);
          return '<button class="gallery-tile-extra" data-i="' + n + '" aria-label="' + esc(label) + '">' +
            (item.thumb ? '<img loading="lazy" alt="" src="' + esc(thumbURL(item.thumb, THUMB)) + '">'
                        : '<span class="gallery-tile-text">' + esc(label) + '</span>') +
            (item.type === 'link' ? '<span class="gallery-badge">\u2197</span>' : '') + '</button>';
        }).join('');
        return '<section class="gallery-section">' +
          (g.title ? '<h2 class="gallery-title">' + esc(g.title) + '</h2>' : '') +
          (g.description ? '<p class="gallery-desc">' + renderText(g.description) + '</p>' : '') +
          '<div class="gallery-tiles">' + tiles + '</div>' +
          '</section>';
      }).join('');
    }

    grid.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-i]');
      if (b) showPhoto(+b.dataset.i);
    });
    function pointInRect(rect, e) {
      return e.clientX >= rect.left && e.clientX <= rect.right &&
        e.clientY >= rect.top && e.clientY <= rect.bottom;
    }
    function clickIsOnItem(photoEl, e) {
      if (photoEl.classList.contains('gallery-extra')) {
        if (e.target.closest('.gallery-extra-caption')) return true;
        var content = photoEl.querySelector('.gallery-frame iframe, .gallery-card');
        return !!content && pointInRect(content.getBoundingClientRect(), e);
      }
      if (photoEl.tagName !== 'IMG' || !photoEl.naturalWidth || !photoEl.naturalHeight) return true;
      var r = photoEl.getBoundingClientRect();
      var imageRatio = photoEl.naturalWidth / photoEl.naturalHeight;
      var boxRatio = r.width / r.height;
      var width = boxRatio > imageRatio ? r.height * imageRatio : r.width;
      var height = boxRatio > imageRatio ? r.height : r.width / imageRatio;
      var left = r.left + (r.width - width) / 2;
      var top = r.top + (r.height - height) / 2;
      return pointInRect({ left: left, right: left + width, top: top, bottom: top + height }, e);
    }
    dialog.addEventListener('click', function (e) {
      if (single.hidden || e.target.closest('button')) return;
      var photoEl = e.target.closest('.gallery-photo');
      if (photoEl && clickIsOnItem(photoEl, e)) return;
      showGrid();
    });
    toggle.addEventListener('click', showGrid);
    dialog.querySelector('.gallery-prev').addEventListener('click', function () { showPhoto(index - 1); });
    dialog.querySelector('.gallery-next').addEventListener('click', function () { showPhoto(index + 1); });
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
    }, true);

    // Swipe between images on touch screens.
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

    var g = { cfg: cfg, thumb: thumb, pageMode: pageMode };
    g.ready = Promise.all([
      taggedImages(cfg),
      getJSON(BASE + cfg.id + '/sections.json').catch(function () { return null; })
    ]).then(function (res) {
      arrange(res[0], res[1]);
      if (!ids.length) return;
      var starred = {};
      ((res[1] && res[1].featured) || []).forEach(function (id) { starred[id] = true; });
      var imageAt = [], starredAt = [];
      ids.forEach(function (item, n) {
        if (isImage(item)) {
          imageAt.push(n);
          if (starred[item]) starredAt.push(n);
        } else if (item.featured && item.thumb) {
          starredAt.push(n); // an embed needs a thumb to be shown
        }
      });
      if (starredAt.length) imageAt = starredAt;
      if (!imageAt.length) return;
      var start = imageAt[Math.floor(Math.random() * imageAt.length)];
      var img = thumb.querySelector('img');
      img.addEventListener('load', place);
      img.src = isImage(ids[start]) ? url(ids[start], PREVIEW) : thumbURL(ids[start].thumb, PREVIEW);
      if (!g.pageMode) thumb.hidden = false;
      thumb.addEventListener('click', function (e) { e.preventDefault(); open(start); });
      renderGrid();
      place();
    }).catch(function () {});
    g.openGrid = function () {
      return g.ready.then(function () {
        if (!ids.length) return;
        showGrid();
        dialog.showModal();
      });
    };
    g.dialog = dialog;
    return g;
  }

  // Lay the thumbnails out side by side, centred between the balloons'
  // bottom-right corner and the salmon's top-left corner, keeping the row on
  // screen and off the blog list.
  var GAP = 24;
  function place() {
    var thumbs = galleries.map(function (g) { return g.thumb; }).filter(function (t) { return !t.hidden; });
    if (!thumbs.length) return;
    var balloons = document.getElementById('balloons');
    var salmon = document.getElementById('video_wrapper');
    var list = document.getElementById('rss-link');
    if (!balloons || !salmon) return;
    var sx = window.scrollX, sy = window.scrollY;
    var b = balloons.getBoundingClientRect();
    var s = salmon.getBoundingClientRect();
    var vw = document.documentElement.clientWidth;

    var widths = thumbs.map(function (t) { return t.offsetWidth; });
    var w = widths.reduce(function (a, x) { return a + x; }, 0) + GAP * (thumbs.length - 1);
    var h = Math.max.apply(null, thumbs.map(function (t) { return t.offsetHeight; }));

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
    thumbs.forEach(function (t, i) {
      t.style.left = left + 'px';
      t.style.top = top + 'px';
      left += widths[i] + GAP;
    });
  }
  window.addEventListener('resize', place);
  window.addEventListener('load', place);

  // The script tag sits above the salmon in index.html, so wait for the page.
  function init() {
    var page = document.querySelector('[data-gallery-page]');
    if (page) {
      anchor = page;
      getJSON(BASE + 'galleries.json').then(function (list) {
        var cfg = list.filter(function (c) { return c.id === page.dataset.galleryPage; })[0];
        if (!cfg) { location.replace(HOME); return; }
        pageMode = true;
        var g = createGallery(cfg);
        g.openGrid();
        g.dialog.addEventListener('close', function () { location.href = HOME; });
      }).catch(function () {});
      return;
    }
    anchor = document.getElementById('video_wrapper');
    if (anchor) getJSON(BASE + 'galleries.json').then(start).catch(function () {});
  }
  function start(list) {
    galleries = list.map(createGallery);
    var m = location.search.match(/[?&]gallery(?:=([^&]*))?(?:&|$)/);
    if (m) {
      var want = m[1] ? decodeURIComponent(m[1]) : list[0].id;
      var g = galleries.filter(function (x) { return x.cfg.id === want; })[0];
      if (g) g.openGrid();
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
