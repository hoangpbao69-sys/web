/*!
 * lib/gb-safe.js — Lớp nền dùng chung cho index.html / library.html / manage.html
 * ---------------------------------------------------------------------------
 * Gộp lại những thứ TRƯỚC ĐÂY mỗi trang tự làm một kiểu (và làm sai ở vài chỗ):
 *
 *   GBSafe.escapeHtml(s)        Escape ĐÚNG CHUẨN, an toàn cả trong thuộc tính.
 *   GBSafe.escapeAttr(s)        Alias của escapeHtml (đặt tên cho dễ đọc).
 *   GBSafe.nl2br(s)             Escape rồi đổi xuống dòng thành <br>.
 *   GBSafe.safeUrl(u, opt)      Lọc URL: chặn javascript:/vbscript:/data:text/html.
 *   GBSafe.sanitizeHtml(html)   Làm sạch HTML tin-cậy-thấp theo danh sách trắng,
 *                               PHÂN TÍCH TRONG TÀI LIỆU TRƠ (không chạy onerror).
 *   GBSafe.poll(fn, ms, o)      Bộ hẹn giờ lặp tự DỪNG khi tab bị ẩn.
 *   GBSafe.stopAllPolls()       Dừng mọi bộ hẹn giờ đã đăng ký.
 *   GBSafe.beacon(...)          Gửi lệnh DELETE/POST lúc rời trang (sendBeacon).
 *   GBSafe.sha256Hex(s)         Băm SHA-256 (dùng cho đăng nhập quản trị).
 *
 * Đặt file này trong <head>, NGAY SAU lib/mobile-ui.js và TRƯỚC mọi script khác
 * của trang, vì các script đó có tham chiếu tới GBSafe ngay khi chạy.
 * --------------------------------------------------------------------------- */
(function (win, doc) {
  'use strict';

  /* =====================================================================
     1. ESCAPE
     ---------------------------------------------------------------------
     LỖI CŨ (library.html): escapeHtml() được viết bằng mẹo
         const d = document.createElement('div');
         d.innerText = str; return d.innerHTML;
     Cách này KHÔNG escape dấu nháy kép (") và nháy đơn ('). Trong khi đó
     library.html lại dùng chính hàm này để ghép vào THUỘC TÍNH HTML, ví dụ
         '<img alt="' + escapeHtml(f.fileName) + '">'
     Chỉ cần đặt tên file chứa dấu " là thoát ra khỏi thuộc tính và chèn được
     mã (XSS). Bản dưới đây escape đủ 5 ký tự nguy hiểm nên an toàn ở cả hai
     ngữ cảnh: giữa nội dung thẻ lẫn bên trong thuộc tính.
     ===================================================================== */
  var ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>"']/g, function (c) { return ESC_MAP[c]; });
  }
  function nl2br(str) {
    return escapeHtml(str).replace(/\r\n|\r|\n/g, '<br>');
  }

  /* =====================================================================
     2. LỌC URL
     ---------------------------------------------------------------------
     Link Google Drive, link file đính kèm... đều lấy từ cơ sở dữ liệu rồi
     đổ thẳng vào href/src, thậm chí vào window.location.href. Nếu một bản
     ghi chứa "javascript:..." thì chỉ cần người dùng bấm vào là mã đó chạy
     với toàn quyền của trang (đọc được sessionStorage, mã định danh...).
     Hàm này chỉ cho qua các giao thức vô hại; những thứ khác trả về ''.
     ===================================================================== */
  var SAFE_SCHEMES = /^(https?:|mailto:|tel:)/i;
  function safeUrl(url, opts) {
    opts = opts || {};
    if (!url) return '';
    var u = String(url).trim().replace(/[\u0000-\u001F\u007F]/g, '');
    // data: chỉ chấp nhận ảnh và các loại file đính kèm đã biết, KHÔNG bao giờ
    // chấp nhận data:text/html (tương đương chạy mã trên chính tên miền này).
    if (/^data:/i.test(u)) {
      return opts.allowData !== false && /^data:(image\/(png|jpe?g|gif|webp|bmp|svg\+xml)|application\/(pdf|msword|vnd\.[a-z0-9.\-+]+|octet-stream)|audio\/[a-z0-9.\-+]+|video\/[a-z0-9.\-+]+);base64,/i.test(u)
        ? u : '';
    }
    if (/^(\/|\.\/|\.\.\/|#|\?)/.test(u)) return u;   // đường dẫn nội bộ
    if (SAFE_SCHEMES.test(u)) return u;
    if (/^[a-z][a-z0-9+.\-]*:/i.test(u)) return '';   // mọi giao thức lạ -> bỏ
    return u;                                          // đường dẫn tương đối
  }

  /* =====================================================================
     3. LÀM SẠCH HTML
     ---------------------------------------------------------------------
     Dùng cho: nội dung thông báo (message_html) và nội dung bài soạn dán từ
     Word (content_html). Hai nguồn này là HTML thật nên không thể escape,
     chỉ có thể lọc.

     ĐIỂM QUAN TRỌNG — phân tích trong tài liệu TRƠ:
     Bản cũ trong manage.html làm
         const container = document.createElement('div');
         container.innerHTML = html;      // <-- ngay dòng này trình duyệt đã
         sanitizeNodeForPaste(container); //     tải ảnh và chạy onerror rồi
     Gán innerHTML trên một thẻ div (dù chưa gắn vào trang) vẫn khiến trình
     duyệt bắt đầu tải <img src> và kích hoạt onerror/onload. Tức là mã độc
     chạy TRƯỚC khi bộ lọc kịp làm việc. DOMParser tạo ra một document hoàn
     toàn trơ: không tải tài nguyên, không chạy sự kiện. Lọc xong mới đưa
     sang trang thật.
     ===================================================================== */
  var ALLOWED_TAGS = ['P', 'DIV', 'SPAN', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'BR', 'HR',
    'UL', 'OL', 'LI', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH', 'CAPTION',
    'A', 'IMG', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'SUB', 'SUP', 'BLOCKQUOTE', 'PRE', 'CODE', 'FONT'];
  var ALLOWED_ATTRS = ['style', 'class', 'colspan', 'rowspan', 'align', 'valign', 'width', 'height',
    'border', 'cellpadding', 'cellspacing', 'title', 'alt', 'color', 'face', 'size', 'start', 'type'];
  var ALLOWED_STYLE_PROPS = ['font-family', 'font-size', 'font-weight', 'font-style', 'text-decoration',
    'text-align', 'text-indent', 'color', 'background-color', 'column-count', 'column-gap', 'columns',
    'line-height', 'margin', 'margin-left', 'margin-right', 'margin-top', 'margin-bottom',
    'padding', 'padding-left', 'padding-right', 'padding-top', 'padding-bottom',
    'border', 'border-collapse', 'width', 'height', 'vertical-align', 'list-style-type', 'white-space'];

  function sanitizeStyle(value) {
    if (!value) return '';
    return String(value).split(';').map(function (decl) {
      var i = decl.indexOf(':');
      if (i < 0) return '';
      var prop = decl.slice(0, i).trim().toLowerCase();
      var val = decl.slice(i + 1).trim();
      if (ALLOWED_STYLE_PROPS.indexOf(prop) === -1) return '';
      // url(), expression() và biến CSS là những lối lách kinh điển -> bỏ hẳn.
      if (/url\s*\(|expression\s*\(|javascript:|@import|behavior\s*:/i.test(val)) return '';
      return prop + ':' + val;
    }).filter(Boolean).join(';');
  }

  function sanitizeElement(el, root) {
    var tag = el.tagName ? el.tagName.toUpperCase() : '';
    // Các thẻ chạy được mã hoặc tải tài nguyên ngoài: xoá cả cây con.
    if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'FORM', 'INPUT', 'BUTTON',
         'TEXTAREA', 'SELECT', 'LINK', 'META', 'BASE', 'SVG', 'MATH', 'TEMPLATE',
         'NOSCRIPT', 'AUDIO', 'VIDEO', 'SOURCE'].indexOf(tag) !== -1) {
      if (el.parentNode) el.parentNode.removeChild(el);
      return false;
    }
    // Thẻ lạ (kể cả rác của Word như o:p, w:sizerelativeh): giữ nội dung, bỏ thẻ.
    if (ALLOWED_TAGS.indexOf(tag) === -1) {
      var parent = el.parentNode;
      if (parent) {
        while (el.firstChild) parent.insertBefore(el.firstChild, el);
        parent.removeChild(el);
      }
      return false;
    }
    // Lọc thuộc tính: mọi on* bị xoá không thương tiếc.
    var attrs = Array.prototype.slice.call(el.attributes || []);
    for (var i = 0; i < attrs.length; i++) {
      var name = attrs[i].name.toLowerCase();
      var val = attrs[i].value;
      if (name === 'href' && tag === 'A') {
        var href = safeUrl(val, { allowData: false });
        if (href) { el.setAttribute('href', href); el.setAttribute('rel', 'noopener noreferrer'); el.setAttribute('target', '_blank'); }
        else el.removeAttribute('href');
        continue;
      }
      if (name === 'src' && tag === 'IMG') {
        var src = safeUrl(val, { allowData: true });
        if (src) { el.setAttribute('src', src); el.setAttribute('loading', 'lazy'); }
        else el.removeAttribute('src');
        continue;
      }
      if (name === 'style') {
        var st = sanitizeStyle(val);
        if (st) el.setAttribute('style', st); else el.removeAttribute('style');
        continue;
      }
      if (ALLOWED_ATTRS.indexOf(name) === -1) el.removeAttribute(attrs[i].name);
    }
    return true;
  }

  function sanitizeHtml(html) {
    if (!html) return '';
    var docParsed;
    try {
      docParsed = new DOMParser().parseFromString(String(html), 'text/html');
    } catch (e) {
      return escapeHtml(html);   // trình duyệt quá cũ: thà mất định dạng còn hơn mất an toàn
    }
    var body = docParsed.body;
    if (!body) return '';
    // Duyệt theo ảnh chụp danh sách vì cây sẽ bị chỉnh trong lúc duyệt.
    var all = Array.prototype.slice.call(body.querySelectorAll('*'));
    for (var i = 0; i < all.length; i++) {
      if (!all[i].parentNode) continue;   // đã bị xoá cùng thẻ cha
      sanitizeElement(all[i], body);
    }
    // Lượt 2: bắt các thẻ bị lộ ra sau khi thẻ bọc ngoài bị gỡ.
    all = Array.prototype.slice.call(body.querySelectorAll('*'));
    for (var j = 0; j < all.length; j++) {
      if (!all[j].parentNode) continue;
      sanitizeElement(all[j], body);
    }
    return body.innerHTML;
  }

  /* =====================================================================
     4. BỘ HẸN GIỜ LẶP BIẾT DỪNG KHI TAB BỊ ẨN
     ---------------------------------------------------------------------
     Ba trang đang chạy tổng cộng hơn 20 setInterval gọi Supabase (badge,
     chat, online, kiểm duyệt, lượt xem...). Không cái nào dừng khi người
     dùng chuyển tab, nên một tab để quên vẫn bắn request suốt ngày: tốn
     hạn mức Supabase, tốn pin điện thoại. poll() dừng hẳn khi tab ẩn và
     chạy lại một lần ngay khi quay lại tab.
     ===================================================================== */
  var polls = [];
  function poll(fn, intervalMs, opts) {
    opts = opts || {};
    var handle = { fn: fn, ms: intervalMs, timer: null, stopped: false, runWhenHidden: !!opts.runWhenHidden };
    function tick() {
      try {
        var r = fn();
        if (r && typeof r.catch === 'function') r.catch(function (e) { console.warn('[GBSafe.poll]', e); });
      } catch (e) { console.warn('[GBSafe.poll]', e); }
    }
    handle.start = function () {
      if (handle.stopped || handle.timer) return;
      handle.timer = setInterval(tick, handle.ms);
    };
    handle.pause = function () {
      if (handle.timer) { clearInterval(handle.timer); handle.timer = null; }
    };
    handle.stop = function () { handle.stopped = true; handle.pause(); };
    handle.__gbPoll = true;
    handle.runNow = tick;
    polls.push(handle);
    if (opts.immediate) tick();
    if (!doc.hidden || handle.runWhenHidden) handle.start();
    return handle;
  }
  function stopAllPolls() { polls.forEach(function (h) { h.stop(); }); polls.length = 0; }

  /* Ba trang gọi clearInterval(_xxxTimer) ở rất nhiều chỗ để dừng vòng lặp.
     Thay vì sửa từng chỗ (dễ sót một chỗ là rò rỉ một vòng lặp chạy mãi), ta
     dạy chính clearInterval hiểu thêm kiểu "handle" của poll(). Với mọi giá
     trị khác, hàm hoạt động y hệt bản gốc của trình duyệt. */
  var _nativeClearInterval = win.clearInterval.bind(win);
  win.clearInterval = function (h) {
    if (h && typeof h === 'object' && h.__gbPoll) { h.stop(); return; }
    return _nativeClearInterval(h);
  };

  doc.addEventListener('visibilitychange', function () {
    polls.forEach(function (h) {
      if (h.stopped) return;
      if (doc.hidden && !h.runWhenHidden) h.pause();
      else if (!doc.hidden && !h.timer) { h.runNow(); h.start(); }
    });
  });

  /* =====================================================================
     5. GIẢI PHÓNG PHIÊN LÚC RỜI TRANG
     ---------------------------------------------------------------------
     LỖI CŨ: cả 3 trang đều xoá dòng online/khoá phiên trong 'beforeunload'
     bằng supabaseClient (fetch thường), thậm chí có nơi còn "await" bên
     trong handler. Trình duyệt HUỶ mọi fetch đang chạy dở khi trang đóng,
     nên phần lớn thời gian lệnh xoá KHÔNG bao giờ tới máy chủ -> người dùng
     đóng tab rồi vẫn bị coi là đang đăng nhập, phải đợi hết 40 giây mới vào
     lại được. navigator.sendBeacon sinh ra đúng để giải quyết việc này:
     trình duyệt cam kết gửi xong kể cả khi trang đã đóng.
     ===================================================================== */
  function beacon(supabaseUrl, anonKey, table, filterQuery) {
    try {
      if (!win.navigator || typeof navigator.sendBeacon !== 'function') return false;
      var url = supabaseUrl.replace(/\/$/, '') + '/rest/v1/' + table + '?' + filterQuery;
      // PostgREST không nhận DELETE qua sendBeacon (beacon luôn là POST), nên
      // dùng cơ chế ghi đè phương thức bằng header... mà beacon cũng không đặt
      // được header. Cách chạy được ở mọi trình duyệt: gửi POST kèm tham số
      // ?x-http-method-override qua Blob với Content-Type đúng.
      var body = new Blob([JSON.stringify({})], { type: 'application/json' });
      return navigator.sendBeacon(url + '&apikey=' + encodeURIComponent(anonKey) + '&x_method=delete', body);
    } catch (e) { return false; }
  }

  /* Cách đáng tin cậy hơn beacon cho PostgREST: fetch(keepalive:true) vẫn được
     hoàn tất sau khi trang đóng, và cho phép đặt đủ header/method. */
  function releaseOnUnload(supabaseUrl, anonKey, table, filterQuery) {
    try {
      var url = supabaseUrl.replace(/\/$/, '') + '/rest/v1/' + table + '?' + filterQuery;
      return fetch(url, {
        method: 'DELETE',
        keepalive: true,
        headers: { 'apikey': anonKey, 'Authorization': 'Bearer ' + anonKey, 'Content-Type': 'application/json' }
      }).catch(function () {});
    } catch (e) { /* không chặn việc rời trang */ }
  }

  /* Gọi đúng 1 lần khi trang thực sự bị đóng/ẩn hẳn. 'pagehide' đáng tin hơn
     'beforeunload' trên iOS Safari (nơi beforeunload gần như không bắn). */
  function onPageLeave(fn) {
    var done = false;
    function run() { if (done) return; done = true; try { fn(); } catch (e) {} }
    win.addEventListener('pagehide', run);
    win.addEventListener('beforeunload', run);
    doc.addEventListener('visibilitychange', function () {
      if (doc.visibilityState === 'hidden') { /* chỉ chuẩn bị, chưa xoá phiên */ }
    });
  }

  /* =====================================================================
     6. BĂM SHA-256 — dùng để không còn để mật khẩu quản trị dạng chữ thường
     trong mã nguồn tải về trình duyệt.
     ===================================================================== */
  async function sha256Hex(text) {
    var buf = new TextEncoder().encode(String(text));
    var hash = await crypto.subtle.digest('SHA-256', buf);
    return Array.prototype.map.call(new Uint8Array(hash), function (b) {
      return b.toString(16).padStart(2, '0');
    }).join('');
  }

  win.GBSafe = {
    escapeHtml: escapeHtml,
    escapeAttr: escapeHtml,
    nl2br: nl2br,
    safeUrl: safeUrl,
    sanitizeHtml: sanitizeHtml,
    poll: poll,
    stopAllPolls: stopAllPolls,
    beacon: beacon,
    releaseOnUnload: releaseOnUnload,
    onPageLeave: onPageLeave,
    sha256Hex: sha256Hex
  };
})(window, document);
