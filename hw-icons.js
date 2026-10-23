/* =============================================================================
   hw-icons.js — bộ icon SVG (hình vẽ nét line) cho web "Bài tập về nhà"
   -----------------------------------------------------------------------------
   - Toàn bộ icon là SVG nét đường viền (stroke), KHÔNG dùng emoji.
   - Mỗi tính năng có 1 tông pastel riêng (nền nhạt + nét đậm cùng tông).
   Cách dùng:
     HwIcon('calendar')                      -> chuỗi <svg> (dùng currentColor)
     HwIcon('calendar', {size:18})           -> đổi cỡ
     HwIcon.badge('calendar', 'sky')         -> ô vuông bo tròn nền pastel + icon
     HwIcon.badge('book', null, {color:'#8B7CF6'}) -> pastel tự sinh từ 1 màu bất kỳ
   ============================================================================= */
(function(){
  var P = {
    book:      '<path d="M3 5.2A1.7 1.7 0 0 1 4.7 3.5H9a3 3 0 0 1 3 3V20a2.4 2.4 0 0 0-2.4-2.4H4.7A1.7 1.7 0 0 1 3 15.9z"/><path d="M21 5.2a1.7 1.7 0 0 0-1.7-1.7H15a3 3 0 0 0-3 3V20a2.4 2.4 0 0 1 2.4-2.4h4.9a1.7 1.7 0 0 0 1.7-1.7z"/>',
    calendar:  '<rect x="3.5" y="5" width="17" height="15.5" rx="3.5"/><path d="M3.5 10.2h17"/><path d="M8 3v3.6M16 3v3.6"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 17.2h.01M12 17.2h.01"/>',
    pin:       '<path d="M12 21v-6"/><path d="M8.2 3.5h7.6l-1.1 5.3 2.8 2.9V14.2H6.5v-2.5l2.8-2.9z"/>',
    search:    '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
    home:      '<path d="M3.8 11.2 12 4l8.2 7.2"/><path d="M6 9.6V19a1.5 1.5 0 0 0 1.5 1.5h9A1.5 1.5 0 0 0 18 19V9.6"/><path d="M10 20.5v-5h4v5"/>',
    logout:    '<path d="M9.5 4H6.8A2.8 2.8 0 0 0 4 6.8v10.4A2.8 2.8 0 0 0 6.8 20h2.7"/><path d="M15 8l4 4-4 4"/><path d="M19 12H9.5"/>',
    login:     '<path d="M14.5 4h2.7A2.8 2.8 0 0 1 20 6.8v10.4a2.8 2.8 0 0 1-2.8 2.8h-2.7"/><path d="M9.5 8l4 4-4 4"/><path d="M13.5 12H4"/>',
    lock:      '<rect x="4.8" y="10.5" width="14.4" height="10" rx="3.2"/><path d="M8.3 10.5V8a3.7 3.7 0 0 1 7.4 0v2.5"/><path d="M12 14.6v2"/>',
    camera:    '<path d="M4 8.7A2.7 2.7 0 0 1 6.7 6h1l1.2-2h6.2l1.2 2h1A2.7 2.7 0 0 1 20 8.7v8.6a2.7 2.7 0 0 1-2.7 2.7H6.7A2.7 2.7 0 0 1 4 17.3z"/><circle cx="12" cy="13" r="3.6"/>',
    idcard:    '<rect x="3" y="5" width="18" height="14" rx="3.4"/><circle cx="9" cy="11" r="2"/><path d="M5.8 16.2c.7-1.5 1.8-2.2 3.2-2.2s2.5.7 3.2 2.2"/><path d="M14.5 10h3.8M14.5 13.6h2.6"/>',
    image:     '<rect x="3.5" y="4.5" width="17" height="15" rx="3.4"/><circle cx="9" cy="10" r="1.7"/><path d="M4 17.2l5-4.4 3.4 2.9 3-2.6 4.6 4"/>',
    stop:      '<rect x="6" y="6" width="12" height="12" rx="3.2"/>',
    text:      '<path d="M5 6.5h14"/><path d="M5 12h14"/><path d="M5 17.5h8.5"/>',
    table:     '<rect x="3.5" y="4.5" width="17" height="15" rx="4"/><path d="M3.5 10h17M3.5 15h17M9.5 4.5v15"/>',
    alert:     '<path d="M12 4.2 21 19.5H3z"/><path d="M12 10v4"/><path d="M12 16.9h.01"/>',
    check:     '<circle cx="12" cy="12" r="8.6"/><path d="M8.4 12.3l2.5 2.5 4.7-5.1"/>',
    clock:     '<circle cx="12" cy="12" r="8.6"/><path d="M12 7.4V12l3.1 2"/>',
    list:      '<path d="M8.5 6.5H20M8.5 12H20M8.5 17.5H20"/><path d="M4.2 6.5h.01M4.2 12h.01M4.2 17.5h.01"/>',
    close:     '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    refresh:   '<path d="M20 11.2A8 8 0 0 0 6 6.6L4.5 8.5"/><path d="M4.5 4v4.5H9"/><path d="M4 12.8A8 8 0 0 0 18 17.4l1.5-1.9"/><path d="M19.5 20v-4.5H15"/>',
    inbox:     '<path d="M4 13.2l2.1-6.8A2.2 2.2 0 0 1 8.2 4.8h7.6a2.2 2.2 0 0 1 2.1 1.6L20 13.2"/><path d="M4 13.2v4.3A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5v-4.3h-4.4a3.6 3.6 0 0 1-7.2 0z"/>',
    user:      '<circle cx="12" cy="8.5" r="3.6"/><path d="M4.8 20c.9-3.4 3.5-5.2 7.2-5.2s6.3 1.8 7.2 5.2"/>',
    shield:    '<path d="M12 3.5 5 6v5.6c0 4.2 2.8 7.3 7 8.9 4.2-1.6 7-4.7 7-8.9V6z"/><path d="M9 12l2.2 2.2L15.2 10"/>',
    pencil:    '<path d="M4.5 19.5l.9-4 9.9-9.9a2.1 2.1 0 0 1 3 3l-9.9 9.9z"/><path d="M13.6 7.4l3 3"/>',
    sparkle:   '<path d="M12 4l1.7 4.6L18.3 10l-4.6 1.4L12 16l-1.7-4.6L5.7 10l4.6-1.4z"/><path d="M18.5 16.5l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6z"/>'
  };

  /* Tông pastel cho từng tính năng: nền nhạt (bg) + nét đậm cùng tông (fg) */
  var TONES = {
    lavender: { bg:'#E9E4FF', fg:'#6C5CE7' },
    sky:      { bg:'#DCEEFF', fg:'#2F7FC2' },
    pink:     { bg:'#FFE0EA', fg:'#D1416B' },
    mint:     { bg:'#D8F5EB', fg:'#1B9878' },
    peach:    { bg:'#FFE6D0', fg:'#CC6F22' },
    lemon:    { bg:'#FFF1BF', fg:'#A88208' },
    coral:    { bg:'#FFDDD8', fg:'#D2574A' }
  };

  /* Icon nào mặc định dùng tông nào (mỗi tính năng 1 màu riêng) */
  var DEFAULT_TONE = {
    book:'peach', calendar:'sky', pin:'pink', search:'lemon', home:'lavender',
    logout:'coral', login:'lavender', lock:'lavender', camera:'sky', idcard:'mint',
    image:'peach', stop:'coral', text:'mint', table:'peach', alert:'coral',
    check:'mint', clock:'sky', list:'lavender', close:'coral', refresh:'sky',
    inbox:'lavender', user:'mint', shield:'mint', pencil:'lemon', sparkle:'lemon'
  };

  function svg(name, opts){
    opts = opts || {};
    var size = opts.size || 20;
    var sw = opts.stroke || 1.8;
    var body = P[name] || P.book;
    return '<svg class="hw-svg" xmlns="http://www.w3.org/2000/svg" width="'+size+'" height="'+size+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="'+sw+'" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'+body+'</svg>';
  }

  function hexToRgb(hex){
    var h = String(hex || '').replace('#','');
    if(h.length === 3) h = h.split('').map(function(c){ return c + c; }).join('');
    if(!/^[0-9a-fA-F]{6}$/.test(h)) return null;
    return { r:parseInt(h.slice(0,2),16), g:parseInt(h.slice(2,4),16), b:parseInt(h.slice(4,6),16) };
  }
  /* Từ 1 màu bất kỳ (VD màu tiêu đề admin chọn) sinh ra nền pastel + nét đậm */
  function toneFromColor(hex){
    var c = hexToRgb(hex);
    if(!c) return TONES.lavender;
    var mix = function(v, t){ return Math.round(v + (255 - v) * t); };
    return {
      bg: 'rgb('+mix(c.r,.84)+','+mix(c.g,.84)+','+mix(c.b,.84)+')',
      fg: hex
    };
  }

  /* Ô vuông bo tròn nền pastel chứa icon */
  function badge(name, tone, opts){
    opts = opts || {};
    var t = opts.color ? toneFromColor(opts.color) : (TONES[tone || DEFAULT_TONE[name] || 'lavender'] || TONES.lavender);
    var box = opts.box || 36;
    var size = opts.size || Math.round(box * 0.55);
    return '<span class="hw-ico" style="width:'+box+'px;height:'+box+'px;background:'+t.bg+';color:'+t.fg+'">'+svg(name, { size:size, stroke:opts.stroke })+'</span>';
  }

  svg.badge = badge;
  svg.tones = TONES;
  svg.names = Object.keys(P);
  svg.toneFromColor = toneFromColor;
  svg.hexToRgb = hexToRgb;
  window.HwIcon = svg;
})();
