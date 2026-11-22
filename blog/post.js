// Fills in a blog post page from KMP (kylemaclachlanphotography.org), where the posts live now.
// The post's address is /blog/post/?p=<slug>, or the older /blog/posts/<slug>/.
// When it's in, it starts the paged reader (reader.js) and the click-to-enlarge images.
(function () {
  var LOCAL = ['localhost', '127.0.0.1', ''].indexOf(location.hostname) !== -1;
  // Previewing locally? Read from a local KMP dev server if one is running.
  var KMP = LOCAL ? 'http://localhost:8127' : 'https://kylemaclachlanphotography.org';
  var USER = 'archie';
  window.ARCHIE_BLOG = { kmp: KMP, user: USER };

  var params = new URLSearchParams(location.search);
  var fromPath = location.pathname.match(/\/blog\/posts\/([^/]+)/);
  var slug = params.get('p') || (fromPath && fromPath[1]);

  var title = document.getElementById('post-title');
  var date = document.getElementById('post-date');
  var tags = document.getElementById('post-tags');
  var pages = document.getElementById('post-pages');

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function notFound() {
    document.title = 'not found — archie';
    title.textContent = 'not found';
    pages.innerHTML = '<p>that post isn\'t here. <a href="/">back home</a>.</p>';
  }

  function imageModal() {
    var modal = document.getElementById('img_modal');
    var mimg = document.getElementById('img_modal_content');
    document.querySelectorAll('#blog-container img').forEach(function (img) {
      img.addEventListener('click', function () {
        mimg.src = img.currentSrc || img.src;
        mimg.alt = img.alt || '';
        modal.showModal();
      });
    });
    modal.addEventListener('click', function () { modal.close(); });
  }

  function startReader() {
    var s = document.createElement('script');
    s.src = '/blog/reader.js?v=2';
    document.body.appendChild(s);
  }

  if (!slug || !/^[a-z0-9-]{1,80}$/.test(slug)) { notFound(); return; }

  fetch(KMP + '/' + USER + '/' + slug + '.json')
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (data) {
      var post = data.post;
      document.title = post.title + ' — archie';
      title.textContent = post.title;
      date.textContent = post.date;
      date.setAttribute('datetime', post.date);
      var t = (post.fields && post.fields.tags) || [];
      if (t.length) {
        tags.innerHTML = t.map(function (tag) {
          return '<a class="tag" href="/#' + encodeURIComponent(tag) + '">#' + esc(tag) + '</a>';
        }).join(' ');
        tags.hidden = false;
      }
      pages.innerHTML = post.html; // KMP escapes anything typed as HTML, so this is safe
      imageModal();
      startReader();
    })
    .catch(notFound);
})();
