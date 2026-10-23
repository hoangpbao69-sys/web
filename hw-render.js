/* =============================================================================
   hw-render.js — dựng thẻ "Bài tập về nhà" (DÙNG CHUNG cho homework.html và
   phần Xem trước trong manage.html, nên 2 nơi luôn giống hệt nhau).
   -----------------------------------------------------------------------------
   Đối tượng bài tập (post):
     { title, title_color, homework_date:'YYYY-MM-DD', is_pinned,
       images:[{url,caption}], attached_posts:[{id,title,driveLink,kind,external}],
       kind:'text'|'table', content_html, content_table:{cells:[[môn, ô2, ô3...]]},
       note_html: ghi chú (HTML, tuỳ chọn) - hiện thành khung "Ghi chú" ở cuối thẻ }
   API:
     HwRender.cardHtml(post, HwIcon) -> chuỗi HTML của 1 thẻ
     HwRender.fmtDate('2026-09-28')  -> "Thứ Hai, 28/09/2026"
     HwRender.sanitize(html)         -> làm sạch HTML soạn thảo (bỏ script/onXXX...)
   ============================================================================= */
(function(){
  var DOW = ['Chủ Nhật','Thứ Hai','Thứ Ba','Thứ Tư','Thứ Năm','Thứ Sáu','Thứ Bảy'];

  function esc(s){
    if(s === null || s === undefined) return '';
    return String(s).replace(/[&<>"']/g, function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }
  function parseIso(iso){
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    if(!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3]);   // dựng theo giờ địa phương -> không lệch ngày
  }
  function fmtShort(iso){
    var d = parseIso(iso);
    if(!d) return '';
    return ('0'+d.getDate()).slice(-2) + '/' + ('0'+(d.getMonth()+1)).slice(-2) + '/' + d.getFullYear();
  }
  function fmtDate(iso){
    var d = parseIso(iso);
    if(!d) return '';
    return DOW[d.getDay()] + ', ' + fmtShort(iso);
  }

  /* Làm sạch HTML do admin soạn (giữ định dạng, bỏ mọi thứ chạy được mã) */
  function sanitize(html){
    if(!html) return '';
    var doc = new DOMParser().parseFromString('<div id="hwroot">' + html + '</div>', 'text/html');
    var root = doc.getElementById('hwroot');
    if(!root) return '';
    root.querySelectorAll('script,style,iframe,object,embed,link,meta,base,form,input,button,textarea,select').forEach(function(n){ n.remove(); });
    root.querySelectorAll('*').forEach(function(el){
      Array.prototype.slice.call(el.attributes).forEach(function(a){
        var n = a.name.toLowerCase(), v = a.value;
        if(n.indexOf('on') === 0){ el.removeAttribute(a.name); return; }
        if((n === 'href' || n === 'src' || n === 'xlink:href') && /^\s*(javascript|vbscript|data:text\/html)/i.test(v)) el.removeAttribute(a.name);
      });
      if(el.tagName === 'A'){ el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener noreferrer'); }
    });
    return root.innerHTML;
  }

  function subjBadge(name){
    if(!name) return '<span class="subj-badge subj-empty">—</span>';
    var c = (window.hwSubjectColor ? window.hwSubjectColor(name) : '#A9A6BD');
    return '<span class="subj-badge" style="background:'+c+'">'+esc(name)+'</span>';
  }

  /* Ô bảng: hỗ trợ xuống dòng + định dạng (B/I/U, màu). Dữ liệu cũ là chữ thường -> vẫn hiển thị đúng */
  function cellHtml(v){
    v = (v === null || v === undefined) ? '' : String(v);
    var html = /<[a-z!\/][^>]*>/i.test(v) ? sanitize(v) : esc(v).replace(/\r?\n/g, '<br>');
    var blank = !html.replace(/<[^>]*>/g, '').replace(/&nbsp;|\s/g, '') && !/<img/i.test(html);
    return blank ? '' : html;
  }
  function tableHtml(t){
    var rows = (t && t.cells) || [];
    if(!rows.length) return '<div class="hw-empty-note">Bảng chưa có nội dung.</div>';
    var body = rows.map(function(r){
      var tds = '<td class="subj-cell">' + subjBadge(r[0]) + '</td>';
      for(var i = 1; i < r.length; i++){
        tds += '<td class="detail-cell">' + (cellHtml(r[i]) || '<span class="hw-dash">–</span>') + '</td>';
      }
      return '<tr>' + tds + '</tr>';
    }).join('');
    return '<div class="hw-tbl-wrap"><table class="hw-table"><tbody>' + body + '</tbody></table></div>';
  }


  /* ---------- Ảnh + tài liệu đính kèm (giống thông báo chung ở index.html) ---------- */
  function safeUrl(u, allowData){
    u = String(u || '').trim();
    if(/^https?:\/\//i.test(u)) return u;
    if(allowData && /^data:image\//i.test(u)) return u;
    if(/^(library|index|homework)\.html(\?|$)/i.test(u)) return u;
    return '';
  }
  var ATTACH_KIND = { pdf:'PDF', baisoan:'Bài Soạn Thư Viện', link:'Link', video:'Video' };
  function attachKindHtml(kind){
    if(!kind || !ATTACH_KIND[kind]) return '';
    return '<span class="kind k-' + kind + '">' + ATTACH_KIND[kind] + '</span>';
  }
  function getImages(post){
    var arr = Array.isArray(post.images) ? post.images : [];
    return arr.filter(function(im){ return im && im.url; });
  }
  function imagesHtml(post){
    var imgs = getImages(post);
    if(!imgs.length) return '';
    if(window.NoticeGallery && typeof window.NoticeGallery.html === 'function'){
      var h = '';
      try{ h = window.NoticeGallery.html(imgs); }catch(e){ h = ''; }
      // ảnh xem trước (data:) có thể bị thư viện lọc mất -> quay về dải ảnh nhỏ
      var needData = /^data:/i.test(imgs[0].url);
      if(h && (!needData || h.indexOf('data:image') !== -1)) return h;
    }
    return '<div class="hw-imgs">' + imgs.map(function(im){
      var u = safeUrl(im.url, true);
      return u ? '<img src="' + esc(u) + '" alt="" loading="lazy">' : '';
    }).join('') + '</div>';
  }
  function attachHtml(post, Icon){
    var list = Array.isArray(post.attached_posts) ? post.attached_posts : [];
    if(!list.length) return '';
    var docIco = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1F5FA8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="8" y1="13" x2="16" y2="13"></line><line x1="8" y1="17" x2="13" y2="17"></line></svg>';
    var pin = Icon.badge('pin', 'pink', { box:20, size:12 });
    return '<div class="hw-attach-box"><div class="attach-heading">' + docIco + ' Tài liệu đính kèm (<span class="cnt">' + list.length + '</span>):</div>'
      + list.map(function(a){
        var title = esc(a.title || 'Xem tài liệu đính kèm');
        if(a.driveLink){
          var u = safeUrl(a.driveLink);
          return '<a class="hw-attach"' + (u ? ' href="' + esc(u) + '" target="_blank" rel="noopener noreferrer"' : '') + '><span class="pin">' + pin + '</span><span class="lbl">' + title + '</span>' + attachKindHtml(a.kind) + '</a>';
        }
        return '<a class="hw-attach" href="library.html?id=' + encodeURIComponent(a.id) + '"><span class="pin">' + pin + '</span><span class="lbl">' + title + '</span>' + attachKindHtml(a.kind || 'baisoan') + '</a>';
      }).join('') + '</div>';
  }

  /* ---------- Ghi chú (tuỳ chọn): khung riêng ở cuối thẻ ---------- */
  function noteBodyHtml(post){
    var clean = sanitize(post.note_html || '');
    var blank = !clean.replace(/<[^>]*>/g, '').replace(/&nbsp;|[\u200B\s]/g, '');
    return blank ? '' : clean;
  }
  function noteHtml(post, Icon){
    var clean = noteBodyHtml(post);
    if(!clean) return '';
    return '<div class="hw-note-box"><div class="hw-note-heading">' + Icon.badge('pencil', 'lemon', { box:24, size:14 }) + 'Ghi chú</div>'
      + '<div class="hw-text hw-note-text">' + clean + '</div></div>';
  }

  function cardHtml(post, Icon){
    Icon = Icon || window.HwIcon;
    post = post || {};
    var accent = /^#[0-9a-fA-F]{6}$/.test(post.title_color || '') ? post.title_color : '#8B7CF6';
    var rgb = Icon.hexToRgb(accent) || { r:139, g:124, b:246 };
    var tint = 'rgba('+rgb.r+','+rgb.g+','+rgb.b+',.10)';
    var isTable = post.kind === 'table';
    var body;
    if(isTable){
      body = tableHtml(post.content_table);
    } else {
      var clean = sanitize(post.content_html || '');
      var isBlank = !clean.replace(/<[^>]*>/g, '').replace(/&nbsp;|\s/g, '') && !/<img/i.test(clean);
      var hasMedia = getImages(post).length || (Array.isArray(post.attached_posts) && post.attached_posts.length) || noteBodyHtml(post);
      body = isBlank ? (hasMedia ? '' : '<div class="hw-empty-note">Chưa có nội dung.</div>') : '<div class="hw-text">' + clean + '</div>';
    }
    var dateLine = post.homework_date
      ? '<div class="hw-meta">' + Icon.badge('calendar', 'sky', { box:24, size:14 })
          + '<span>Bài tập về nhà ngày <b>' + esc(fmtShort(post.homework_date)) + '</b> · ' + esc(DOW[(parseIso(post.homework_date) || new Date()).getDay()]) + '</span></div>'
      : '';
    var pin = post.is_pinned
      ? '<span class="hw-chip hw-chip-pin">' + Icon.badge('pin', 'pink', { box:22, size:13 }) + 'Đã ghim</span>' : '';
    var kind = '<span class="hw-chip hw-chip-kind">' + Icon.badge(isTable ? 'table' : 'text', isTable ? 'peach' : 'mint', { box:22, size:13 }) + (isTable ? 'Dạng bảng' : 'Dạng chữ') + '</span>';
    return '<article class="hw-card" style="--hw-accent:'+accent+';--hw-tint:'+tint+'">'
      + '<div class="hw-head">'
      +   Icon.badge('book', null, { color:accent, box:42, size:22 })
      +   '<div class="hw-head-main"><h3 class="hw-title">' + esc(post.title || '(Chưa có tiêu đề)') + '</h3>' + dateLine + '</div>'
      +   '<div class="hw-chips">' + pin + kind + '</div>'
      + '</div>'
      + '<div class="hw-body">' + body + imagesHtml(post) + attachHtml(post, Icon) + noteHtml(post, Icon) + '</div>'
      + '</article>';
  }

  var CSS = [
    '.hw-ico{display:inline-flex;align-items:center;justify-content:center;border-radius:12px;flex:none}',
    '.hw-svg{display:block}',
    '.hw-card{background:var(--card,#fff);border:1.5px solid var(--border,#EFEBFB);border-radius:24px;overflow:hidden;margin-bottom:16px;box-shadow:0 8px 22px -12px rgba(139,124,246,.4);text-align:left}',
    '.hw-card .hw-head{display:flex;align-items:center;gap:12px;padding:14px 18px;background:var(--hw-tint,rgba(139,124,246,.1));border-bottom:1.5px solid var(--border,#EFEBFB);flex-wrap:wrap}',
    '.hw-card .hw-head-main{flex:1;min-width:0}',
    '.hw-card .hw-title{font-family:"Baloo 2","Mali",sans-serif;font-weight:800;font-size:18px;line-height:1.25;color:var(--hw-accent,#8B7CF6);word-break:break-word;margin:0}',
    '.hw-card .hw-meta{display:flex;align-items:center;gap:7px;margin-top:5px;font-size:12.5px;color:var(--text-soft,#8B87A3);font-weight:600}',
    '.hw-card .hw-meta b{color:var(--text,#4A4560)}',
    '.hw-card .hw-chips{display:flex;gap:6px;flex-wrap:wrap}',
    '.hw-card .hw-chip{display:inline-flex;align-items:center;gap:6px;padding:3px 10px 3px 3px;border-radius:999px;background:var(--card,#fff);border:1.5px solid var(--border,#EFEBFB);font-size:11.5px;font-weight:700;color:var(--text-soft,#8B87A3);white-space:nowrap}',
    '.hw-card .hw-chip .hw-ico{border-radius:999px}',
    '.hw-card .hw-body{padding:16px 18px 18px}',
    '.hw-card .hw-text{line-height:1.75;color:var(--text,#4A4560);font-size:14.5px;word-break:break-word;overflow-wrap:anywhere}',
    '.hw-card .hw-text img{max-width:100%;height:auto;border-radius:12px}',
    '.hw-card .hw-text a{color:#6C5CE7;text-decoration:underline}',
    '.hw-card .hw-text table{max-width:100%;border-collapse:collapse}',
    '.hw-card .hw-text .rte-col-2{column-count:2;column-gap:28px}',
    '.hw-card .hw-text .rte-col-3{column-count:3;column-gap:24px}',
    '.hw-card .hw-text .rte-col-4{column-count:4;column-gap:20px}',
    '@media(max-width:640px){.hw-card .hw-text .rte-col-2,.hw-card .hw-text .rte-col-3,.hw-card .hw-text .rte-col-4{column-count:1}}',
    '.hw-card .hw-text .rte-line:not([data-marker="number"]){counter-reset:rteNum 0}',
    '.hw-card .hw-text .rte-line[data-marker="number"]{counter-increment:rteNum}',
    '.hw-card .hw-text .rte-line[data-marker="number"]::before{content:counter(rteNum) ". ";font-weight:700}',
    '.hw-card .hw-text .rte-line[data-marker="dash"]::before{content:"- "}',
    '.hw-card .hw-text .rte-line[data-marker="plus"]{padding-left:22px}',
    '.hw-card .hw-text .rte-line[data-marker="plus"]::before{content:"+ "}',
    '.hw-card .hw-text .rte-line[data-marker="icon"]::before{content:attr(data-icon) " "}',
    /* ảnh (dự phòng khi chưa có notice-gallery) + tài liệu đính kèm: y hệt thông báo chung ở index */
    '.hw-card .hw-imgs{display:flex;gap:8px;overflow-x:auto;margin-top:10px;padding-bottom:2px}',
    '.hw-card .hw-imgs img{height:92px;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,.12);flex-shrink:0}',
    '.hw-card .hw-attach-box{margin-top:14px;padding:14px 16px;border-radius:16px;position:relative;background:#EAF4FE;border:1.5px solid #CFE3FB}',
    '.hw-card .hw-attach-box .attach-heading{font-weight:800;font-size:13.5px;color:#1F5FA8;margin-bottom:9px}',
    '.hw-card .hw-attach-box .attach-heading svg{vertical-align:-3px;margin-right:5px}',
    '.hw-card .hw-attach-box .attach-heading .cnt{font-weight:800;color:#1F5FA8}',
    '.hw-card .hw-attach{display:flex;align-items:center;gap:7px;padding:5px 0;color:#2D74C4;font-size:13.5px;font-weight:800;text-decoration:none;transition:color .18s ease,transform .18s ease}',
    '.hw-card .hw-attach:hover{color:#F45C86;transform:translateX(2px)}',
    '.hw-card .hw-attach .pin{flex-shrink:0;display:inline-flex}',
    '.hw-card .hw-attach .lbl{text-decoration:underline;text-underline-offset:2px;word-break:break-word}',
    '.hw-card .hw-attach .kind{display:inline-flex;align-items:center;padding:1px 8px;border-radius:999px;font-size:10.5px;font-weight:800;text-decoration:none;letter-spacing:.2px;flex-shrink:0}',
    '.hw-card .hw-attach .kind.k-pdf{background:#FFE0E0;color:#C62828}',
    '.hw-card .hw-attach .kind.k-baisoan{background:#EDE7F6;color:#5E35B1}',
    '.hw-card .hw-attach .kind.k-link{background:#E3F2FD;color:#1565C0}',
    '.hw-card .hw-attach .kind.k-video{background:#FFF3E0;color:#EF6C00}',
    /* khung Ghi chú */
    '.hw-card .hw-note-box{margin-top:14px;padding:12px 16px 14px;border-radius:16px;background:#FFFAE6;border:1.5px dashed #F2D45C}',
    '.hw-card .hw-note-heading{display:flex;align-items:center;gap:8px;font-weight:800;font-size:13.5px;color:#A88208;margin-bottom:6px}',
    '.hw-card .hw-note-text{font-size:14px;line-height:1.7}',
    /* nút "Xem thêm ..." giống index */
    '.notice-more-btn{display:block;margin:4px auto 0;padding:11px 26px;border-radius:999px;background:#fff;border:2px solid #FF8FAB;color:#F45C86;font-family:"Mali",sans-serif;font-weight:700;font-size:14px;cursor:pointer;box-shadow:0 4px 14px -4px rgba(244,92,134,.35);transition:transform .18s ease,background .18s ease,color .18s ease}',
    '.notice-more-btn:hover{background:#FF8FAB;color:#fff;transform:translateY(-2px)}',
    '.notice-more-btn.collapse-mode{border-color:#8B87A3;color:#8B87A3;box-shadow:none}',
    '.notice-more-btn.collapse-mode:hover{background:#8B87A3;color:#fff}',
    '.notice-old{display:none}',
    '.notice-old.show{display:block;margin-top:2px}',
    /* bảng bo góc tròn */
    '.hw-card .hw-tbl-wrap{border:1.5px solid var(--border,#E4DEFB);border-radius:20px;overflow:hidden;background:var(--card,#fff)}',
    '.hw-card .hw-table{width:100%;border-collapse:separate;border-spacing:0}',
    '.hw-card .hw-table td{padding:10px 14px;vertical-align:middle;border-top:1.5px solid var(--border,#E4DEFB);font-size:14px;color:var(--text,#4A4560);line-height:1.55;word-break:break-word}',
    '.hw-card .hw-table tr:first-child td{border-top:0}',
    '.hw-card .hw-table td + td{border-left:1.5px solid var(--border,#E4DEFB)}',
    '.hw-card .hw-table td.subj-cell{width:1%;padding:9px 10px;border-right:0}',
    '.hw-card .subj-badge{display:flex;align-items:center;justify-content:center;min-width:118px;padding:9px 14px;border-radius:14px;color:#fff;font-weight:700;font-size:13px;line-height:1.25;text-align:center;white-space:nowrap;text-shadow:0 1px 2px rgba(0,0,0,.22);box-shadow:0 4px 10px -5px rgba(0,0,0,.35)}',
    '.hw-card .subj-badge.subj-empty{background:var(--bg2,#F1F0FE);color:var(--text-soft,#8B87A3);text-shadow:none;box-shadow:none}',
    '.hw-card .hw-table td.detail-cell div,.hw-card .hw-table td.detail-cell p{margin:0}',
    '.hw-card .hw-table td.detail-cell{counter-reset:rteNum}',
    '.hw-card .hw-table .rte-line:not([data-marker="number"]){counter-reset:rteNum 0}',
    '.hw-card .hw-table .rte-line[data-marker="number"]{counter-increment:rteNum}',
    '.hw-card .hw-table .rte-line[data-marker="number"]::before{content:counter(rteNum) ". ";font-weight:700}',
    '.hw-card .hw-table .rte-line[data-marker="dash"]::before{content:"- "}',
    '.hw-card .hw-table .rte-line[data-marker="plus"]{padding-left:22px}',
    '.hw-card .hw-table .rte-line[data-marker="plus"]::before{content:"+ "}',
    '.hw-card .hw-table .rte-line[data-marker="icon"]::before{content:attr(data-icon) " "}',
    '.hw-card .hw-table .rte-col-2{column-count:2;column-gap:20px}',
    '.hw-card .hw-dash{color:var(--text-soft,#8B87A3);opacity:.55}',
    '.hw-card .hw-empty-note{color:var(--text-soft,#8B87A3);font-size:13px;padding:6px 0}',
    '@media(max-width:520px){.hw-card .subj-badge{min-width:92px;padding:8px 10px;font-size:12px;white-space:normal}.hw-card .hw-table td{padding:8px 10px;font-size:13px}.hw-card .hw-head{padding:12px 14px}}'
  ].join('\n');

  function injectStyles(){
    if(document.getElementById('hw-render-style')) return;
    var st = document.createElement('style');
    st.id = 'hw-render-style';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  injectStyles();

  window.HwRender = { cellHtml:cellHtml, cardHtml:cardHtml, safeUrl:safeUrl, fmtDate:fmtDate, fmtShort:fmtShort, sanitize:sanitize, injectStyles:injectStyles, esc:esc };
})();
