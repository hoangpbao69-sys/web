/* movie-icons.js — bộ icon SVG nét vẽ (stroke) dùng chung cho Thư Viện Phim.
   Gọi Icon('tên', 'class-phụ') để lấy chuỗi <svg>...</svg>, chèn thẳng vào template string. */
(function () {
  'use strict';
  var P = {
    menu: 'M4 7h16M4 12h16M4 17h16',
    close: 'M6 6l12 12M18 6L6 18',
    search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm9 2-4.35-4.35',
    sun: 'M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6 4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4|M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
    moon: 'M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z',
    home: 'M4 11.5 12 4l8 7.5|M6 10v9a1 1 0 0 0 1 1h3v-6h4v6h3a1 1 0 0 0 1-1v-9',
    chevronDown: 'M6 9l6 6 6-6',
    chevronLeft: 'M15 5 8 12l7 7',
    chevronRight: 'M9 5l7 7-7 7',
    play: 'M7 4.5v15l13-7.5-13-7.5Z',
    heart: 'M12 20.7 4.4 13a5.2 5.2 0 0 1 7.6-7 5.2 5.2 0 0 1 7.6 7L12 20.7Z',
    link: 'M9 15 15 9|M9.5 6.5l1.8-1.8a4 4 0 0 1 5.6 5.6L15 12.2|M14.5 17.5l-1.8 1.8a4 4 0 0 1-5.6-5.6L9 12',
    edit: 'M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5.5 16.5 4 20Z|M14.5 5.5l4 4',
    alert: 'M12 3 2 20h20L12 3Z|M12 10v5|M12 18h.01',
    star: 'M12 3.5l2.6 5.4 5.9.8-4.3 4.2 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.2 5.9-.8L12 3.5Z',
    logout: 'M10 17l5-5-5-5|M15 12H3|M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4',
    refresh: 'M4 12a8 8 0 0 1 14.6-4.6M20 12a8 8 0 0 1-14.6 4.6|M18.5 3v5h-5|M5.5 21v-5h5',
    plus: 'M12 5v14M5 12h14',
    film: 'M3 5h18v14H3z|M7 5v14|M17 5v14|M3 9h4|M3 15h4|M17 9h4|M17 15h4',
    layers: 'M12 3 3 8l9 5 9-5-9-5Z|M3 14l9 5 9-5|M3 11l9 5 9-5',
    globe: 'M12 3a15 15 0 0 1 0 18|M12 3a15 15 0 0 0 0 18|M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z|M3.5 9h17|M3.5 15h17',
    trash: 'M4 7h16|M10 11v6|M14 11v6|M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13|M9 7V4h6v3',
    eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z|M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
    eyeOff: 'M3 3l18 18|M10.6 5.6A10 10 0 0 1 21.5 12s-1 1.8-3 3.5M6.6 6.6C4.4 8.1 2.5 12 2.5 12S6 18.5 12 18.5c1.4 0 2.7-.3 3.9-.9|M9.5 9.6a3 3 0 0 0 4.2 4.2',
    calendar: 'M4 9h16|M7 3v4|M17 3v4|M4.5 5h15A1.5 1.5 0 0 1 21 6.5v13A1.5 1.5 0 0 1 19.5 21h-15A1.5 1.5 0 0 1 3 19.5v-13A1.5 1.5 0 0 1 4.5 5Z',
    check: 'M4 12.5 9 18l11-13',
    x: 'M6 6l12 12M18 6L6 18',
    userIdent: 'M3 20a9 9 0 0 1 18 0|M12 13a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Z',
    server: 'M3 4.5h18v6H3z|M3 13.5h18v6H3z|M7 7.5h.01|M7 16.5h.01',
    upload: 'M12 16V4|M7 9l5-5 5 5|M4 16.5v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3',
    external: 'M14 4h6v6|M20 4 10 14|M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6',
    list: 'M8 6h13|M8 12h13|M8 18h13|M3.5 6h.01|M3.5 12h.01|M3.5 18h.01',
    grid: 'M4 4h6.5v6.5H4z|M13.5 4H20v6.5h-6.5z|M4 13.5h6.5V20H4z|M13.5 13.5H20V20h-6.5z',
    clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z|M12 7.5V12l3 2',
    idcard: 'M4.5 5.5h15a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z|M8.5 11.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z|M5.5 16c.6-1.6 1.7-2.4 3-2.4s2.4.8 3 2.4|M14.5 10h4|M14.5 13.5h3',
    arrowRight: 'M5 12h14|M13 6l6 6-6 6',
    arrowLeft: 'M19 12H5|M11 6l-6 6 6 6',
    arrowUp: 'M12 19V5|M6 11l6-6 6 6',
    arrowDown: 'M12 5v14|M6 13l6 6 6-6'
  };
  window.Icon = function (name, cls, size) {
    var d = P[name]; if (!d) return '';
    var s = size || 18;
    var paths = d.split('|').map(function (seg) { return '<path d="' + seg + '"/>'; }).join('');
    return '<svg class="ic' + (cls ? ' ' + cls : '') + '" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
  };
})();
