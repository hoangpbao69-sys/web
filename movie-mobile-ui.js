/*!
 * movie-mobile-ui.js — Phát hiện thiết bị cho Thư Viện Phim.
 * ---------------------------------------------------------------------------
 * Đặt trong <head>, TRƯỚC mọi script khác, chạy đồng bộ (không defer) để
 * class "mv-mobile" được gắn vào <html> trước khi trình duyệt vẽ khung hình
 * đầu tiên — tránh nháy giao diện.
 *
 * TRÊN LAPTOP/DESKTOP: không gắn class nào -> movie-mobile-ui.css không có
 * dòng nào áp dụng -> giao diện giữ nguyên 100% như hiện tại.
 *
 * Cách phát hiện giống hệt bản dùng cho web quản lý tài liệu: kết hợp
 * pointer/hover, số điểm chạm, User-Agent, xử lý riêng iPadOS 13+ (tự khai
 * "Macintosh"), và ngưỡng bề rộng 1024px làm lưới an toàn.
 * --------------------------------------------------------------------------- */
(function (win, doc) {
  'use strict';
  var BREAK_TABLET = 1024;
  var BREAK_PHONE = 640;

  function detect() {
    var w = win.innerWidth || doc.documentElement.clientWidth || 0;
    var coarse = false, noHover = false;
    try {
      coarse = win.matchMedia('(pointer: coarse)').matches;
      noHover = win.matchMedia('(hover: none)').matches;
    } catch (e) { }
    var touch = ('ontouchstart' in win) || (navigator.maxTouchPoints || 0) > 1;
    var uaMobile = /Android|iPhone|iPad|iPod|Windows Phone|Mobile|Tablet|Silk/i.test(navigator.userAgent || '');
    var iPadOS = /Macintosh/.test(navigator.userAgent || '') && (navigator.maxTouchPoints || 0) > 1;
    var isTouchDevice = (coarse && noHover && touch) || uaMobile || iPadOS;
    var isMobile = isTouchDevice || w <= BREAK_TABLET;
    return { isMobile: isMobile, isPhone: isMobile && w <= BREAK_PHONE, isTablet: isMobile && w > BREAK_PHONE, width: w };
  }

  var dev = detect();
  win.MVDevice = dev;

  function applyClasses() {
    var r = doc.documentElement;
    r.classList.toggle('mv-mobile', dev.isMobile);
    r.classList.toggle('mv-phone', dev.isPhone);
    r.classList.toggle('mv-tablet', dev.isTablet);
  }
  applyClasses();

  /* Bọc mỗi <table> vào khung cuộn ngang trên mobile/tablet (danh sách link
     hỏng, tập phim trong admin) — không sửa gì khác trong bảng. */
  function wrapTables(root) {
    var scope = root && root.querySelectorAll ? root : doc;
    var tables = scope.querySelectorAll ? scope.querySelectorAll('table') : [];
    for (var i = 0; i < tables.length; i++) {
      var t = tables[i];
      if (t.parentNode && t.parentNode.classList && t.parentNode.classList.contains('mv-tablewrap')) continue;
      var w = doc.createElement('div');
      w.className = 'mv-tablewrap';
      t.parentNode.insertBefore(w, t);
      w.appendChild(t);
    }
  }
  function restructure(root) {
    if (!dev.isMobile) return;
    try { wrapTables(root); } catch (e) { }
  }
  function onReady(fn) { if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', fn); else fn(); }
  onReady(function () {
    restructure(doc);
    if (dev.isMobile && win.MutationObserver) {
      var queue = [], timer = null;
      new MutationObserver(function (list) {
        for (var i = 0; i < list.length; i++) {
          var added = list[i].addedNodes;
          for (var j = 0; j < added.length; j++) if (added[j].nodeType === 1) queue.push(added[j]);
        }
        if (queue.length && !timer) {
          timer = setTimeout(function () {
            timer = null;
            var batch = queue.splice(0, queue.length);
            for (var k = 0; k < batch.length; k++) restructure(batch[k]);
          }, 250);
        }
      }).observe(doc.body || doc.documentElement, { childList: true, subtree: true });
    }
  });

  var rsTimer = null;
  win.addEventListener('resize', function () {
    clearTimeout(rsTimer);
    rsTimer = setTimeout(function () {
      var before = dev.isMobile;
      var next = detect();
      dev.isMobile = next.isMobile; dev.isPhone = next.isPhone; dev.isTablet = next.isTablet; dev.width = next.width;
      applyClasses();
      if (!before && dev.isMobile) restructure(doc);
    }, 200);
  });
})(window, document);
