/*!
 * mobile-ui.js — Phát hiện thiết bị + tái cấu trúc UI mobile/tablet + spinner chung
 * ---------------------------------------------------------------------------
 * Đặt file này trong <head>, TRƯỚC mọi <script> khác, và chạy đồng bộ
 * (không dùng defer) để class "ui-mobile" được gắn vào <html> trước khi
 * trình duyệt vẽ khung hình đầu tiên -> không bị "nháy" giao diện.
 *
 * TRÊN LAPTOP/DESKTOP: file này gần như không làm gì (chỉ bật sẵn API
 * spinner). Không gắn class, không sửa DOM, không đổi CSS -> UI giữ nguyên.
 *
 * API công khai:
 *   UISpin.button(btnEl)         -> khoá nút + chèn spinner, trả về hàm done()
 *   UISpin.wrap(btnEl, asyncFn)  -> tự bật/tắt spinner quanh 1 hàm async
 *   UISpin.block(el, 'Đang tải') -> phủ spinner lên 1 vùng, trả về hàm done()
 *   UISpin.busy()                -> có request nào đang chạy không
 *   UIDevice.isMobile / isTablet / isPhone
 * --------------------------------------------------------------------------- */
(function (win, doc) {
  'use strict';

  /* ============ 1. PHÁT HIỆN THIẾT BỊ ============ */
  // Ngưỡng: <=1024px HOẶC màn cảm ứng không có chuột chính xác.
  // Dùng cả 2 điều kiện vì tablet xoay ngang có thể rộng hơn 1024px
  // nhưng vẫn là thiết bị cảm ứng, cần bản UI gọn.
  var BREAK_TABLET = 1024;
  var BREAK_PHONE = 640;

  function detect() {
    var w = win.innerWidth || doc.documentElement.clientWidth || 0;
    var coarse = false, noHover = false;
    try {
      coarse = win.matchMedia('(pointer: coarse)').matches;
      noHover = win.matchMedia('(hover: none)').matches;
    } catch (e) { /* trình duyệt cũ: bỏ qua, chỉ dựa vào chiều rộng */ }
    var touch = ('ontouchstart' in win) || (navigator.maxTouchPoints || 0) > 1;
    var uaMobile = /Android|iPhone|iPad|iPod|Windows Phone|Mobile|Tablet|Silk/i.test(navigator.userAgent || '');
    // iPadOS 13+ tự nhận là "Macintosh", phải kiểm tra thêm điểm chạm
    var iPadOS = /Macintosh/.test(navigator.userAgent || '') && (navigator.maxTouchPoints || 0) > 1;

    var isTouchDevice = (coarse && noHover && touch) || uaMobile || iPadOS;
    var isMobile = isTouchDevice || w <= BREAK_TABLET;
    return {
      isMobile: isMobile,
      isPhone: isMobile && w <= BREAK_PHONE,
      isTablet: isMobile && w > BREAK_PHONE,
      width: w
    };
  }

  var dev = detect();
  win.UIDevice = dev;

  function applyClasses() {
    var r = doc.documentElement;
    r.classList.toggle('ui-mobile', dev.isMobile);
    r.classList.toggle('ui-phone', dev.isPhone);
    r.classList.toggle('ui-tablet', dev.isTablet);
  }
  applyClasses();

  /* ============ 2. TẮT LIQUID GLASS TRÊN MOBILE ============
     real-liquid-glass.js vẽ displacement map bằng canvas cho TỪNG phần tử
     và vẽ lại mỗi lần resize -> rất nặng trên máy yếu. Trên mobile ta chặn
     hàm enable() ngay từ đầu, kể cả khi script đó load sau file này. */
  if (dev.isMobile) {
    var _rlg = null;
    try {
      Object.defineProperty(win, 'RealLiquidGlass', {
        configurable: true,
        get: function () { return _rlg; },
        set: function (v) {
          _rlg = v;
          if (v && typeof v.enable === 'function') {
            v.enable = function () { /* vô hiệu hoá trên mobile/tablet */ };
            try { v.refresh = function () {}; } catch (e) {}
          }
        }
      });
    } catch (e) { /* nếu không định nghĩa được thì thôi, CSS vẫn đã tắt backdrop-filter */ }
  }

  /* ============ 3. SPINNER / CIRCULAR PROGRESS ============ */
  function makeSpin(cls) {
    var s = doc.createElement('span');
    s.className = 'ui-spin' + (cls ? ' ' + cls : '');
    s.setAttribute('aria-hidden', 'true');
    return s;
  }

  var UISpin = {
    /* Khoá 1 nút và chèn spinner vào trước nhãn. Trả về hàm gỡ. */
    button: function (el) {
      if (!el || el.classList.contains('ui-busy')) return function () {};
      el.classList.add('ui-busy');
      el.setAttribute('aria-busy', 'true');
      var sp = makeSpin(isDarkButton(el) ? 'ui-spin-on-dark' : '');
      el.insertBefore(sp, el.firstChild);
      var restoreDisabled = el.disabled;
      el.disabled = true;
      return function done() {
        el.classList.remove('ui-busy');
        el.removeAttribute('aria-busy');
        el.disabled = restoreDisabled;
        if (sp && sp.parentNode) sp.parentNode.removeChild(sp);
      };
    },

    /* Bọc 1 hàm async: tự bật spinner, tự tắt kể cả khi lỗi. */
    wrap: function (el, fn) {
      var done = UISpin.button(el);
      var out;
      try { out = fn(); } catch (e) { done(); throw e; }
      if (out && typeof out.then === 'function') {
        return out.then(function (v) { done(); return v; },
                        function (e) { done(); throw e; });
      }
      done();
      return out;
    },

    /* Phủ spinner lên 1 vùng (danh sách/bảng/khung) trong lúc tải. */
    block: function (el, text) {
      if (!el) return function () {};
      if (el.__uiVeil) return el.__uiVeilDone || function () {};
      el.classList.add('ui-block-loading');
      var veil = doc.createElement('div');
      veil.className = 'ui-block-veil';
      veil.setAttribute('role', 'status');
      veil.appendChild(makeSpin('ui-spin-lg'));
      if (text) {
        var t = doc.createElement('span');
        t.textContent = text;
        veil.appendChild(t);
      }
      el.appendChild(veil);
      el.__uiVeil = veil;
      var done = function () {
        el.classList.remove('ui-block-loading');
        if (veil.parentNode) veil.parentNode.removeChild(veil);
        el.__uiVeil = null;
        el.__uiVeilDone = null;
      };
      el.__uiVeilDone = done;
      return done;
    },

    busy: function () { return netCount > 0; }
  };
  win.UISpin = UISpin;

  function isDarkButton(el) {
    try {
      var bg = getComputedStyle(el).backgroundColor || '';
      var m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (!m) return false;
      var lum = (0.299 * +m[1] + 0.587 * +m[2] + 0.114 * +m[3]) / 255;
      return lum < 0.6;
    } catch (e) { return false; }
  }

  /* ---- Vòng tiến trình góc màn hình: hiện khi có request mạng ---- */
  var netCount = 0, ring = null, ringTimer = null;

  function ensureRing() {
    if (ring || !doc.body) return ring;
    ring = doc.createElement('div');
    ring.id = 'ui-net-progress';
    ring.setAttribute('role', 'status');
    ring.setAttribute('aria-label', 'Đang xử lý');
    ring.innerHTML = '<svg class="ui-progress-ring" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle></svg>';
    doc.body.appendChild(ring);
    return ring;
  }

  function netStart() {
    netCount++;
    // Trễ 220ms mới hiện: request nhanh sẽ không làm nhấp nháy màn hình
    if (!ringTimer) {
      ringTimer = setTimeout(function () {
        ringTimer = null;
        if (netCount > 0 && ensureRing()) ring.classList.add('on');
      }, 220);
    }
  }

  function netEnd() {
    netCount = Math.max(0, netCount - 1);
    if (netCount === 0) {
      if (ringTimer) { clearTimeout(ringTimer); ringTimer = null; }
      if (ring) ring.classList.remove('on');
      flushPendingButtons();
    }
  }

  /* ---- Đếm request: bao fetch + XMLHttpRequest ----
     Supabase JS, Upstash Redis, pdf.js... đều đi qua fetch/XHR nên
     chỉ cần bao 2 chỗ này là bắt được gần như mọi thao tác chờ. */
  if (typeof win.fetch === 'function') {
    var _fetch = win.fetch;
    win.fetch = function () {
      netStart();
      var p;
      try { p = _fetch.apply(this, arguments); }
      catch (e) { netEnd(); throw e; }
      return p.then(function (r) { netEnd(); return r; },
                    function (e) { netEnd(); throw e; });
    };
  }
  if (win.XMLHttpRequest) {
    var _send = win.XMLHttpRequest.prototype.send;
    win.XMLHttpRequest.prototype.send = function () {
      var self = this, ended = false;
      netStart();
      function fin() { if (!ended) { ended = true; netEnd(); } }
      self.addEventListener('loadend', fin);
      try { return _send.apply(self, arguments); }
      catch (e) { fin(); throw e; }
    };
  }

  /* ---- Tự gắn spinner cho nút gây ra request ----
     Cách làm: khi người dùng bấm 1 nút, ghi nhớ nút đó trong 150ms.
     Nếu trong khoảng đó có request mạng bắt đầu -> đây là nút "chờ",
     gắn spinner cho tới khi mọi request kết thúc. Nhờ vậy không cần
     sửa tay từng hàm onclick trong các file HTML. */
  var pendingBtn = null, pendingAt = 0, pendingDone = null;

  doc.addEventListener('click', function (ev) {
    var el = ev.target;
    while (el && el !== doc.body) {
      if (el.tagName === 'BUTTON' || (el.classList && el.classList.contains('btn'))) break;
      el = el.parentNode;
    }
    if (!el || el === doc.body || el.classList.contains('ui-busy')) return;
    if (el.hasAttribute('data-no-spinner')) return;
    pendingBtn = el;
    pendingAt = Date.now();
    var startCount = netCount;
    setTimeout(function () {
      if (pendingBtn === el && netCount > startCount) {
        pendingDone = UISpin.button(el);
      } else if (pendingBtn === el) {
        pendingBtn = null;
      }
    }, 150);
  }, true);

  function flushPendingButtons() {
    if (pendingDone) { pendingDone(); pendingDone = null; }
    pendingBtn = null;
  }
  // Chốt chặn: không để nút bị khoá quá 20 giây dù có sự cố mạng
  setInterval(function () {
    if (pendingDone && Date.now() - pendingAt > 20000) flushPendingButtons();
  }, 5000);

  /* ============ 4. TÁI CẤU TRÚC DOM CHO MOBILE ============
     Chỉ chạy khi là mobile/tablet. Hai việc, đều an toàn về hiển thị:
       a) Bọc mỗi <table> vào 1 div cuộn ngang -> bảng không làm vỡ trang.
       b) Ép lưới nhiều cột hẹp về 1 cột.
          QUAN TRỌNG: chỉ ép lưới có 2-4 cột VÀ mỗi cột hẹp hơn 150px.
          Lưới lịch 7-8 cột và lưới auto-fill được giữ nguyên, vì ép
          những lưới đó về 1 cột sẽ làm hỏng bố cục. */
  function wrapTables(root) {
    var tables = (root || doc).querySelectorAll ? (root || doc).querySelectorAll('table') : [];
    for (var i = 0; i < tables.length; i++) {
      var t = tables[i];
      if (t.parentNode && t.parentNode.classList && t.parentNode.classList.contains('ui-tablewrap')) continue;
      var w = doc.createElement('div');
      w.className = 'ui-tablewrap';
      t.parentNode.insertBefore(w, t);
      w.appendChild(t);
    }
  }

  function collapseGrids(root) {
    var scope = root && root.querySelectorAll ? root : doc;
    var els = scope.querySelectorAll('*');
    var limit = Math.min(els.length, 4000); // chốt chặn hiệu năng trên trang rất lớn
    for (var i = 0; i < limit; i++) {
      var el = els[i];
      if (el.__uiGridDone) continue;
      var cs;
      try { cs = getComputedStyle(el); } catch (e) { continue; }
      if (cs.display !== 'grid' && cs.display !== 'inline-grid') continue;
      el.__uiGridDone = true;
      var cols = (cs.gridTemplateColumns || '').trim().split(/\s+/).filter(Boolean);
      if (cols.length < 2 || cols.length > 4) continue; // bỏ qua lịch 7-8 cột
      var px = parseFloat(cols[0]);
      if (isNaN(px) || px >= 150) continue;             // cột còn đủ rộng thì giữ nguyên
      el.style.setProperty('grid-template-columns', '1fr', 'important');
    }
  }

  function restructure(root) {
    if (!dev.isMobile) return;
    try { wrapTables(root); } catch (e) {}
    try { collapseGrids(root); } catch (e) {}
  }

  /* Chạy lần đầu + theo dõi nội dung sinh động (danh sách bài, card...) */
  function onReady(fn) {
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  onReady(function () {
    ensureRing();
    restructure(doc);

    if (dev.isMobile && win.MutationObserver) {
      var queue = [], timer = null;
      new MutationObserver(function (list) {
        for (var i = 0; i < list.length; i++) {
          var added = list[i].addedNodes;
          for (var j = 0; j < added.length; j++) {
            if (added[j].nodeType === 1) queue.push(added[j]);
          }
        }
        if (queue.length && !timer) {
          // Gom nhiều thay đổi rồi xử lý 1 lần, tránh chạy liên tục gây lag
          timer = setTimeout(function () {
            timer = null;
            var batch = queue.splice(0, queue.length);
            for (var k = 0; k < batch.length; k++) restructure(batch[k]);
          }, 250);
        }
      }).observe(doc.body, { childList: true, subtree: true });
    }
  });

  /* Xoay ngang/dọc hoặc đổi kích thước cửa sổ -> tính lại loại thiết bị */
  var rsTimer = null;
  win.addEventListener('resize', function () {
    clearTimeout(rsTimer);
    rsTimer = setTimeout(function () {
      var before = dev.isMobile;
      var next = detect();
      dev.isMobile = next.isMobile;
      dev.isPhone = next.isPhone;
      dev.isTablet = next.isTablet;
      dev.width = next.width;
      applyClasses();
      if (!before && dev.isMobile) restructure(doc);
    }, 200);
  });

})(window, document);
