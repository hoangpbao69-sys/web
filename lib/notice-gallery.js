/*!
 * notice-gallery.js — Khung ảnh cho "Thông báo chung" ở trang chủ
 * ---------------------------------------------------------------------------
 * Cách dùng:
 *   const html = NoticeGallery.html(images);   // images = [{url, caption}, ...]
 *   ...gắn html vào trang...
 *   NoticeGallery.init();                      // kích hoạt các khung ảnh mới
 *
 * Tính năng:
 *   - Nhiều ảnh: tự lướt sang ảnh kế sau 4,5 giây; dừng khi rê chuột vào,
 *     khi đang vuốt, hoặc khi tab bị ẩn.
 *   - Nút mũi tên trái/phải (bo tròn, có viền), chấm tròn chỉ vị trí, số ảnh.
 *   - Vuốt ngang trên điện thoại/tablet để chuyển ảnh.
 *   - Bấm vào ảnh -> xem toàn màn hình (phím ←/→ để lướt, Esc để đóng).
 *   - Chỉ có 1 ảnh -> ẩn hết nút, chỉ hiện ảnh to.
 * --------------------------------------------------------------------------- */
(function (win, doc) {
  'use strict';

  var AUTOPLAY_MS = 4500;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* Chuẩn hoá dữ liệu ảnh: chấp nhận [{url,caption}] hoặc ['url', ...] */
  function normalize(images) {
    if (!images) return [];
    var out = [];
    for (var i = 0; i < images.length; i++) {
      var im = images[i];
      if (!im) continue;
      var url = typeof im === 'string' ? im : im.url;
      if (!url) continue;
      out.push({ url: url, caption: (typeof im === 'string' ? '' : (im.caption || '')) });
    }
    return out;
  }

  /* ---------- Sinh HTML ---------- */
  function html(images) {
    var list = normalize(images);
    if (!list.length) return '';
    var slides = list.map(function (im, i) {
      return '<div class="ng-slide" role="group" aria-label="Ảnh ' + (i + 1) + '/' + list.length + '">'
        + '<span class="ng-blur" style="background-image:url(&quot;' + esc(im.url) + '&quot;)"></span>'
        + '<img class="ng-img" src="' + esc(im.url) + '" alt="' + esc(im.caption || ('Ảnh thông báo ' + (i + 1))) + '" loading="lazy" data-index="' + i + '" data-caption="' + esc(im.caption || '') + '">'
        + '</div>';
    }).join('');
    var dots = list.length > 1 ? '<div class="ng-dots">' + list.map(function (im, i) {
      return '<button type="button" class="ng-dot' + (i === 0 ? ' on' : '') + '" data-go="' + i + '" aria-label="Xem ảnh ' + (i + 1) + '" data-no-spinner></button>';
    }).join('') + '</div>' : '';
    var nav = list.length > 1
      ? '<button type="button" class="ng-nav ng-prev" aria-label="Ảnh trước" data-no-spinner>‹</button>'
      + '<button type="button" class="ng-nav ng-next" aria-label="Ảnh kế tiếp" data-no-spinner>›</button>'
      + '<div class="ng-count"><span class="ng-cur">1</span>/' + list.length + '</div>'
      : '';
    return '<div class="notice-gallery" data-notice-gallery data-count="' + list.length + '">'
      + '<div class="ng-viewport"><div class="ng-track">' + slides + '</div>' + nav + dots + '</div>'
      + '<div class="ng-caption">' + esc(list[0].caption || '') + '</div>'
      + '</div>';
  }

  /* ---------- Lớp xem ảnh toàn màn hình ---------- */
  var lb = null, lbItems = [], lbIndex = 0;

  function ensureLightbox() {
    if (lb) return lb;
    lb = doc.createElement('div');
    lb.className = 'ng-lightbox';
    lb.innerHTML = '<button type="button" class="ng-lb-close" aria-label="Đóng" data-no-spinner>✕</button>'
      + '<button type="button" class="ng-lb-nav ng-lb-prev" aria-label="Ảnh trước" data-no-spinner>‹</button>'
      + '<img alt="">'
      + '<button type="button" class="ng-lb-nav ng-lb-next" aria-label="Ảnh kế tiếp" data-no-spinner>›</button>'
      + '<div class="ng-lb-cap"></div>';
    doc.body.appendChild(lb);
    lb.addEventListener('click', function (ev) {
      if (ev.target === lb || ev.target.classList.contains('ng-lb-close')) closeLightbox();
      else if (ev.target.classList.contains('ng-lb-prev')) stepLightbox(-1);
      else if (ev.target.classList.contains('ng-lb-next')) stepLightbox(1);
    });
    doc.addEventListener('keydown', function (ev) {
      if (!lb || !lb.classList.contains('on')) return;
      if (ev.key === 'Escape') closeLightbox();
      else if (ev.key === 'ArrowLeft') stepLightbox(-1);
      else if (ev.key === 'ArrowRight') stepLightbox(1);
    });
    return lb;
  }
  function paintLightbox() {
    var im = lbItems[lbIndex];
    if (!im) return;
    lb.querySelector('img').src = im.url;
    lb.querySelector('.ng-lb-cap').textContent = im.caption || '';
    lb.setAttribute('data-count', String(lbItems.length));
  }
  function openLightbox(items, index) {
    ensureLightbox();
    lbItems = items; lbIndex = index || 0;
    paintLightbox();
    lb.classList.add('on');
  }
  function stepLightbox(dir) {
    if (!lbItems.length) return;
    lbIndex = (lbIndex + dir + lbItems.length) % lbItems.length;
    paintLightbox();
  }
  function closeLightbox() { if (lb) lb.classList.remove('on'); }

  /* ---------- Kích hoạt 1 khung ảnh ---------- */
  function setup(root) {
    if (!root || root.__ngReady) return;
    root.__ngReady = true;

    var track = root.querySelector('.ng-track');
    var slides = root.querySelectorAll('.ng-slide');
    var dots = root.querySelectorAll('.ng-dot');
    var capEl = root.querySelector('.ng-caption');
    var curEl = root.querySelector('.ng-cur');
    var total = slides.length;
    if (!track || !total) return;

    // Gom đường dẫn + ghi chú của từng ảnh (ghi chú nằm ở thuộc tính data-caption)
    var items = [], captions = [];
    for (var i = 0; i < total; i++) {
      var img = slides[i].querySelector('img');
      var cap = img ? (img.getAttribute('data-caption') || '') : '';
      items.push({ url: img ? img.getAttribute('src') : '', caption: cap });
      captions.push(cap);
    }

    var index = 0, timer = null, paused = false;

    function paint() {
      track.style.transform = 'translateX(' + (-index * 100) + '%)';
      for (var d = 0; d < dots.length; d++) dots[d].classList.toggle('on', d === index);
      if (curEl) curEl.textContent = String(index + 1);
      if (capEl) capEl.textContent = captions[index] || '';
    }
    function go(n) { index = (n + total) % total; paint(); }
    function step(dir) { go(index + dir); }

    function start() {
      if (total < 2 || timer) return;
      timer = setInterval(function () { if (!paused && !doc.hidden) step(1); }, AUTOPLAY_MS);
    }
    function stop() { if (timer) { clearInterval(timer); timer = null; } }

    root.addEventListener('mouseenter', function () { paused = true; });
    root.addEventListener('mouseleave', function () { paused = false; });

    root.addEventListener('click', function (ev) {
      var t = ev.target;
      if (t.classList.contains('ng-prev')) { ev.stopPropagation(); step(-1); }
      else if (t.classList.contains('ng-next')) { ev.stopPropagation(); step(1); }
      else if (t.classList.contains('ng-dot')) { ev.stopPropagation(); go(parseInt(t.dataset.go, 10) || 0); }
      else if (t.classList.contains('ng-img')) {
        ev.stopPropagation();
        openLightbox(items, index);
      }
    });

    /* Vuốt ngang */
    var sx = 0, sy = 0, swiping = false;
    root.addEventListener('touchstart', function (ev) {
      if (total < 2 || !ev.touches.length) return;
      sx = ev.touches[0].clientX; sy = ev.touches[0].clientY;
      swiping = true; paused = true;
    }, { passive: true });
    root.addEventListener('touchend', function (ev) {
      if (!swiping) return;
      swiping = false;
      paused = false;
      var t = (ev.changedTouches && ev.changedTouches[0]) || null;
      if (!t) return;
      var dx = t.clientX - sx, dy = t.clientY - sy;
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) step(dx < 0 ? 1 : -1);
    }, { passive: true });

    paint();
    start();
    root.__ngStop = stop;
  }

  function init(scope) {
    var root = scope && scope.querySelectorAll ? scope : doc;
    var list = root.querySelectorAll('[data-notice-gallery]');
    for (var i = 0; i < list.length; i++) setup(list[i]);
  }

  win.NoticeGallery = { html: html, init: init, esc: esc };

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', function () { init(); });
  else init();

})(window, document);
