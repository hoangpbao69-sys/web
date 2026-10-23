'use strict';
/* ==========================================================
   Thư Viện Phim – indexmovie.js
   Hash routes:  #/  #/list/<kind>/<slug>/<page>  #/search/<q>/<page>
                 #/catalog/<page> #/favorites #/history #/account
                 #/admin/<films|episodes> #/guide
   Trang xem phim: /phim/<slug>   (Vercel rewrite -> index.html)
   ========================================================== */

const API_DIRECT = 'https://phim.nguonc.com/api';
const API_PROXY = '/nguonc-api';
const SITE = 'Thư Viện Phim';

/* Danh mục bộ lọc. Slug = tên bỏ dấu (ví dụ "Hành Động" -> hanh-dong).
   Nếu API dùng slug khác, sửa tên ở đây. */
const TAXO = {
  lists: [['Phim Lẻ', 'phim-le'], ['Phim Bộ', 'phim-bo'], ['TV Shows', 'tv-shows'], ['Hoạt Hình', 'hoat-hinh'], ['Đang Chiếu', 'phim-dang-chieu']],
  genres: ['Hành Động', 'Phiêu Lưu', 'Hài Hước', 'Hình Sự', 'Tài Liệu', 'Chính Kịch', 'Gia Đình', 'Giả Tưởng', 'Lịch Sử', 'Kinh Dị', 'Nhạc', 'Bí Ẩn', 'Lãng Mạn', 'Khoa Học Viễn Tưởng', 'Gây Cấn', 'Chiến Tranh', 'Tâm Lý', 'Tình Cảm', 'Cổ Trang', 'Miền Tây', 'Thần Thoại', 'Võ Thuật', 'Thể Thao', 'Học Đường'],
  countries: ['Việt Nam', 'Trung Quốc', 'Hàn Quốc', 'Nhật Bản', 'Thái Lan', 'Âu Mỹ', 'Đài Loan', 'Hồng Kông', 'Ấn Độ', 'Anh', 'Pháp', 'Canada', 'Quốc Gia Khác']
};

/* ---------- utils ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const app = document.getElementById('app');
const enc = encodeURIComponent;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const strip = h => String(h || '').replace(/<[^>]*>/g, ' ').replace(/[ \t]+/g, ' ').trim();
const slugify = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const safeUrl = u => { u = String(u || '').trim(); if (!u) return ''; if (u.startsWith('//')) u = 'https:' + u; try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch { return ''; } };
const natCmp = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });
const lsGet = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } };
const fmtTime = s => { s = Math.max(0, Math.floor(s || 0)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
const fmtDate = d => d ? new Date(d).toLocaleString('vi-VN') : '–';
const imgUrl = u => { u = String(u || '').trim(); if (!u) return ''; if (u.startsWith('//')) return 'https:' + u; if (u.startsWith('/')) return 'https://phim.nguonc.com' + u; return safeUrl(u); };
const titleOf = (kind, slug) => {
  const src = kind === 'danh-sach' ? TAXO.lists.map(x => x) : kind === 'the-loai' ? TAXO.genres.map(n => [n, slugify(n)]) : kind === 'quoc-gia' ? TAXO.countries.map(n => [n, slugify(n)]) : [];
  const f = src.find(x => x[1] === slug);
  return f ? f[0] : (kind === 'nam-phat-hanh' ? 'Năm ' + slug : slug.replace(/-/g, ' '));
};
function toast(msg, kind = '') {
  const t = document.createElement('div'); t.className = 'toast ' + kind; t.textContent = msg;
  $('#toasts').appendChild(t); setTimeout(() => t.remove(), 4200);
}
function loadScript(src) {
  return new Promise((res, rej) => {
    if ($$('script').some(s => s.src === src)) return res();
    const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(Error('Không tải được ' + src)); document.head.appendChild(s);
  });
}
async function pool(items, n, fn) {
  let i = 0; const run = async () => { while (i < items.length) { const k = i++; try { await fn(items[k], k); } catch { } } };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, run));
}

/* ---------- state (đăng nhập bằng Tên + Mã định danh — xem movie-auth.js) ---------- */
const S = { sb: null, user: null, favs: new Set() };
const isEditor = () => !!(S.user && S.user.canAdmin);      // quyền admin phim: manage.html → Mã định danh
const rpc = (fn, args) => MV.rpc(fn, args);
async function refreshAuth() {
  S.sb = MV.sb; S.user = MV.user; S.favs = new Set();
  if (!S.user) return;
  try { const r = await rpc('movie_fav_list'); S.favs = new Set((r.data || []).map(x => x.film_slug)); } catch { }
}

/* ---------- nguonc API ---------- */
const apiCache = new Map();
async function fetchJson(url) {
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw Error('API ' + r.status);
  const t = await r.text();
  try { return JSON.parse(t); } catch { throw Error('API trả về dữ liệu không phải JSON'); }
}
async function api(path) {
  const hit = apiCache.get(path);
  if (hit && Date.now() - hit.t < 120000) return hit.d;
  const bases = location.protocol === 'file:' ? [API_DIRECT] : [API_DIRECT, API_PROXY];
  let err;
  for (const b of bases) {
    try { const d = await fetchJson(b + path); apiCache.set(path, { t: Date.now(), d }); return d; } catch (e) { err = e; }
  }
  throw err;
}
function normList(d) {
  const x = d && d.data && !d.items ? d.data : (d || {});
  const items = x.items || x.films || [];
  const p = x.paginate || (d && d.paginate) || {};
  return { items, page: +p.current_page || 1, pages: +p.total_page || 1, total: +p.total_items || items.length };
}
function normFilm(d) {
  const m = d && (d.movie || (d.data && d.data.movie)); if (!m) return null;
  const groups = {};
  for (const g of Object.values(m.category || {})) groups[(g.group?.name || '').toLowerCase()] = (g.list || []).map(x => x.name);
  const pick = k => { const key = Object.keys(groups).find(n => n.includes(k)); return key ? groups[key] : []; };
  const servers = (m.episodes || d.episodes || []).map(s => ({
    name: s.server_name || s.name || 'Server',
    items: (s.items || s.server_data || []).map(i => ({ name: String(i.name ?? ''), slug: i.slug || '', embed: safeUrl(i.embed || i.link_embed), m3u8: safeUrl(i.m3u8 || i.link_m3u8) })).filter(i => i.embed || i.m3u8)
  })).filter(s => s.items.length);
  return {
    slug: m.slug, name: m.name, original_name: m.original_name || '', poster_url: m.poster_url || '', thumb_url: m.thumb_url || '',
    description: m.description || '', current_episode: m.current_episode || '', total_episodes: +m.total_episodes || null, time: m.time || '',
    quality: m.quality || '', language: m.language || '', director: m.director || '', casts: m.casts || '',
    year: +pick('năm')[0] || null, genres: pick('thể loại'), countries: pick('quốc gia'), format: pick('định dạng')[0] || '', servers
  };
}
const metaCache = new Map();
async function getMeta(slug) {
  if (metaCache.has(slug)) return metaCache.get(slug);
  let m = null;
  try { m = normFilm(await api('/film/' + enc(slug))); } catch { }
  if (!m && S.sb) { const r = await S.sb.from('movie_films').select('*').eq('slug', slug).maybeSingle(); if (r.data) m = r.data; }
  metaCache.set(slug, m); return m;
}

/* ---------- shared UI pieces ---------- */
let routeTok = 0;
let heroTimer = null;
function stopHero() { if (heroTimer) { clearInterval(heroTimer); heroTimer = null; } }
function card(m, o = {}) {
  const img = imgUrl(m.thumb_url || m.poster_url);
  const pct = o.progress != null && o.duration ? Math.min(100, Math.round(o.progress / o.duration * 100)) : 0;
  const href = '/phim/' + enc(m.slug) + (o.ep ? '?ep=' + enc(o.ep) : '');
  return `<div class="cardwrap"><a class="card" href="${href}" data-slug="${esc(m.slug)}"><div class="poster"><img loading="lazy" src="${esc(img)}" alt="${esc(m.name || m.slug)}" onerror="this.style.visibility='hidden'">${m.current_episode ? `<span class="badge${/full|hoàn tất|hoan tat/i.test(m.current_episode) ? ' full' : ''}">${esc(m.current_episode)}</span>` : ''}${m.quality ? `<span class="badge q">${esc(m.quality)}</span>` : ''}${pct ? `<div class="bar"><i style="width:${pct}%"></i></div>` : ''}${o.remove ? `<button class="rm" data-rm="${esc(m.slug)}">${Icon('trash', '', 14)}${esc(o.remove)}</button>` : ''}</div><div class="movie-title">${esc(m.name || m.slug)}</div><div class="movie-meta">${esc(o.sub || m.original_name || '')}</div></a></div>`;
}
const skelGrid = n => `<div class="grid">${'<div class="skel"></div>'.repeat(n)}</div>`;
function pager(page, pages, mk) {
  if (pages <= 1) return '';
  const set = new Set([1, pages, page - 2, page - 1, page, page + 1, page + 2].filter(n => n >= 1 && n <= pages));
  let out = '', prev = 0;
  for (const n of [...set].sort((a, b) => a - b)) {
    if (prev && n - prev > 1) out += '<span class="muted">…</span>';
    out += `<a class="pg${n === page ? ' active' : ''}" href="${mk(n)}">${n}</a>`; prev = n;
  }
  return `<div class="pagination">${page > 1 ? `<a class="pg" href="${mk(page - 1)}">${Icon('chevronLeft', '', 15)}</a>` : ''}${out}${page < pages ? `<a class="pg" href="${mk(page + 1)}">${Icon('chevronRight', '', 15)}</a>` : ''}</div>`;
}
function setMeta({ title, desc, image, canonical, ld } = {}) {
  document.title = title ? title + ' · ' + SITE : SITE;
  const meta = (attr, name, val) => { let e = $(`meta[${attr}="${name}"]`); if (!val) { e && e.remove(); return; } if (!e) { e = document.createElement('meta'); e.setAttribute(attr, name); document.head.appendChild(e); } e.setAttribute('content', val); };
  meta('name', 'description', desc); meta('property', 'og:title', title); meta('property', 'og:description', desc); meta('property', 'og:image', image); meta('property', 'og:type', title ? 'video.movie' : '');
  let link = $('link[rel=canonical]'); if (!canonical) { link && link.remove(); } else { if (!link) { link = document.createElement('link'); link.rel = 'canonical'; document.head.appendChild(link); } link.href = canonical; }
  let s = $('#ld'); if (!ld) { s && s.remove(); } else { if (!s) { s = document.createElement('script'); s.type = 'application/ld+json'; s.id = 'ld'; document.head.appendChild(s); } s.textContent = JSON.stringify(ld); }
}
function noSupabase() {
  app.innerHTML = `<section class="section wrap"><div class="empty">Chưa kết nối được Supabase. Tải lại trang.</div></section>`;
}

/* ---------- header ---------- */
function renderHeader() {
  const lk = (h, t) => `<a href="/indexmovie.html#/${h}">${esc(t)}</a>`;
  const dd = t => `<summary>${esc(t)}${Icon('chevronDown', 'chev', 15)}</summary>`;
  $('#nav').innerHTML = `
    <a href="/">${Icon('home')}Trang chủ chính</a>
    <a href="/indexmovie.html#/">Trang phim</a>
    <details class="dd">${dd('Danh sách')}<div class="dd-menu">${TAXO.lists.map(([n, s]) => lk('list/danh-sach/' + s + '/1', n)).join('')}${lk('catalog/1', 'Catalog Thư Viện')}</div></details>
    <details class="dd">${dd('Thể loại')}<div class="dd-menu cols">${TAXO.genres.map(n => lk('list/the-loai/' + slugify(n) + '/1', n)).join('')}</div></details>
    <details class="dd">${dd('Quốc gia')}<div class="dd-menu cols">${TAXO.countries.map(n => lk('list/quoc-gia/' + slugify(n) + '/1', n)).join('')}</div></details>
    ${lk('favorites', 'Yêu thích')}${lk('history', 'Lịch sử')}
    ${isEditor() ? lk('admin/films', 'Quản trị') + '<a href="/adminmovie.html">Vận hành</a><a href="/analyticsmovie.html">Analytics</a>' : ''}
    <a href="/indexmovie.html#/guide">Hướng dẫn</a>
    <a href="#" class="only-m" id="navLogout">${Icon('logout')}Đăng xuất</a>`;
  $('#navLogout').onclick = e => { e.preventDefault(); MV.logout(); };
  const name = S.user?.name || '';
  $('#acct').innerHTML = S.user
    ? `<a class="btn ghost" href="/indexmovie.html#/account" title="Tài khoản"><span class="avatar-dot">${esc(name.slice(0, 1).toUpperCase())}</span><span class="acct-name">${esc(name.slice(0, 14))}</span></a>`
    : '';
}
function closeMenus() { $$('details.dd').forEach(d => d.open = false); $('#nav').classList.remove('open'); }

/* ---------- tracking ---------- */
async function trackView(slug, name, episode) {
  try {
    if (!S.user) return;
    let sid = sessionStorage.getItem('tvp-sid');
    if (!sid) { sid = Math.random().toString(36).slice(2) + Date.now().toString(36); sessionStorage.setItem('tvp-sid', sid); }
    await rpc('movie_track_view', { p_slug: slug, p_film_name: name || '', p_episode: episode ? String(episode) : null, p_session: sid, p_referrer: document.referrer || '', p_ua: navigator.userAgent });
  } catch { }
}

/* Số tập trên poster: luôn lấy mới nhất từ nguonc (số lưu trong Supabase chỉ là dự phòng) */
function refreshHeroEpisodes(slides) {
  pool(slides, 4, async s => {
    const m = await getMeta(s.film_slug);
    const ep = m && m.current_episode;
    if (!ep) return;
    const box = $$('#heroCarousel .hc-badges').find(b => b.dataset.hslug === s.film_slug);
    if (!box) return;
    let badge = box.querySelector('.hc-badge.ep');
    if (!badge) { badge = document.createElement('span'); badge.className = 'hc-badge ep'; box.prepend(badge); }
    badge.textContent = ep;
  });
}
/* ---------- hero carousel (poster đầu trang) ---------- */
function renderHero(slides) {
  if (!$('#rows')) return; // đã điều hướng đi nơi khác
  const wrap = document.createElement('section');
  wrap.className = 'hero-carousel'; wrap.id = 'heroCarousel';
  const slideHtml = s => {
    const poster = imgUrl(s.poster_url) || imgUrl(s.thumb_url) || '';
    const bg = safeUrl(s.backdrop_url) || poster;
    const blur = !s.backdrop_url;
    return `<a class="hc-slide" href="/phim/${enc(s.film_slug)}">` +
      `<div class="hc-bg${blur ? ' blur' : ''}" style="background-image:url('${esc(bg)}')"></div>` +
      `<div class="hc-inner wrap">` +
      `<div class="hc-poster"><img src="${esc(poster)}" alt="${esc(s.film_name)}" loading="lazy"></div>` +
      `<div class="hc-info"><h2>${esc(s.film_name)}</h2>` +
      (s.original_name ? `<div class="hc-sub">${esc(s.original_name)}</div>` : '') +
      `<div class="hc-badges" data-hslug="${esc(s.film_slug)}">${s.current_episode ? `<span class="hc-badge ep">${esc(s.current_episode)}</span>` : ''}${s.language ? `<span class="hc-badge lang">${esc(s.language)}</span>` : ''}</div>` +
      (s.description ? `<p class="hc-desc">${esc(strip(s.description))}</p>` : '') +
      `<span class="btn primary hc-play">${Icon('play')}Xem ngay</span></div></div></a>`;
  };
  const nav = slides.length > 1
    ? `<button class="hc-nav prev" id="hcPrev" aria-label="Trước" type="button">${Icon('chevronLeft')}</button>` +
      `<button class="hc-nav next" id="hcNext" aria-label="Sau" type="button">${Icon('chevronRight')}</button>` +
      `<div class="hc-dots" id="hcDots">${slides.map((_, i) => `<button data-i="${i}" class="${i === 0 ? 'on' : ''}" aria-label="Poster ${i + 1}" type="button"></button>`).join('')}</div>`
    : '';
  wrap.innerHTML = `<div class="hc-slides" id="hcSlides">${slides.map(slideHtml).join('')}</div>${nav}`;
  app.prepend(wrap);
  if (slides.length <= 1) return;
  let idx = 0;
  const slidesEl = $('#hcSlides');
  const go = i => { idx = (i + slides.length) % slides.length; slidesEl.style.transform = `translateX(-${idx * 100}%)`; $$('#hcDots button').forEach((b, k) => b.classList.toggle('on', k === idx)); };
  const restart = () => { stopHero(); heroTimer = setInterval(() => go(idx + 1), 5000); };
  $('#hcPrev').onclick = () => { go(idx - 1); restart(); };
  $('#hcNext').onclick = () => { go(idx + 1); restart(); };
  $$('#hcDots button').forEach(b => b.onclick = () => { go(+b.dataset.i); restart(); });
  wrap.addEventListener('mouseenter', stopHero);
  wrap.addEventListener('mouseleave', restart);
  restart();
}

/* ---------- "Mới cập nhật": chuyển Danh sách / Dạng lưới ---------- */
const NEWVIEW_KEY = 'mv-newview';
const getNewView = () => lsGet(NEWVIEW_KEY) === 'grid' ? 'grid' : 'list';
const fmtStamp = d => {
  if (!d) return '–'; const x = new Date(d); if (isNaN(x)) return '–';
  const p = n => String(n).padStart(2, '0');
  return `${p(x.getHours())}:${p(x.getMinutes())}:${p(x.getSeconds())} ${p(x.getDate())}/${p(x.getMonth() + 1)}/${x.getFullYear()}`;
};
function latestListHtml(items) {
  const pill = (k, v) => `<span class="nl-c" data-k="${k}"><i class="nl-pill">${v}</i></span>`;
  return `<div class="nl"><div class="nl-head"><span>Tên phim</span><span>Tình trạng</span><span>Định dạng</span><span>Năm</span><span>Quốc gia</span><span>Ngày cập nhật</span></div>` +
    items.map(m => {
      const ep = m.current_episode || '', full = /full|hoàn tất|hoan tat/i.test(ep);
      return `<div class="nl-row" data-slug="${esc(m.slug)}">` +
        `<a class="nl-film" href="/phim/${enc(m.slug)}"><img loading="lazy" src="${esc(imgUrl(m.thumb_url || m.poster_url))}" alt="" onerror="this.style.visibility='hidden'"><span><b>${esc(m.name || m.slug)}</b><small>${esc(m.original_name || '')}</small></span></a>` +
        `<div class="nl-cells">` +
        `<span class="nl-c">${ep ? `<i class="nl-pill st${full ? ' full' : ''}">${esc(ep)}</i>` : '<i class="nl-pill">–</i>'}</span>` +
        pill('format', '…') + pill('year', '…') + pill('country', '…') +
        `<span class="nl-c"><i class="nl-pill time">${Icon('clock', '', 13)}${esc(fmtStamp(m.modified || m.updated_at))}</i></span>` +
        `</div></div>`;
    }).join('') + `</div>`;
}
async function fillLatestMeta(host, items, t) {
  await pool(items, 4, async m => {
    const x = await getMeta(m.slug); if (t !== routeTok || !x) return;
    const row = host.querySelector(`.nl-row[data-slug="${CSS.escape(m.slug)}"]`); if (!row) return;
    const set = (k, v) => { const e = row.querySelector(`[data-k="${k}"]`); if (e) e.innerHTML = `<i class="nl-pill">${v ? esc(v) : '–'}</i>`; };
    set('format', x.format); set('year', x.year); set('country', (x.countries || [])[0] || x.country || '');
  });
  if (t === routeTok) host.querySelectorAll('.nl-pill').forEach(p => { if (p.textContent === '…') p.textContent = '–'; });
}
/* Dựng khung "Cập nhật mới nhất / Danh sách phim" + nút chuyển kiểu xem vào phần tử sec */
function mountLatest(sec, items, t, opt = {}) {
  sec.innerHTML = `<div class="section-head lt-head"><div><span class="eyebrow lt-eyebrow">Cập nhật mới nhất</span><h2>${esc(opt.title || 'Danh sách phim')}</h2></div>` +
    `<div class="seg"><button type="button" data-m="list">${Icon('list', '', 17)}Danh sách</button><button type="button" data-m="grid">${Icon('grid', '', 17)}Dạng lưới</button>` +
    (opt.more ? `<a href="/indexmovie.html#/new/1">${Icon('film', '', 17)}Xem tất cả</a>` : '') + `</div></div><div class="lt-body"></div>`;
  const body = sec.querySelector('.lt-body');
  const draw = mode => {
    lsSet(NEWVIEW_KEY, mode);
    sec.querySelectorAll('.seg [data-m]').forEach(b => b.classList.toggle('on', b.dataset.m === mode));
    if (!items.length) { body.innerHTML = '<div class="empty">Chưa có phim.</div>'; return; }
    if (mode === 'grid') body.innerHTML = `<div class="grid">${items.map(x => card(x)).join('')}</div>`;
    else { body.innerHTML = latestListHtml(items); fillLatestMeta(body, items, t); }
  };
  sec.querySelectorAll('.seg [data-m]').forEach(b => b.onclick = () => draw(b.dataset.m));
  draw(getNewView());
}
async function newView(page) {
  const t = routeTok; setMeta({ title: 'Mới cập nhật' });
  app.innerHTML = `<section class="section wrap" id="rNewAll">${skelGrid(12)}</section>`;
  try {
    const l = normList(await api(`/films/phim-moi-cap-nhat?page=${page}`)); if (t !== routeTok) return;
    const sec = $('#rNewAll'); mountLatest(sec, l.items, t, { title: 'Mới cập nhật' });
    sec.insertAdjacentHTML('beforeend', pager(l.page || page, l.pages, n => `/indexmovie.html#/new/${n}`));
  } catch (e) { if (t === routeTok) $('#rNewAll').innerHTML = `<div class="empty">Không tải được dữ liệu: ${esc(e.message)}</div>`; }
}

async function home() {
  const t = routeTok;
  setMeta({});
  app.innerHTML = `<section class="hero slim"><div class="wrap"><span class="eyebrow">Nguồn dữ liệu phim mở</span><h1>Thư Viện <em>Phim</em></h1><p>Dữ liệu phim vĩnh viễn. Cập nhật nhanh, chất lượng cao, ổn định và lâu dài.</p>
    <div class="statcards">
      <div class="statcard"><span class="sic c1">${Icon('film', '', 22)}</span><div><b id="total">–</b><span>Tổng số phim (nguonc)</span></div></div>
      <div class="statcard"><span class="sic c2">${Icon('layers', '', 22)}</span><div><b id="catCount">–</b><span>Phim trong Catalog</span></div></div>
      <div class="statcard"><span class="sic c3">${Icon('globe', '', 22)}</span><div><b>nguonc</b><span>Nguồn dữ liệu phim</span></div></div>
      ${isEditor() ? `<a class="statcard" href="/indexmovie.html#/admin/films"><span class="sic c4">${Icon('edit', '', 22)}</span><div><b>Quản trị</b><span>Thêm / sửa phim</span></div></a>` : ''}
    </div>
  </div></section><div id="rows"></div>`;
  const rows = $('#rows');
  const mk = (id, title, more) => { rows.insertAdjacentHTML('beforeend', `<section class="section wrap" id="${id}"><div class="section-head"><div><h2>${esc(title)}</h2></div>${more ? `<a class="more" href="${more}">Xem tất cả ${Icon('arrowRight', '', 14)}</a>` : ''}</div><div class="body">${skelGrid(6)}</div></section>`); return $('#' + id + ' .body'); };
  const fail = el => { el.innerHTML = '<div class="empty">Không tải được dữ liệu phim.</div>'; };
  const fillApi = (el, path) => api(path).then(d => { if (t !== routeTok) return; const l = normList(d); el.innerHTML = l.items.length ? `<div class="grid">${l.items.slice(0, 12).map(x => card(x)).join('')}</div>` : '<div class="empty">Chưa có phim.</div>'; return l; }).catch(() => t === routeTok && fail(el));

  // Nổi bật / Catalog từ Supabase (ẩn nếu trống)
  if (S.sb) {
    S.sb.from('movie_hero_slides').select('*').eq('is_active', true).order('sort_order').then(r => {
      if (t !== routeTok || !r.data?.length) return;
      renderHero(r.data);
      refreshHeroEpisodes(r.data);
    });
    S.sb.from('movie_films').select('*').eq('is_published', true).eq('is_featured', true).order('updated_at', { ascending: false }).limit(12).then(r => {
      if (t !== routeTok || !r.data?.length) return;
      rows.insertAdjacentHTML('afterbegin', `<section class="section wrap"><div class="section-head"><h2>Nổi bật</h2></div><div class="grid">${r.data.map(x => card(x)).join('')}</div></section>`);
    });
    if (S.user) rpc('movie_hist_list', { p_limit: 6 }).then(async r => {
      if (t !== routeTok || !r.data?.length) return;
      const sec = document.createElement('section'); sec.className = 'section wrap'; sec.innerHTML = `<div class="section-head"><h2>Tiếp tục xem</h2><a class="more" href="/indexmovie.html#/history">Lịch sử ${Icon('arrowRight', '', 14)}</a></div><div class="grid" id="contGrid"></div>`;
      rows.prepend(sec);
      $('#contGrid').innerHTML = r.data.map(h => card({ slug: h.film_slug, name: h.film_name || h.film_slug, thumb_url: '' }, { progress: h.progress_seconds, duration: h.duration_seconds, ep: h.episode, sub: h.episode ? 'Tập ' + h.episode : '' })).join('');
      pool(r.data, 4, async h => { const m = await getMeta(h.film_slug); const a = $(`#contGrid a[data-slug="${CSS.escape(h.film_slug)}"] img`); if (m && a) { a.src = imgUrl(m.thumb_url || m.poster_url); a.style.visibility = ''; } });
    });
  }
  rows.insertAdjacentHTML('beforeend', `<section class="section wrap" id="rNew"><div class="lt-body">${skelGrid(6)}</div></section>`);
  api('/films/phim-moi-cap-nhat?page=1').then(d => {
    if (t !== routeTok) return; const l = normList(d);
    mountLatest($('#rNew'), l.items.slice(0, 12), t, { more: true });
    $('#total').textContent = Number(l.total).toLocaleString('vi-VN');
  }).catch(() => t === routeTok && fail($('#rNew .lt-body')));
  if (S.sb) S.sb.from('movie_films').select('*', { count: 'exact' }).eq('is_published', true).order('updated_at', { ascending: false }).limit(12).then(r => {
    if (t === routeTok && $('#catCount')) $('#catCount').textContent = (r.count ?? r.data.length).toLocaleString('vi-VN');
    if (t !== routeTok || !r.data?.length) return;
    const el = mk('rCat', 'Catalog Thư Viện', '/indexmovie.html#/catalog/1'); el.innerHTML = `<div class="grid">${r.data.map(x => card(x)).join('')}</div>`;
  });
  fillApi(mk('rBo', 'Phim bộ', '/indexmovie.html#/list/danh-sach/phim-bo/1'), '/films/danh-sach/phim-bo?page=1');
  fillApi(mk('rLe', 'Phim lẻ', '/indexmovie.html#/list/danh-sach/phim-le/1'), '/films/danh-sach/phim-le?page=1');
  fillApi(mk('rHh', 'Hoạt hình', '/indexmovie.html#/list/danh-sach/hoat-hinh/1'), '/films/danh-sach/hoat-hinh?page=1');
}

/* ---------- list / search / catalog ---------- */
function filterBar(kind, slug) {
  const opt = (arr, cur, kd) => arr.map(([n, s]) => `<option value="${kd}/${s}" ${kind === kd && slug === s ? 'selected' : ''}>${esc(n)}</option>`).join('');
  const y = new Date().getFullYear(), years = Array.from({ length: y - 1999 }, (_, i) => [String(y - i), String(y - i)]);
  return `<div class="filters">
    <select data-f><option value="">Danh sách…</option>${opt(TAXO.lists, slug, 'danh-sach')}</select>
    <select data-f><option value="">Thể loại…</option>${opt(TAXO.genres.map(n => [n, slugify(n)]), slug, 'the-loai')}</select>
    <select data-f><option value="">Quốc gia…</option>${opt(TAXO.countries.map(n => [n, slugify(n)]), slug, 'quoc-gia')}</select>
    <select data-f><option value="">Năm…</option>${opt(years, slug, 'nam-phat-hanh')}</select></div>`;
}
function bindFilters() { $$('[data-f]').forEach(s => s.onchange = () => { if (s.value) location.hash = '#/list/' + s.value + '/1'; }); }
async function listView(kind, slug, page) {
  const t = routeTok; if (!kind || !slug) return home();
  const title = titleOf(kind, slug); setMeta({ title });
  app.innerHTML = `<section class="section wrap"><div class="section-head"><div><span class="eyebrow">${esc(kind.replace('-', ' '))}</span><h2>${esc(title)}</h2></div></div>${filterBar(kind, slug)}<div id="lst">${skelGrid(12)}</div></section>`;
  bindFilters();
  try {
    const l = normList(await api(`/films/${kind}/${enc(slug)}?page=${page}`)); if (t !== routeTok) return;
    $('#lst').innerHTML = l.items.length ? `<div class="grid">${l.items.map(x => card(x)).join('')}</div>${pager(l.page || page, l.pages, n => `/indexmovie.html#/list/${kind}/${enc(slug)}/${n}`)}` : '<div class="empty">Không có phim trong mục này (hoặc slug chưa đúng với API).</div>';
  } catch (e) { if (t === routeTok) $('#lst').innerHTML = `<div class="empty">Không tải được dữ liệu: ${esc(e.message)}</div>`; }
}
async function searchView(q, page) {
  const t = routeTok; setMeta({ title: 'Tìm: ' + q });
  app.innerHTML = `<section class="section wrap"><div class="section-head"><div><span class="eyebrow">Tìm kiếm</span><h2>“${esc(q)}”</h2></div></div><div id="lst">${skelGrid(12)}</div></section>`;
  if (!q.trim()) { $('#lst').innerHTML = '<div class="empty">Nhập từ khoá vào ô tìm kiếm.</div>'; return; }
  try {
    const l = normList(await api(`/films/search?keyword=${enc(q)}&page=${page}`));
    // kết quả từ catalog Supabase (nếu có)
    let extra = [];
    if (S.sb) { const r = await S.sb.from('movie_films').select('*').eq('is_published', true).or(`name.ilike.%${q.replace(/[,()%]/g, ' ')}%,original_name.ilike.%${q.replace(/[,()%]/g, ' ')}%`).limit(12); extra = (r.data || []).filter(x => !l.items.some(y => y.slug === x.slug)); }
    if (t !== routeTok) return;
    const all = [...extra, ...l.items];
    $('#lst').innerHTML = all.length ? `<div class="grid">${all.map(x => card(x)).join('')}</div>${pager(l.page || page, l.pages, n => `/indexmovie.html#/search/${enc(q)}/${n}`)}` : '<div class="empty">Không tìm thấy phim phù hợp.</div>';
  } catch (e) { if (t === routeTok) $('#lst').innerHTML = `<div class="empty">Không tìm được: ${esc(e.message)}</div>`; }
}
async function catalogView(page) {
  const t = routeTok; setMeta({ title: 'Catalog' });
  if (!S.sb) return noSupabase();
  const per = 24;
  app.innerHTML = `<section class="section wrap"><div class="section-head"><div><span class="eyebrow">Kho riêng</span><h2>Catalog Thư Viện</h2></div></div><div id="lst">${skelGrid(12)}</div></section>`;
  const r = await S.sb.from('movie_films').select('*', { count: 'exact' }).eq('is_published', true).order('updated_at', { ascending: false }).range((page - 1) * per, page * per - 1);
  if (t !== routeTok) return;
  if (r.error) { $('#lst').innerHTML = `<div class="empty">${esc(r.error.message)}<br>Đã chạy supabase.sql chưa?</div>`; return; }
  $('#lst').innerHTML = r.data.length ? `<div class="grid">${r.data.map(x => card(x)).join('')}</div>${pager(page, Math.ceil((r.count || 0) / per), n => `/indexmovie.html#/catalog/${n}`)}` : '<div class="empty">Catalog trống. Thêm phim ở mục Quản trị.</div>';
}

/* ---------- film page + player ---------- */
let PLAY = null; // { slug, name, item, hls, lastSave }

async function saveProgress(force, override, keepalive) {
  if (!PLAY || !S.user || !PLAY.item) return;
  const now = Date.now();
  if (!force && now - PLAY.lastSave < 15000) return;
  PLAY.lastSave = now;
  const v = $('#vid');
  const args = {
    p_slug: PLAY.slug, p_film_name: PLAY.name, p_episode: PLAY.item.name,
    p_progress: Math.floor(override != null ? override : (v?.currentTime || 0)),
    p_duration: v && isFinite(v.duration) ? Math.floor(v.duration) : null
  };
  try { if (keepalive) MV.rpcKeepalive('movie_hist_save', args); else await rpc('movie_hist_save', args); } catch { }
}
function stopPlayer() {
  if (!PLAY) return;
  saveProgress(true);
  try { PLAY.hls && PLAY.hls.destroy(); } catch { }
  PLAY = null;
}
window.addEventListener('pagehide', () => saveProgress(true, undefined, true));

async function filmView(slug) {
  const t = routeTok;
  app.innerHTML = `<section class="section wrap"><div class="empty">Đang tải phim…</div></section>`;
  const none = Promise.resolve({ data: null });
  const [ra, rd, re, rh] = await Promise.allSettled([
    api('/film/' + enc(slug)),
    S.sb.from('movie_films').select('*').eq('slug', slug).maybeSingle(),
    S.sb.from('movie_episodes').select('*').eq('film_slug', slug).eq('is_active', true),
    rpc('movie_hist_get', { p_slug: slug })
  ]);
  if (t !== routeTok) return;
  const A = ra.status === 'fulfilled' ? normFilm(ra.value) : null;
  const D = rd.status === 'fulfilled' ? rd.value.data : null;
  const hist = rh.status === 'fulfilled' ? ((rh.value.data || [])[0] || null) : null;
  if (!A && !D) {
    app.innerHTML = `<section class="section wrap"><a class="muted" href="/indexmovie.html">${Icon('arrowLeft', '', 14)} Về trang phim</a><div class="panel" style="margin-top:24px"><div class="empty">Không tìm thấy phim${ra.status === 'rejected' ? ' (' + esc(ra.reason?.message || '') + ')' : ''}.</div></div></section>`;
    return;
  }
  // gộp: dữ liệu admin sửa trong Supabase được ưu tiên hơn API
  const M = { slug, name: slug, original_name: '', poster_url: '', thumb_url: '', description: '', current_episode: '', total_episodes: null, time: '', quality: '', language: '', director: '', casts: '', year: null, genres: [], countries: [], format: '', servers: [], ...(A || {}) };
  if (D) {
    for (const k of ['name', 'original_name', 'poster_url', 'thumb_url', 'description', 'current_episode', 'quality', 'language', 'director', 'casts', 'format']) if (D[k]) M[k] = D[k];
    if (D.total_episodes) M.total_episodes = D.total_episodes; if (D.year) M.year = D.year;
    if (D.genres?.length) M.genres = D.genres; if (D.countries?.length) M.countries = D.countries;
  }
  // gộp tập từ bảng episodes
  const servers = M.servers.map(s => ({ name: s.name, items: [...s.items] }));
  const byServer = {};
  for (const e of (re.status === 'fulfilled' ? re.value.data || [] : [])) (byServer[e.server_name] ||= []).push(e);
  for (const [name, list] of Object.entries(byServer)) {
    let sv = servers.find(s => s.name.toLowerCase() === name.toLowerCase()); const isNew = !sv;
    if (isNew) { sv = { name, items: [] }; servers.push(sv); }
    for (const e of list) {
      const it = { name: e.episode_name, slug: slugify(e.episode_name), embed: safeUrl(e.embed_url), m3u8: safeUrl(e.m3u8_url) };
      if (!it.embed && !it.m3u8) continue;
      const i = sv.items.findIndex(x => x.name === it.name); if (i >= 0) sv.items[i] = it; else sv.items.push(it);
    }
    if (isNew) sv.items.sort((a, b) => natCmp(a.name, b.name));
  }
  M.servers = servers;

  const img = imgUrl(M.poster_url || M.thumb_url);
  const desc = strip(M.description);
  const canonical = location.origin + '/phim/' + enc(slug);
  setMeta({
    title: M.name, desc: desc.slice(0, 160), image: img, canonical,
    ld: { '@context': 'https://schema.org', '@type': (M.total_episodes || 0) > 1 || servers.some(s => s.items.length > 1) ? 'TVSeries' : 'Movie', name: M.name, alternateName: M.original_name || undefined, url: canonical, image: img || undefined, description: desc.slice(0, 500), dateCreated: M.year ? String(M.year) : undefined, genre: M.genres.length ? M.genres : undefined }
  });
  const chipLink = (kind, n) => `<a class="chip" href="/indexmovie.html#/list/${kind}/${enc(slugify(n))}/1">${esc(n)}</a>`;
  const fact = (k, v) => v ? `<dt>${k}</dt><dd>${esc(v)}</dd>` : '';
  app.innerHTML = `<section class="section wrap">
    <a class="muted" href="/indexmovie.html">${Icon('arrowLeft', '', 14)} Về trang phim</a>
    <div class="film-top">
      <div class="poster"><img src="${esc(img)}" alt="${esc(M.name)}" onerror="this.style.visibility='hidden'"></div>
      <div>
        <span class="eyebrow">${esc(M.format || 'Phim')}</span>
        <h1>${esc(M.name)}</h1><div class="muted">${esc(M.original_name)}</div>
        <div class="chips">${M.current_episode ? `<span class="chip hl">${esc(M.current_episode)}${M.total_episodes ? ' / ' + esc(M.total_episodes) : ''}</span>` : ''}${M.quality ? `<span class="chip hl">${esc(M.quality)}</span>` : ''}${M.language ? `<span class="chip">${esc(M.language)}</span>` : ''}${M.year ? `<a class="chip" href="/indexmovie.html#/list/nam-phat-hanh/${M.year}/1">${M.year}</a>` : ''}${M.time ? `<span class="chip">${esc(M.time)}</span>` : ''}</div>
        <div class="chips">${M.genres.map(n => chipLink('the-loai', n)).join('')}${M.countries.map(n => chipLink('quoc-gia', n)).join('')}</div>
        <dl class="facts">${fact('Đạo diễn', M.director)}${fact('Diễn viên', M.casts)}</dl>
        <div class="actions-row">
          <button class="btn primary" id="playBtn">${Icon('play')}Xem ngay</button>
          <button class="btn ghost fav" id="favBtn">${Icon('heart')}Yêu thích</button>
          <button class="btn ghost" id="shareBtn">${Icon('link')}Sao chép link</button>
          ${isEditor() ? `<a class="btn ghost" href="/indexmovie.html#/admin/episodes/${enc(slug)}">${Icon('edit')}Sửa tập</a>` : ''}
        </div>
      </div>
    </div>
    <div class="panel watch" id="watch">
      <div class="player" id="player"><div class="player-msg">${servers.length ? 'Chọn tập để xem' : 'Phim này chưa có tập nào.'}</div></div>
      <div class="watch-bar">
        <div><b id="nowTitle">–</b><div class="muted" id="nowSub"></div></div>
        <div class="watch-actions">
          <button class="btn ghost" id="prevEp">${Icon('chevronLeft','',16)}Trước</button><button class="btn ghost" id="nextEp">Sau${Icon('chevronRight','',16)}</button>
          <div class="seg" id="modeSeg"><button data-m="hls">HLS</button><button data-m="embed">Embed</button></div>
          <button class="btn danger" id="reportBtn">${Icon('alert')}Báo lỗi</button>
        </div>
      </div>
      ${hist && hist.episode ? `<div class="notice resume" style="margin:0 18px 12px"><span>Bạn đang xem dở <b>Tập ${esc(hist.episode)}</b> (${fmtTime(hist.progress_seconds)})</span><button class="btn ghost" id="resumeBtn">Tiếp tục xem</button></div>` : ''}
      <div class="tabs" id="servers"></div><div class="eps" id="eps"></div>
    </div>
    <div class="panel"><div class="panel-head"><h3>Nội dung phim</h3></div><div class="panel-body"><div class="desc">${esc(desc || 'Chưa có mô tả.')}</div></div></div>
  </section>`;

  /* --- yêu thích / chia sẻ --- */
  const favBtn = $('#favBtn');
  const paintFav = () => { const on = S.favs.has(slug); favBtn.classList.toggle('on', on); favBtn.innerHTML = Icon('heart') + (on ? 'Đã yêu thích' : 'Yêu thích'); };
  paintFav();
  favBtn.onclick = async () => {
    const on = S.favs.has(slug);
    const r = await rpc('movie_fav_set', { p_slug: slug, p_film_name: M.name, p_on: !on });
    if (r.error) return toast(r.error.message, 'bad');
    on ? S.favs.delete(slug) : S.favs.add(slug); paintFav(); toast(on ? 'Đã bỏ yêu thích' : 'Đã thêm vào yêu thích', 'ok');
  };
  $('#shareBtn').onclick = async () => { try { await navigator.clipboard.writeText(canonical); toast('Đã sao chép link', 'ok'); } catch { prompt('Link phim:', canonical); } };

  /* --- player --- */
  stopPlayer();
  PLAY = { slug, name: M.name, item: null, hls: null, lastSave: 0 };
  const viewed = new Set();
  let si = 0, ei = 0;
  const pref = () => lsGet('tvp-mode') || 'hls';
  const modeFor = it => { const p = pref(); if (p === 'hls' && it.m3u8) return 'hls'; if (it.embed) return 'embed'; return it.m3u8 ? 'hls' : 'embed'; };
  const keyOf = it => it.slug || it.name;
  const flat = () => servers[si]?.items || [];

  function paintLists() {
    $('#servers').innerHTML = servers.length > 1 ? servers.map((s, i) => `<button data-s="${i}" class="${i === si ? 'on' : ''}">${esc(s.name)}</button>`).join('') : '';
    $('#servers').style.display = servers.length > 1 ? '' : 'none';
    $('#eps').innerHTML = flat().map((it, i) => `<button data-e="${i}" class="${i === ei ? 'on' : ''}">${esc(it.name)}</button>`).join('');
    $$('#servers [data-s]').forEach(b => b.onclick = () => { si = +b.dataset.s; ei = Math.min(ei, flat().length - 1); paintLists(); });
    $$('#eps [data-e]').forEach(b => b.onclick = () => play(si, +b.dataset.e));
  }
  function paintMode(it) {
    const m = it ? modeFor(it) : '';
    $$('#modeSeg button').forEach(b => { b.classList.toggle('on', b.dataset.m === m); b.disabled = !it || !it[b.dataset.m === 'hls' ? 'm3u8' : 'embed']; });
  }
  async function loadHls() { if (!window.Hls) await loadScript('https://cdn.jsdelivr.net/npm/hls.js@1'); return window.Hls; }
  function showMsg(html) { PLAY.hls && (PLAY.hls.destroy(), PLAY.hls = null); $('#player').innerHTML = `<div class="player-msg">${html}</div>`; }
  function mountEmbed(it) {
    PLAY.hls && (PLAY.hls.destroy(), PLAY.hls = null);
    $('#player').innerHTML = `<iframe src="${esc(it.embed)}" allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowfullscreen></iframe>`;
    paintMode(it); $$('#modeSeg button').forEach(b => b.classList.toggle('on', b.dataset.m === 'embed'));
  }
  async function mountHls(it, resumeAt) {
    $('#player').innerHTML = '<video id="vid" controls playsinline autoplay preload="metadata"></video>';
    const v = $('#vid'); let failed = false;
    const fail = () => { if (failed) return; failed = true; if (it.embed) { toast('Không phát được HLS, chuyển sang Embed'); mountEmbed(it); } else showMsg('Không phát được link này.<br>Bấm “Báo lỗi” để admin kiểm tra.'); };
    let Hls = null; try { Hls = await loadHls(); } catch { }
    if (!PLAY || PLAY.item !== it) return;
    if (Hls && Hls.isSupported()) {
      const h = new Hls({ maxBufferLength: 30 }); PLAY.hls = h; h.loadSource(it.m3u8); h.attachMedia(v);
      h.on(Hls.Events.ERROR, (_, d) => { if (d.fatal) fail(); });
    } else if (v.canPlayType('application/vnd.apple.mpegurl')) { v.src = it.m3u8; v.onerror = fail; }
    else return fail();
    v.addEventListener('loadedmetadata', () => { if (resumeAt > 5 && isFinite(v.duration) && v.duration - resumeAt > 20) v.currentTime = resumeAt; });
    v.addEventListener('timeupdate', () => saveProgress(false));
    v.addEventListener('pause', () => saveProgress(true));
    v.addEventListener('ended', () => { saveProgress(true); if (ei < flat().length - 1) { toast('Chuyển tập tiếp theo…'); play(si, ei + 1); } });
    v.play?.().catch(() => { });
  }
  async function play(s, e, opts = {}) {
    if (!PLAY) return; si = s; ei = e; const it = flat()[ei]; if (!it) return;
    PLAY.item = it; PLAY.lastSave = 0; paintLists();
    $('#nowTitle').textContent = M.name + ' – Tập ' + it.name; $('#nowSub').textContent = servers[si].name;
    const url = new URL(location.href); url.searchParams.set('sv', si); url.searchParams.set('ep', keyOf(it)); history.replaceState(null, '', url.pathname + url.search);
    const key = slug + '|' + it.name; if (!viewed.has(key)) { viewed.add(key); trackView(slug, M.name, it.name); }
    const mode = modeFor(it); paintMode(it);
    if (mode === 'hls') await mountHls(it, opts.resumeAt || 0); else mountEmbed(it);
    saveProgress(true, opts.resumeAt || 0); // ghi lịch sử ngay khi bắt đầu xem
    $('#prevEp').disabled = ei <= 0; $('#nextEp').disabled = ei >= flat().length - 1;
    if (opts.scroll) $('#watch').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  paintLists(); paintMode(null);
  $('#prevEp').disabled = $('#nextEp').disabled = true;
  $('#prevEp').onclick = () => ei > 0 && play(si, ei - 1);
  $('#nextEp').onclick = () => ei < flat().length - 1 && play(si, ei + 1);
  $$('#modeSeg button').forEach(b => b.onclick = () => { lsSet('tvp-mode', b.dataset.m); if (PLAY.item) play(si, ei, { resumeAt: $('#vid')?.currentTime || 0 }); });
  $('#playBtn').onclick = () => { if (!servers.length) return toast('Phim này chưa có tập nào'); play(si, ei, { scroll: true }); };
  $('#reportBtn').onclick = async () => {
    const it = PLAY.item; if (!it) return toast('Hãy chọn một tập trước');
    const kind = $('#vid') || !it.embed ? 'm3u8' : 'embed', url = kind === 'm3u8' ? it.m3u8 : it.embed;
    const r = await rpc('movie_report_link', { p_slug: slug, p_film_name: M.name, p_episode: it.name, p_kind: kind, p_url: url });
    if (r.error) toast(r.error.message, 'bad');
    else if (r.data === 'dup') toast('Link này đã được báo trước đó, cảm ơn bạn!', 'ok');
    else toast('Đã gửi báo lỗi cho admin. Cảm ơn bạn!', 'ok');
  };
  if ($('#resumeBtn')) $('#resumeBtn').onclick = () => {
    for (let a = 0; a < servers.length; a++) { const b = servers[a].items.findIndex(x => x.name === hist.episode); if (b >= 0) return play(a, b, { resumeAt: hist.progress_seconds, scroll: true }); }
    toast('Không tìm thấy tập đã xem dở');
  };

  // ?ep=<slug tập>&sv=<server> → phát luôn tập đó
  const qs = new URLSearchParams(location.search), wantEp = qs.get('ep'), wantSv = +qs.get('sv') || 0;
  if (wantEp && servers.length) {
    const find = (a, key) => servers[a].items.findIndex(x => keyOf(x) === key || x.name === key);
    let a = Math.min(Math.max(wantSv, 0), servers.length - 1), b = find(a, wantEp);
    if (b < 0) { for (let k = 0; k < servers.length; k++) { const f = find(k, wantEp); if (f >= 0) { a = k; b = f; break; } } }
    if (b >= 0) play(a, b, { resumeAt: hist && hist.episode === servers[a].items[b].name ? hist.progress_seconds : 0, scroll: true });
  }
}

/* ---------- favorites / history ---------- */
async function fillPosters(container, slugs) {
  await pool(slugs, 4, async slug => {
    const m = await getMeta(slug); if (!m) return;
    const a = $(`a[data-slug="${CSS.escape(slug)}"]`, container); if (!a) return;
    const img = $('img', a); img.src = imgUrl(m.thumb_url || m.poster_url); img.style.visibility = '';
    if (!$('.movie-meta', a).textContent) $('.movie-meta', a).textContent = m.original_name || '';
  });
}
async function favoritesView() {
  const t = routeTok; setMeta({ title: 'Yêu thích' });
  app.innerHTML = `<section class="section wrap"><div class="section-head"><div><span class="eyebrow">Của bạn</span><h2>Phim yêu thích</h2></div></div><div id="lst">${skelGrid(6)}</div></section>`;
  const r = await rpc('movie_fav_list');
  if (t !== routeTok) return;
  if (r.error) { $('#lst').innerHTML = `<div class="empty">${esc(r.error.message)}</div>`; return; }
  if (!r.data.length) { $('#lst').innerHTML = '<div class="empty">Chưa có phim yêu thích. Mở một phim rồi bấm ' + Icon('heart', '', 14) + ' Yêu thích.</div>'; return; }
  $('#lst').innerHTML = `<div class="grid">${r.data.map(f => card({ slug: f.film_slug, name: f.film_name || f.film_slug }, { remove: 'Bỏ thích' })).join('')}</div>`;
  $$('[data-rm]').forEach(b => b.onclick = async e => {
    e.preventDefault(); e.stopPropagation();
    const x = await rpc('movie_fav_set', { p_slug: b.dataset.rm, p_film_name: '', p_on: false });
    if (x.error) return toast(x.error.message, 'bad');
    S.favs.delete(b.dataset.rm); b.closest('.cardwrap').remove(); toast('Đã bỏ yêu thích', 'ok');
  });
  fillPosters($('#lst'), r.data.map(f => f.film_slug));
}
async function historyView() {
  const t = routeTok; setMeta({ title: 'Lịch sử xem' });
  app.innerHTML = `<section class="section wrap"><div class="section-head"><div><span class="eyebrow">Của bạn</span><h2>Lịch sử xem</h2></div><button class="btn danger" id="clearHist">Xoá toàn bộ</button></div><div id="lst">${skelGrid(6)}</div></section>`;
  const r = await rpc('movie_hist_list', { p_limit: 60 });
  if (t !== routeTok) return;
  if (r.error) { $('#lst').innerHTML = `<div class="empty">${esc(r.error.message)}</div>`; return; }
  if (!r.data.length) { $('#lst').innerHTML = '<div class="empty">Bạn chưa xem phim nào.</div>'; $('#clearHist').remove(); return; }
  $('#lst').innerHTML = `<div class="grid">${r.data.map(h => card({ slug: h.film_slug, name: h.film_name || h.film_slug }, { remove: 'Xoá', progress: h.progress_seconds, duration: h.duration_seconds, ep: h.episode, sub: `Tập ${h.episode || '?'} · ${fmtTime(h.progress_seconds)} · ${new Date(h.updated_at).toLocaleDateString('vi-VN')}` })).join('')}</div>`;
  $$('[data-rm]').forEach(b => b.onclick = async e => {
    e.preventDefault(); e.stopPropagation();
    const x = await rpc('movie_hist_delete', { p_slug: b.dataset.rm });
    if (x.error) return toast(x.error.message, 'bad'); b.closest('.cardwrap').remove();
  });
  $('#clearHist').onclick = async () => {
    if (!confirm('Xoá toàn bộ lịch sử xem?')) return;
    const x = await rpc('movie_hist_delete', {});
    if (x.error) return toast(x.error.message, 'bad'); historyView();
  };
  fillPosters($('#lst'), r.data.map(h => h.film_slug));
}

/* ---------- account ---------- */
async function accountView() {
  const t = routeTok; setMeta({ title: 'Tài khoản' });
  const u = S.user;
  const [fc, hc] = await Promise.all([rpc('movie_fav_list'), rpc('movie_hist_list', { p_limit: 200 })]);
  if (t !== routeTok) return;
  app.innerHTML = `<section class="section wrap"><div class="section-head"><div><span class="eyebrow">Tài khoản</span><h2>Xin chào, ${esc(u.name)}</h2></div><button class="btn danger" id="logout">${Icon('logout')}Đăng xuất</button></div>
  <div class="acct-grid">
    <div class="panel"><div class="panel-head"><h3>Thông tin</h3></div><div class="panel-body">
      <dl class="kv"><dt>Tên đăng nhập</dt><dd>${esc(u.name)}</dd><dt>Quyền</dt><dd><span class="pill ${u.canAdmin ? '' : 'ok'}">${u.canAdmin ? 'Admin phim' : 'Người xem'}</span></dd><dt>Yêu thích</dt><dd><a href="/indexmovie.html#/favorites">${(fc.data || []).length} phim</a></dd><dt>Lịch sử</dt><dd><a href="/indexmovie.html#/history">${(hc.data || []).length} phim</a></dd></dl>
      <div class="notice">Tài khoản dùng chung Tên + Mã định danh với web Thư Viện Bài Soạn. Quên mã hoặc cần đổi quyền: liên hệ quản lý.</div>
    </div></div>
    <div class="panel"><div class="panel-head"><h3>Lối tắt</h3></div><div class="panel-body">
      <div class="actions-row" style="margin-top:0"><a class="btn ghost" href="/">${Icon('home')}Trang chủ chính</a>${u.canAdmin ? `<a class="btn ghost" href="/indexmovie.html#/admin/films">${Icon('edit')}Quản trị phim</a><a class="btn ghost" href="/adminmovie.html">Vận hành</a><a class="btn ghost" href="/analyticsmovie.html">Analytics</a>` : ''}</div>
    </div></div>
  </div></section>`;
  $('#logout').onclick = () => MV.logout();
}

/* ---------- admin ---------- */
const FIELDS = ['name', 'slug', 'original_name', 'poster_url', 'thumb_url', 'current_episode', 'total_episodes', 'year', 'quality', 'language', 'director', 'casts', 'format', 'genres', 'countries', 'description'];
let adminPage = 1, adminQ = '';

function adminGate() {
  if (!isEditor()) {
    app.innerHTML = `<section class="section wrap"><div class="panel login"><div class="panel-body"><h1>Chưa đủ quyền</h1><p class="muted">Tài khoản <b>${esc(S.user.name)}</b> chưa được cấp quyền quản trị phim. Nhờ quản lý vào <b>manage.html ${Icon('chevronRight', '', 13)} Mã định danh</b>, bật ô <b>${Icon('film', '', 14)} Admin phim</b> cho tài khoản này, rồi đăng xuất và đăng nhập lại.</p></div></div></section>`;
    return false;
  }
  return true;
}
function adminTabs(tab) {
  return `<div class="tabbar"><a class="${tab === 'films' ? 'on' : ''}" href="/indexmovie.html#/admin/films">Phim</a><a class="${tab === 'episodes' ? 'on' : ''}" href="/indexmovie.html#/admin/episodes">Tập phim</a><a href="/adminmovie.html">Link hỏng · SEO</a><a href="/analyticsmovie.html">Analytics</a></div>`;
}
function adminView(tab, arg) {
  setMeta({ title: 'Quản trị' });
  if (!adminGate()) return;
  if (tab === 'episodes') return adminEpisodes(arg || '');
  return adminFilms();
}

/* --- Phim --- */
const fld = (id, label, extra = '', full = false) => `<div class="field${full ? ' full' : ''}"><label for="f_${id}">${label}</label><input id="f_${id}" ${extra}></div>`;
function filmForm() {
  return `<form id="movieForm"><input type="hidden" id="f_id"><div class="form-grid">
    ${fld('name', 'Tên phim', 'required', true)}${fld('slug', 'Slug', 'required pattern="[A-Za-z0-9._\\-]+" title="Chỉ chữ, số, . _ -"')}${fld('original_name', 'Tên gốc')}
    ${fld('poster_url', 'Poster URL', 'type="url"')}${fld('thumb_url', 'Thumbnail URL', 'type="url"')}${fld('current_episode', 'Tập hiện tại', 'placeholder="Tập 1 / FULL"')}${fld('total_episodes', 'Tổng số tập', 'type="number" min="0"')}
    ${fld('year', 'Năm', 'type="number" min="1900" max="2100"')}${fld('quality', 'Chất lượng', 'placeholder="HD / FHD"')}${fld('language', 'Ngôn ngữ', 'placeholder="Vietsub"')}${fld('format', 'Định dạng', 'placeholder="Phim bộ"')}
    ${fld('director', 'Đạo diễn')}${fld('casts', 'Diễn viên')}${fld('genres', 'Thể loại (cách nhau dấu phẩy)', '', true)}${fld('countries', 'Quốc gia (cách nhau dấu phẩy)', '', true)}
    <div class="field full"><label for="f_description">Mô tả</label><textarea id="f_description"></textarea></div>
    <label class="check"><input type="checkbox" id="f_is_published" checked> Công khai</label><label class="check"><input type="checkbox" id="f_is_featured"> Nổi bật trên trang chủ</label>
  </div><div class="form-actions"><button class="btn primary" type="submit">${Icon('check')}Lưu phim</button><button class="btn ghost" type="button" id="importBtn">${Icon('upload')}Nhập từ API (theo slug)</button><button class="btn ghost" type="button" id="clearForm">${Icon('plus')}Mới</button></div><div class="status" id="formStatus"></div></form>`;
}
function fillForm(m) {
  for (const k of FIELDS) { const e = $('#f_' + k); if (e) e.value = Array.isArray(m[k]) ? m[k].join(', ') : (m[k] ?? ''); }
  $('#f_id').value = m.id || ''; $('#f_is_published').checked = m.is_published !== false; $('#f_is_featured').checked = !!m.is_featured;
  $('#formTitle').textContent = m.id ? 'Sửa phim' : 'Thêm phim';
}
function clearForm() { fillForm({}); $('#formStatus').textContent = ''; }
function readForm() {
  const v = k => ($('#f_' + k).value || '').trim(), n = k => { const x = Number(v(k)); return v(k) && isFinite(x) ? x : null; };
  const list = k => v(k).split(',').map(x => x.trim()).filter(Boolean);
  const o = v => v || null;
  return {
    name: v('name'), slug: v('slug'), original_name: o(v('original_name')), poster_url: o(v('poster_url')), thumb_url: o(v('thumb_url')),
    current_episode: o(v('current_episode')), total_episodes: n('total_episodes'), year: n('year'), quality: o(v('quality')), language: o(v('language')),
    director: o(v('director')), casts: o(v('casts')), format: o(v('format')), genres: list('genres'), countries: list('countries'), description: o(v('description')),
    is_published: $('#f_is_published').checked, is_featured: $('#f_is_featured').checked
  };
}
async function adminFilms() {
  adminPage = 1; adminQ = '';
  app.innerHTML = `<section class="admin-shell wrap"><div class="admin-top"><div><span class="eyebrow">Private workspace · admin phim</span><h1>Quản trị phim</h1><p class="muted">Nhập phim từ nguonc hoặc tạo phim riêng trong catalog Supabase. Phim ở đây hiện ở “Nổi bật” và “Catalog”, và ghi đè thông tin lấy từ API khi mở trang phim.</p></div></div>${adminTabs('films')}
  <div class="admin-layout wide"><section class="panel"><div class="panel-head"><h3 id="formTitle">Thêm phim</h3></div><div class="panel-body">${filmForm()}</div></section>
  <section class="panel"><div class="panel-head"><h3>Catalog Supabase</h3><span class="muted" id="movieCount">–</span></div><div class="panel-body" style="padding-bottom:0"><div class="searchbar"><input id="adminSearch" placeholder="Tìm theo tên hoặc slug"><button class="btn ghost" id="searchBtn">${Icon('search','',15)}Tìm</button></div></div><div class="admin-list" id="adminList"></div><div class="pagination" id="adminPages"></div></section></div></section>`;
  $('#movieForm').onsubmit = saveFilm; $('#clearForm').onclick = clearForm; $('#importBtn').onclick = importFilm;
  $('#searchBtn').onclick = () => { adminQ = $('#adminSearch').value.trim(); adminPage = 1; loadFilms(); };
  $('#adminSearch').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); $('#searchBtn').click(); } };
  loadFilms();
}
async function importFilm() {
  const slug = $('#f_slug').value.trim(); const st = $('#formStatus');
  if (!slug) return toast('Nhập slug trước');
  try {
    const m = normFilm(await api('/film/' + enc(slug))); if (!m) throw Error('Không có dữ liệu');
    fillForm({ ...m, id: '', is_published: true }); st.className = 'status ok'; st.textContent = 'Đã lấy metadata từ API. Kiểm tra rồi bấm Lưu phim. (Muốn nhập cả tập: lưu phim rồi sang tab Tập phim.)';
  } catch (e) { st.className = 'status bad'; st.textContent = 'Không lấy được phim từ API: ' + e.message; }
}
async function saveFilm(e) {
  e.preventDefault(); const st = $('#formStatus');
  try {
    const x = readForm(), id = $('#f_id').value;
    const r = await rpc('movie_admin_film_save', { p: { ...x, id: id || null } });
    if (r.error) throw r.error;
    st.className = 'status ok'; st.textContent = 'Đã lưu phim.'; toast('Đã lưu phim', 'ok'); clearForm(); loadFilms();
  } catch (err) { st.className = 'status bad'; st.textContent = err.message; }
}
async function loadFilms() {
  const per = 10;
  const res = await rpc('movie_admin_films_list', { p_q: adminQ, p_offset: (adminPage - 1) * per, p_limit: per });
  const r = res.error ? res : { error: null, data: (res.data && res.data.rows) || [], count: (res.data && res.data.total) || 0 };
  if (r.error) { $('#adminList').innerHTML = `<div class="empty">${esc(r.error.message)}<br>Đã chạy supabase.sql chưa?</div>`; return; }
  $('#movieCount').textContent = (r.count ?? r.data.length) + ' phim';
  $('#adminList').innerHTML = r.data.length ? r.data.map(m => `<div class="admin-row"><img src="${esc(imgUrl(m.thumb_url || m.poster_url))}" alt="" onerror="this.style.visibility='hidden'"><div><strong>${esc(m.name)}</strong><small>${esc(m.slug)} · ${esc(m.current_episode || 'FULL')}</small><div class="badges"><span class="pill ${m.is_published ? 'ok' : 'bad'}">${m.is_published ? 'Công khai' : 'Nháp'}</span>${m.is_featured ? '<span class="pill">Nổi bật</span>' : ''}</div></div>
    <div class="row-actions"><button data-edit="${esc(m.id)}">${Icon('edit','',13)}Sửa</button><button data-pub="${esc(m.id)}">${m.is_published ? Icon('eyeOff','',13) : Icon('eye','',13)}${m.is_published ? 'Ẩn' : 'Công khai'}</button><button data-feat="${esc(m.id)}">${Icon('star','',13)}${m.is_featured ? 'Bỏ nổi bật' : 'Nổi bật'}</button><button data-eps="${esc(m.slug)}">${Icon('layers','',13)}Tập</button><a class="btn ghost" style="padding:6px 8px;font-size:11px" href="/phim/${enc(m.slug)}">${Icon('external','',13)}Xem</a><button data-del="${esc(m.id)}">${Icon('trash','',13)}Xoá</button></div></div>`).join('') : '<div class="empty">Chưa có phim. Dùng form bên trái để thêm.</div>';
  const byId = id => r.data.find(x => x.id === id);
  $$('[data-edit]').forEach(b => b.onclick = () => { fillForm(byId(b.dataset.edit)); window.scrollTo({ top: 0, behavior: 'smooth' }); });
  const toggle = (attr, col) => $$(`[data-${attr}]`).forEach(b => b.onclick = async () => { const m = byId(b.dataset[attr]); const x = await rpc('movie_admin_film_toggle', { p_id: m.id, p_col: col, p_val: !m[col] }); x.error ? toast(x.error.message, 'bad') : loadFilms(); });
  toggle('pub', 'is_published'); toggle('feat', 'is_featured');
  $$('[data-eps]').forEach(b => b.onclick = () => location.hash = '#/admin/episodes/' + enc(b.dataset.eps));
  $$('[data-del]').forEach(b => b.onclick = async () => { if (!confirm('Xoá phim này khỏi catalog?')) return; const x = await rpc('movie_admin_film_delete', { p_id: b.dataset.del }); x.error ? toast(x.error.message, 'bad') : loadFilms(); });
  const tp = Math.max(1, Math.ceil((r.count || 0) / per));
  $('#adminPages').innerHTML = tp > 1 ? `<button class="btn ghost" id="pgPrev" ${adminPage <= 1 ? 'disabled' : ''}>${Icon('chevronLeft','',15)}</button><span class="muted">${adminPage}/${tp}</span><button class="btn ghost" id="pgNext" ${adminPage >= tp ? 'disabled' : ''}>${Icon('chevronRight','',15)}</button>` : '';
  if (tp > 1) { $('#pgPrev').onclick = () => { adminPage--; loadFilms(); }; $('#pgNext').onclick = () => { adminPage++; loadFilms(); }; }
}

/* --- Tập phim (bảng episodes) --- */
async function adminEpisodes(slug) {
  app.innerHTML = `<section class="admin-shell wrap"><div class="admin-top"><div><span class="eyebrow">Private workspace · admin phim</span><h1>Tập phim</h1><p class="muted">Thêm/sửa server và tập cho một phim. Tập ở đây được gộp vào trang xem cùng với tập từ API (cùng server + cùng tên tập thì bản của bạn được ưu tiên).</p></div></div>${adminTabs('episodes')}
  <div class="admin-layout wide"><section class="panel"><div class="panel-head"><h3 id="e_title">Thêm tập</h3></div><div class="panel-body">
    <div class="field" style="margin-bottom:14px"><label for="e_slug">Slug phim</label><div class="searchbar" style="margin:0"><input id="e_slug" list="slugList" value="${esc(slug)}" placeholder="vd: hoa-thien-cot"><button class="btn ghost" id="e_load" type="button">${Icon('search','',15)}Tải</button></div><datalist id="slugList"></datalist></div>
    <form id="e_form"><input type="hidden" id="e_id"><div class="form-grid">
      <div class="field"><label for="e_server">Server</label><input id="e_server" required placeholder="Vietsub #1"></div><div class="field"><label for="e_name">Tên tập</label><input id="e_name" required placeholder="1 / FULL"></div>
      <div class="field full"><label for="e_embed">Embed URL</label><input id="e_embed" type="url"></div><div class="field full"><label for="e_m3u8">M3U8 URL</label><input id="e_m3u8" type="url"></div>
      <label class="check"><input type="checkbox" id="e_active" checked> Đang bật</label></div>
      <div class="form-actions"><button class="btn primary" type="submit">${Icon('check')}Lưu tập</button><button class="btn ghost" type="button" id="e_new">${Icon('plus')}Mới</button><button class="btn ghost" type="button" id="e_import">${Icon('upload')}Nhập tất cả tập từ API</button></div><div class="status" id="e_status"></div></form>
  </div></section>
  <section class="panel"><div class="panel-head"><h3>Danh sách tập</h3><span class="muted" id="e_count">–</span></div><div id="e_list"><div class="empty">Nhập slug phim rồi bấm Tải.</div></div></section></div></section>`;
  S.sb.from('movie_films').select('slug').order('updated_at', { ascending: false }).limit(300).then(r => { const dl = $('#slugList'); if (dl && r.data) dl.innerHTML = r.data.map(x => `<option value="${esc(x.slug)}">`).join(''); });
  const st = (m, ok) => { $('#e_status').className = 'status ' + (ok ? 'ok' : 'bad'); $('#e_status').textContent = m; };
  const curSlug = () => $('#e_slug').value.trim();
  const clearEp = () => { $('#e_id').value = ''; $('#e_name').value = ''; $('#e_embed').value = ''; $('#e_m3u8').value = ''; $('#e_active').checked = true; $('#e_title').textContent = 'Thêm tập'; };
  async function load() {
    const s = curSlug(); if (!s) return;
    history.replaceState(null, '', '#/admin/episodes/' + enc(s));
    const r = await rpc('movie_admin_eps_list', { p_slug: s });
    if (r.error) { $('#e_list').innerHTML = `<div class="empty">${esc(r.error.message)}</div>`; return; }
    const rows = r.data.sort((a, b) => natCmp(a.server_name, b.server_name) || natCmp(a.episode_name, b.episode_name));
    $('#e_count').textContent = rows.length + ' tập';
    $('#e_list').innerHTML = rows.length ? rows.map(e => `<div class="ep-row"><div><b>${esc(e.server_name)}</b> · Tập ${esc(e.episode_name)} <span class="pill ${e.is_active ? 'ok' : 'bad'}">${e.is_active ? 'bật' : 'tắt'}</span><small>${esc(e.m3u8_url || '')}</small><small>${esc(e.embed_url || '')}</small></div><div class="row-actions"><button data-ed="${esc(e.id)}">${Icon('edit','',13)}Sửa</button><button data-tg="${esc(e.id)}">${e.is_active ? Icon('eyeOff','',13) : Icon('eye','',13)}${e.is_active ? 'Tắt' : 'Bật'}</button><button data-dl="${esc(e.id)}">${Icon('trash','',13)}Xoá</button></div></div>`).join('') : '<div class="empty">Chưa có tập nào trong bảng episodes cho phim này.</div>';
    const by = id => rows.find(x => x.id === id);
    $$('[data-ed]').forEach(b => b.onclick = () => { const e = by(b.dataset.ed); $('#e_id').value = e.id; $('#e_server').value = e.server_name; $('#e_name').value = e.episode_name; $('#e_embed').value = e.embed_url || ''; $('#e_m3u8').value = e.m3u8_url || ''; $('#e_active').checked = e.is_active; $('#e_title').textContent = 'Sửa tập'; });
    $$('[data-tg]').forEach(b => b.onclick = async () => { const e = by(b.dataset.tg); const x = await rpc('movie_admin_ep_toggle', { p_id: e.id, p_val: !e.is_active }); x.error ? toast(x.error.message, 'bad') : load(); });
    $$('[data-dl]').forEach(b => b.onclick = async () => { if (!confirm('Xoá tập này?')) return; const x = await rpc('movie_admin_ep_delete', { p_id: b.dataset.dl }); x.error ? toast(x.error.message, 'bad') : load(); });
  }
  $('#e_load').onclick = load; $('#e_new').onclick = clearEp;
  $('#e_form').onsubmit = async ev => {
    ev.preventDefault(); const s = curSlug(); if (!s) return st('Nhập slug phim trước', false);
    const embed = $('#e_embed').value.trim(), m3u8 = $('#e_m3u8').value.trim();
    if (!embed && !m3u8) return st('Cần ít nhất một link (embed hoặc m3u8)', false);
    if ((embed && !safeUrl(embed)) || (m3u8 && !safeUrl(m3u8))) return st('Link phải bắt đầu bằng http:// hoặc https://', false);
    const row = { film_slug: s, server_name: $('#e_server').value.trim(), episode_name: $('#e_name').value.trim(), embed_url: embed || null, m3u8_url: m3u8 || null, is_active: $('#e_active').checked };
    const id = $('#e_id').value;
    const r = await rpc('movie_admin_ep_save', { p: { ...row, id: id || null } });
    if (r.error) return st(r.error.message, false);
    st('Đã lưu tập.', true); clearEp(); load();
  };
  $('#e_import').onclick = async () => {
    const s = curSlug(); if (!s) return st('Nhập slug phim trước', false);
    try {
      st('Đang lấy tập từ API…', true);
      const m = normFilm(await api('/film/' + enc(s))); if (!m || !m.servers.length) throw Error('API không có tập nào cho phim này');
      const rows = m.servers.flatMap(sv => sv.items.map(i => ({ film_slug: s, server_name: sv.name, episode_name: i.name, embed_url: i.embed || null, m3u8_url: i.m3u8 || null, is_active: true })));
      for (let i = 0; i < rows.length; i += 500) { const r = await rpc('movie_admin_eps_import', { p_rows: rows.slice(i, i + 500) }); if (r.error) throw r.error; }
      st(`Đã nhập ${rows.length} tập.`, true); load();
    } catch (e) { st(e.message, false); }
  };
  if (slug) load();
}

/* ---------- guide ---------- */
function guideView() {
  setMeta({ title: 'Hướng dẫn' });
  app.innerHTML = `<section class="section wrap"><span class="eyebrow">Hướng dẫn</span><h1 class="serif" style="font-size:42px;margin:8px 0 22px">Cách dùng Thư Viện Phim</h1>
  <div class="acct-grid">
    <div class="panel"><div class="panel-head"><h3>Người xem</h3></div><div class="panel-body"><ol class="desc"><li>Đăng nhập bằng <b>Tên + Mã định danh</b> (giống web Thư Viện Bài Soạn).</li><li>Chọn phim ở trang chủ, lọc theo Danh sách / Thể loại / Quốc gia / Năm, hoặc gõ vào ô tìm kiếm.</li><li>Ở trang phim bấm <b>${Icon('play', '', 13)} Xem ngay</b>, chọn server và tập. Nếu HLS không chạy, đổi sang <b>Embed</b>.</li><li>Dùng <b>Yêu thích</b>, <b>Lịch sử</b> (tự nhớ tập và phút đang xem) và <b>Báo lỗi</b> khi link hỏng.</li></ol></div></div>
    <div class="panel"><div class="panel-head"><h3>Quản trị</h3></div><div class="panel-body"><ol class="desc"><li>Chạy <b>supabase.sql</b> trong Supabase SQL Editor (một lần).</li><li>Vào <b>manage.html ${Icon('chevronRight', '', 13)} Mã định danh</b>, bật ô <b>${Icon('film', '', 14)} Admin phim</b> cho tài khoản cần quyền.</li><li>Người đó đăng nhập lại ${Icon('chevronRight', '', 13)} menu hiện <b>Quản trị</b>: thêm/sửa phim, nổi bật, công khai/nháp; tab <b>Tập phim</b>: thêm tập riêng hoặc nhập tập từ API.</li><li><b>Vận hành</b> (adminmovie.html): link hỏng, SEO. <b>Analytics</b> (analyticsmovie.html): lượt xem.</li></ol></div></div>
  </div></section>`;
}

/* ---------- router + boot ---------- */
function route() {
  closeMenus(); routeTok++; stopPlayer(); stopHero(); setMeta({});
  const pm = location.pathname.match(/^\/phim\/([^/]+)/);
  if (pm) return filmView(decodeURIComponent(pm[1]));
  const p = location.hash.replace(/^#\/?/, '').split('/').map(x => { try { return decodeURIComponent(x); } catch { return x; } });
  const [a, b, c, d] = p;
  if (a !== 'admin') window.scrollTo(0, 0);
  const active = a ? '/indexmovie.html#/' + a : '/indexmovie.html#/';
  $$('#nav > a').forEach(l => l.classList.toggle('active', l.getAttribute('href').startsWith(active) && (a || l.getAttribute('href') === '/indexmovie.html#/')));
  $$('#nav details.dd').forEach(d => d.querySelector('summary').classList.toggle('active-path', a === 'list' && [...d.querySelectorAll('a')].some(l => l.getAttribute('href') === active + '/' + b + '/' + enc(c) + '/1')));
  switch (a) {
    case 'list': return listView(b, c, +d || 1);
    case 'search': return searchView(b || '', +c || 1);
    case 'new': return newView(+b || 1);
    case 'catalog': return catalogView(+b || 1);
    case 'favorites': return favoritesView();
    case 'history': return historyView();
    case 'account': return accountView();
    case 'admin': return adminView(b || 'films', c);
    case 'guide': return guideView();
    default: return home();
  }
}
function initTheme() {
  let t = localStorage.getItem('tvp-v2-theme') || 'light'; document.documentElement.dataset.theme = t;
  $$('.theme [data-theme]').forEach(b => { b.classList.toggle('on', b.dataset.theme === t); b.onclick = () => { t = b.dataset.theme; document.documentElement.dataset.theme = t; localStorage.setItem('tvp-v2-theme', t); $$('.theme [data-theme]').forEach(x => x.classList.toggle('on', x.dataset.theme === t)); }; });
}
async function boot() {
  initTheme();
  $('#menuBtn').innerHTML = Icon('menu');
  $('#hsearch button').innerHTML = Icon('search');
  $$('.theme button').forEach(b => { const n = b.dataset.theme === 'dark' ? 'moon' : 'sun'; b.innerHTML = Icon(n) + (b.dataset.theme === 'dark' ? ' Tối' : ' Sáng'); });
  $('#menuBtn').onclick = () => $('#nav').classList.toggle('open');
  $('#nav').addEventListener('click', e => { if (e.target.closest('a')) closeMenus(); });
  $('#hsearch').onsubmit = e => { e.preventDefault(); const q = $('#hq').value.trim(); if (q) location.href = '/indexmovie.html#/search/' + enc(q) + '/1'; };
  window.addEventListener('hashchange', route);
  await refreshAuth(); renderHeader();
  route();
}
// Đăng nhập bằng Tên + Mã định danh (khung + logic giống index.html) rồi mới khởi động trang
MV.init({ page: 'Thư viện phim', online: true, lock: true }).then(boot);
