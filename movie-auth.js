/* =========================================================================
   movie-auth.js — ĐĂNG NHẬP BẰNG TÊN + MÃ ĐỊNH DANH cho Thư Viện Phim
   -------------------------------------------------------------------------
   Dùng chung cho indexmovie.html, adminmovie.html, analyticsmovie.html.
   Khung đăng nhập + logic được chuyển từ index.html của web Thư Viện Bài Soạn:
     • bảng user_identities (Tên + Mã định danh, có mã dự phòng, có thu hồi)
     • ghi nhớ đăng nhập theo thiết bị (remembered_logins, kind = 'student')
     • khoá phiên duy nhất (active_sessions, heartbeat 20s, hết hạn 40s)
     • lịch sử đăng nhập (login_history), người đang online (online_users)
     • sessionStorage dùng chung: gb_username / gb_identity_code / gb_session_token
   Khác biệt: sau khi đăng nhập, trang admin/analytics kiểm tra thêm cột
   user_identities.can_access_movie_admin (bật trong manage.html → Mã định danh).

   Cách dùng:  MV.init({ page:'Thư viện phim', online:true, lock:true, requireAdmin:false })
                 .then(user => { ...khởi động trang... })
               MV.rpc('ten_ham', {p_...}) tự gắn p_name/p_code của người đang đăng nhập.
   ========================================================================= */
(function () {
  'use strict';

  var SUPABASE_URL = 'https://vuunoamkaokfvxpaftno.supabase.co';
  var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ1dW5vYW1rYW9rZnZ4cGFmdG5vIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ1NTkxODcsImV4cCI6MjEwMDEzNTE4N30.7ie-uNPswMdQL6Amab-QMjvx3i55NWXoWgq81yProiE';
  var SESSION_LOCK_TIMEOUT_MS = 40000;
  var TABLE_MISSING = /relation .* does not exist|42P01/i;

  var MV = window.MV = { user: null, sb: null, opts: {} };
  var sb = null;
  var cur = { name: '', code: '', token: '' };
  var _lockTimer = null, _onlineTimer = null, _ready = false, _resolve = null;
  var _myIp = null, _myLocation = null, _deviceId = null;

  /* ---------------------------------------------------------------- CSS + DOM */
  var CSS = [
    '#global-page-loader{position:fixed;inset:0;z-index:999999;background:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;transition:opacity .35s ease,visibility .35s ease}',
    '#global-page-loader.gpl-hide{opacity:0;visibility:hidden;pointer-events:none}',
    '.gpl-spinner{width:56px;height:56px;border-radius:50%;border:5px solid #fbd7e4;position:relative}',
    '.gpl-spinner span{position:absolute;inset:-5px;border-radius:50%;border:5px solid transparent;border-top-color:#ec1561;border-right-color:#ec1561;animation:gpl-spin .8s linear infinite}',
    ".gpl-text{margin:0;font-family:'Baloo 2','Quicksand','Mali','Segoe UI',sans-serif;font-weight:700;font-size:15px;color:#3f3a4a;letter-spacing:.2px}",
    '@keyframes gpl-spin{to{transform:rotate(360deg)}}',
    '.gate-overlay{position:fixed;inset:0;z-index:2000;display:none;align-items:center;justify-content:center;',
    'background:radial-gradient(ellipse at 15% -10%, #16264a 0%, transparent 55%),radial-gradient(ellipse at 85% 110%, #0d1730 0%, transparent 55%),linear-gradient(180deg,#0b1024 0%,#16223f 35%,#274670 65%,#3f6ea5 100%);overflow:hidden;font-family:"Mali",sans-serif}',
    '.gate-overlay *{box-sizing:border-box}',
    '.gate-overlay .gate-nav{position:absolute;top:0;left:0;right:0;padding:18px 26px;display:flex;align-items:center;justify-content:space-between}',
    '.gate-overlay .gate-nav-logo{display:flex;align-items:center;gap:8px}',
    '.gate-overlay .gate-nav-logo img{width:34px;height:34px}',
    ".gate-overlay .gate-nav-logo span{color:#fff;font-family:'Baloo 2',sans-serif;font-weight:800;font-size:16px;letter-spacing:.3px}",
    '.gate-trees{position:absolute;inset:0;pointer-events:none;opacity:.55}',
    '.gate-trees svg{width:100%;height:100%}',
    '.gate-box{position:relative;z-index:2;width:min(400px,90vw);padding:30px 30px 26px;border-radius:26px;background:rgba(255,255,255,.14);backdrop-filter:blur(22px) saturate(140%);-webkit-backdrop-filter:blur(22px) saturate(140%);box-shadow:0 20px 60px -12px rgba(0,0,0,.55),0 0 0 1px rgba(255,255,255,.18) inset;animation:gateBoxIn .5s cubic-bezier(.16,1,.3,1)}',
    '@keyframes gateBoxIn{from{opacity:0;transform:translateY(14px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}',
    ".gate-box h2{margin:0 0 22px;text-align:center;color:#fff;font-family:'Baloo 2',sans-serif;font-weight:800;font-size:22px;letter-spacing:.3px}",
    '.gate-field{position:relative;margin-bottom:20px}',
    ".gate-field input{width:100%;background:transparent;border:none;border-bottom:1.5px solid rgba(255,255,255,.4);color:#fff;font-family:'Mali',sans-serif;font-size:14.5px;padding:6px 26px 8px 2px;outline:none;transition:border-color .2s ease}",
    '.gate-field input::placeholder{color:rgba(255,255,255,.55)}',
    '.gate-field input:focus{border-color:#fff}',
    '.gate-field .gate-icon{position:absolute;right:2px;top:6px;opacity:.85}',
    '.gate-remember{display:flex;align-items:center;gap:8px;color:rgba(255,255,255,.85);font-size:12.5px;margin:2px 0 20px;cursor:pointer}',
    '.gate-remember input{width:auto}',
    ".gate-btn{width:100%;padding:13px;border:none;border-radius:12px;background:#0f1b33;color:#fff;font-family:'Baloo 2',sans-serif;font-weight:700;font-size:15px;letter-spacing:.3px;box-shadow:0 6px 18px -4px rgba(0,0,0,.4);transition:transform .18s ease,background .18s ease;cursor:pointer;display:block;text-align:center;text-decoration:none}",
    '.gate-btn:hover{transform:translateY(-2px);background:#16264a}',
    '.gate-btn.alt{background:rgba(255,255,255,.16);margin-top:10px}',
    '.gate-help{text-align:center;margin-top:14px;font-size:11.5px;color:rgba(255,255,255,.45)}',
    '.gate-sub{text-align:center;margin:-12px 0 18px;font-size:12.5px;color:rgba(255,255,255,.7);display:flex;align-items:center;justify-content:center;gap:6px}',
    '.gate-err{display:none;background:rgba(244,92,134,.18);color:#ffd7e2;font-size:12.5px;padding:8px 12px;border-radius:10px;margin-bottom:14px;text-align:center}',
    '.gate-overlay.claude{background:#181715}',
    '.gate-overlay.claude .gate-trees{display:none}',
    '.gate-overlay.claude .gate-box{background:#252320;border:1px solid #33312c;box-shadow:none}',
    '.gate-overlay.claude .gate-btn{background:#CC785C;border-radius:8px}',
    '.gate-overlay.claude .gate-btn:hover{background:#A9583E}',
    '.gate-overlay.claude .gate-field input:focus{border-color:#CC785C}'
  ].join('\n');

  function el(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function mountUi() {
    if (el('gateOverlay')) return;
    if (!document.querySelector('link[data-mv-fonts]')) {
      var f = document.createElement('link'); f.rel = 'stylesheet'; f.setAttribute('data-mv-fonts', '1');
      f.href = 'https://fonts.googleapis.com/css2?family=Mali:wght@400;500;600;700;800&family=Baloo+2:wght@500;600;700;800&family=Quicksand:wght@500;600;700&display=swap';
      document.head.appendChild(f);
    }
    var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    var claude = false; try { claude = localStorage.getItem('gb_ui_theme') === 'claude'; } catch (e) { }
    var wrap = document.createElement('div');
    wrap.innerHTML =
      '<div id="global-page-loader" role="status" aria-live="polite" aria-label="Đang tải trang"><div class="gpl-spinner"><span></span></div><p class="gpl-text">Đang tải...</p></div>' +
      '<div class="gate-overlay' + (claude ? ' claude' : '') + '" id="gateOverlay">' +
      '<div class="gate-nav"><div class="gate-nav-logo"><img src="/movie-gate-logo.png" alt=""><span>Thư Viện Phim</span></div></div>' +
      '<div class="gate-trees"><svg viewBox="0 0 1200 700" preserveAspectRatio="xMidYMax slice" xmlns="http://www.w3.org/2000/svg">' +
      '<g fill="#0a1730" opacity="0.9"><polygon points="60,700 100,520 140,700"/><polygon points="150,700 200,470 250,700"/><polygon points="950,700 1000,480 1050,700"/><polygon points="1060,700 1110,510 1160,700"/></g>' +
      '<g fill="#13234a" opacity="0.75"><polygon points="0,700 60,560 130,700"/><polygon points="1080,700 1150,540 1200,700"/><polygon points="300,700 340,600 380,700"/><polygon points="820,700 860,590 900,700"/></g>' +
      '<path d="M560 700 L560 560 Q520 540 540 500 Q500 490 520 450 Q560 460 580 430 Q600 460 640 450 Q660 490 620 500 Q640 540 600 560 L600 700 Z" fill="#0a1730" opacity="0.55"/></svg></div>' +
      '<div class="gate-box" id="gateBox"></div></div>';
    while (wrap.firstChild) document.body.appendChild(wrap.firstChild);
    renderLoginForm();
  }

  function renderLoginForm() {
    var sub = MV.opts.requireAdmin ? '<div class="gate-sub">' + (window.Icon ? Icon('edit', 'gate-sub-ic', 15) : '') + 'Khu vực quản trị phim — cần được cấp quyền</div>' : '';
    el('gateBox').innerHTML =
      '<h2>Đăng nhập</h2>' + sub +
      '<div class="gate-err" id="gateErr"></div>' +
      '<div class="gate-field"><input type="text" id="gateNameInput" placeholder="Tên đăng nhập" autocomplete="username">' +
      '<svg class="gate-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.7)" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6"/></svg></div>' +
      '<div class="gate-field"><input type="text" id="gateCodeInput" placeholder="Mã định danh" autocomplete="off">' +
      '<svg class="gate-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.7)" stroke-width="2"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a4 4 0 0 1 8 0v2"/></svg></div>' +
      '<label class="gate-remember"><input type="checkbox" id="gateRememberMe"> Ghi nhớ đăng nhập</label>' +
      '<button class="gate-btn" id="gateSubmitBtn" type="button">Đăng nhập</button>' +
      '<div class="gate-help">Liên hệ Gia Bảo nếu gặp vấn đề</div>';
    el('gateNameInput').onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); el('gateCodeInput').focus(); } };
    el('gateCodeInput').onkeydown = function (e) { if (e.key === 'Enter') submitGate(); };
    el('gateSubmitBtn').onclick = submitGate;
  }

  function showGate(msg) {
    if (!el('gateBox')) return;
    if (!el('gateNameInput')) renderLoginForm();
    el('gateOverlay').style.display = 'flex';
    document.documentElement.style.overflow = 'hidden';
    hideLoader();
    if (msg) showGateError(msg);
  }
  function hideGate() {
    el('gateOverlay').style.display = 'none';
    document.documentElement.style.overflow = '';
    hideLoader();
  }
  function hideLoader() {
    var l = el('global-page-loader'); if (!l || l.dataset.hidden) return;
    l.dataset.hidden = '1'; l.classList.add('gpl-hide'); setTimeout(function () { l.remove(); }, 400);
  }
  function showGateError(msg) {
    var e = el('gateErr'); if (!e) return; e.innerHTML = (window.Icon ? Icon('alert', null, 16) : '') + '<span>' + esc(msg) + '</span>'; e.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:8px';
  }
  function showDenied(name) {
    el('gateOverlay').style.display = 'flex'; document.documentElement.style.overflow = 'hidden'; hideLoader();
    el('gateBox').innerHTML =
      '<h2>Chưa có quyền truy cập</h2>' +
      '<div class="gate-err" style="display:flex;align-items:center;gap:8px">' + (window.Icon ? Icon('alert', null, 16) : '') + '<span>Tài khoản <b>' + esc(name) + '</b> chưa được cấp quyền vào trang quản trị phim.</span></div>' +
      '<div class="gate-help" style="margin:0 0 16px;color:rgba(255,255,255,.7)">Nhờ quản lý bật quyền trong <b>manage.html ' + (window.Icon ? Icon('chevronRight', null, 13) : '') + ' Mã định danh</b> (ô “' + (window.Icon ? Icon('film', null, 13) : '') + ' Admin phim”).</div>' +
      '<a class="gate-btn" href="/indexmovie.html" style="display:flex;align-items:center;justify-content:center;gap:6px">' + (window.Icon ? Icon('chevronLeft', null, 15) : '') + 'Về trang phim</a>' +
      '<button class="gate-btn alt" id="gateSwitchBtn" type="button">Đăng nhập tài khoản khác</button>';
    el('gateSwitchBtn').onclick = function () { MV.logout(); };
  }

  /* ---------------------------------------------------------------- tiện ích thiết bị / IP */
  function getMyIp() {
    if (_myIp) return Promise.resolve(_myIp);
    return fetch('https://api.ipify.org?format=json').then(function (r) { return r.json(); })
      .then(function (d) { _myIp = d.ip || null; return _myIp; }).catch(function () { return null; });
  }
  function getMyLocation() {
    if (_myLocation) return Promise.resolve(_myLocation);
    return fetch('https://ipapi.co/json/').then(function (r) { return r.json(); }).then(function (d) {
      if (d && !d.error) _myLocation = { city: d.city || null, region: d.region || null, country: d.country_name || null };
      return _myLocation;
    }).catch(function () { return null; });
  }
  async function buildDeviceInfo() {
    var ua = navigator.userAgent || '';
    var deviceType = 'Máy tính (Desktop/Laptop)';
    if (/iPad|Android(?!.*Mobile)|Tablet/i.test(ua)) deviceType = 'Máy tính bảng';
    else if (/Mobi|iPhone|iPod|Android.*Mobile|Windows Phone/i.test(ua)) deviceType = 'Điện thoại di động';
    var os = 'Không rõ', m;
    var win = ua.match(/Windows NT (\d+\.\d+)/);
    if (win) { var wv = { '10.0': 'Windows 10/11', '6.3': 'Windows 8.1', '6.2': 'Windows 8', '6.1': 'Windows 7' }; os = wv[win[1]] || ('Windows (NT ' + win[1] + ')'); }
    else if (/Mac OS X (\d+[._]\d+)/.test(ua)) { m = ua.match(/Mac OS X (\d+[._]\d+(?:[._]\d+)?)/); os = 'macOS ' + (m ? m[1].replace(/_/g, '.') : ''); }
    else if (/Android (\d+(\.\d+)?)/.test(ua)) { m = ua.match(/Android (\d+(\.\d+)?)/); os = 'Android ' + (m ? m[1] : ''); }
    else if (/iPhone OS (\d+[._]\d+)/.test(ua) || /CPU OS (\d+[._]\d+)/.test(ua)) { m = ua.match(/(?:iPhone OS|CPU OS) (\d+[._]\d+)/); os = 'iOS ' + (m ? m[1].replace(/_/g, '.') : ''); }
    else if (/Linux/.test(ua)) os = 'Linux';
    var browser = 'Không rõ';
    if (/Edg\//.test(ua)) browser = 'Microsoft Edge';
    else if (/OPR\//.test(ua)) browser = 'Opera';
    else if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) browser = 'Chrome';
    else if (/Firefox\//.test(ua)) browser = 'Firefox';
    else if (/Safari\//.test(ua) && !/Chrome/.test(ua)) browser = 'Safari';
    var info = {
      deviceType: deviceType, os: os, browser: browser,
      cores: navigator.hardwareConcurrency || null, mem: navigator.deviceMemory || null,
      screen: (screen.width && screen.height) ? (screen.width + '×' + screen.height) : null, brand: null, ua: ua
    };
    if (os.indexOf('macOS') === 0) info.brand = 'Apple (macOS)'; else if (os.indexOf('iOS') === 0) info.brand = 'Apple';
    try {
      if (navigator.userAgentData && navigator.userAgentData.getHighEntropyValues) {
        var u = await navigator.userAgentData.getHighEntropyValues(['platformVersion', 'model']);
        if (navigator.userAgentData.platform === 'Windows' && u.platformVersion) info.os = parseInt(u.platformVersion.split('.')[0], 10) >= 13 ? 'Windows 11' : 'Windows 10';
        if (u.model) info.brand = u.model;
      }
    } catch (e) { }
    return info;
  }
  async function logLoginHistory() {
    var id = 'login_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    var at = new Date().toISOString(), ip = null, loc = null, dev = null;
    try { ip = await getMyIp(); loc = await getMyLocation(); dev = await buildDeviceInfo(); } catch (e) { }
    var full = { id: id, user_name: cur.name, ip: ip || null, location: loc ? JSON.stringify(loc) : null, logged_in_at: at, device_info: dev ? JSON.stringify(dev) : null };
    try {
      var r = await sb.from('login_history').insert(full);
      if (!r.error) return;
      if (/column .* does not exist|42703|could not find/i.test((r.error.message || '') + (r.error.code || ''))) {
        await sb.from('login_history').insert({ id: id, user_name: cur.name, ip: ip || null, logged_in_at: at });
      }
    } catch (e) { }
  }
  function getDeviceFingerprint() {
    try {
      var s = [navigator.userAgent, navigator.language, screen.width + 'x' + screen.height, Intl.DateTimeFormat().resolvedOptions().timeZone].join('|');
      var h = 0; for (var i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
      return 'fp' + Math.abs(h).toString(36);
    } catch (e) { return 'fp0'; }
  }
  function getDeviceId() {
    if (_deviceId) return _deviceId;
    try { _deviceId = localStorage.getItem('gb_device_id') || ''; } catch (e) { _deviceId = ''; }
    if (!_deviceId) {
      _deviceId = 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
      try { localStorage.setItem('gb_device_id', _deviceId); } catch (e) { }
    }
    return _deviceId;
  }
  function rememberKey(kind) { return kind + '_' + getDeviceId(); }

  /* ---------------------------------------------------------------- ghi nhớ đăng nhập */
  async function saveRemembered(kind, code, name) {
    var key = rememberKey(kind);
    try {
      await sb.from('remembered_logins').upsert({ id: key, kind: kind, ip: _myIp || null, fingerprint: getDeviceFingerprint(), identity_code: code, display_name: name || null, last_seen: new Date().toISOString() });
    } catch (e) { return; }
    try { getMyIp().then(function (ip) { if (ip) return sb.from('remembered_logins').update({ ip: ip }).eq('id', key); }).catch(function () { }); } catch (e) { }
  }
  async function loadRemembered(kind) {
    try {
      var r = await sb.from('remembered_logins').select('*').eq('id', rememberKey(kind)).maybeSingle();
      if (!r.error && r.data) return r.data;
    } catch (e) { }
    return null;
  }
  async function clearRemembered(kind) {
    try { await sb.from('remembered_logins').delete().eq('id', rememberKey(kind)); } catch (e) { }
  }

  /* ---------------------------------------------------------------- định danh */
  // Trả về { row, error }. row = dòng user_identities còn hiệu lực (khớp Tên + mã chính hoặc mã dự phòng).
  async function fetchIdentity(name, code) {
    try {
      var r = await sb.from('user_identities').select('*').eq('display_name', name).eq('identity_code', code).eq('revoked', false).maybeSingle();
      if (r.error) return { row: null, error: r.error };
      if (r.data) return { row: r.data, error: null };
      try {
        var r2 = await sb.from('user_identities').select('*').eq('display_name', name).eq('backup_code', code).eq('revoked', false).maybeSingle();
        if (r2.data) return { row: r2.data, error: null };
      } catch (e2) { /* cột backup_code có thể chưa tồn tại */ }
      return { row: null, error: null };
    } catch (e) { return { row: null, error: e }; }
  }

  /* ---------------------------------------------------------------- khoá phiên duy nhất */
  async function acquireOrVerifySession(code, name) {
    var token = cur.token || (Date.now() + '_' + Math.random().toString(36).slice(2, 10));
    try {
      var r = await sb.from('active_sessions').select('*').eq('identity_code', code).maybeSingle();
      if (r.error && TABLE_MISSING.test((r.error.message || '') + (r.error.code || ''))) return { ok: true };
      if (r.data) {
        var seen = r.data.last_seen ? new Date(r.data.last_seen).getTime() : 0;
        var stale = !r.data.last_seen || (Date.now() - seen) > SESSION_LOCK_TIMEOUT_MS;
        var mine = r.data.session_token && r.data.session_token === token;
        if (!stale && !mine) return { ok: false };
      }
      var up = await sb.from('active_sessions').upsert({ identity_code: code, session_token: token, display_name: name, last_seen: new Date().toISOString() });
      cur.token = token; try { sessionStorage.setItem('gb_session_token', token); } catch (e) { }
      if (up.error) console.warn('Chưa ghi được khoá phiên, sẽ thử lại ở nhịp sau:', up.error);
      return { ok: true };
    } catch (e) { return { ok: true }; }
  }
  function startLockHeartbeat() { clearInterval(_lockTimer); _lockTimer = setInterval(renewSessionLock, 20000); }
  function stopLockHeartbeat() { clearInterval(_lockTimer); _lockTimer = null; }
  async function renewSessionLock() {
    if (!cur.code || !cur.token) return;
    try {
      var r = await sb.from('active_sessions').update({ last_seen: new Date().toISOString(), display_name: cur.name })
        .eq('identity_code', cur.code).eq('session_token', cur.token).select();
      if (r.error) return;
      if (r.data && r.data.length) return;
      var c = await sb.from('active_sessions').select('session_token').eq('identity_code', cur.code).maybeSingle();
      if (c.error) return;
      if (!c.data) {
        await sb.from('active_sessions').upsert({ identity_code: cur.code, session_token: cur.token, display_name: cur.name, last_seen: new Date().toISOString() });
        return;
      }
      if (c.data.session_token !== cur.token) forceKick();
    } catch (e) { }
  }
  function forceKick() {
    stopLockHeartbeat(); stopOnline(); removeOnlineRow();
    clearSession();
    showGate('Tài khoản của bạn vừa được đăng nhập ở nơi khác nên phiên này đã kết thúc');
  }
  function clearSession() {
    try { sessionStorage.removeItem('gb_username'); sessionStorage.removeItem('gb_identity_code'); sessionStorage.removeItem('gb_session_token'); } catch (e) { }
    cur = { name: '', code: '', token: '' };
    MV.user = null;
  }

  /* ---------------------------------------------------------------- online */
  async function pingOnline() {
    if (!cur.name || !MV.opts.online) return;
    try {
      var payload = { user_name: cur.name, last_seen: new Date().toISOString(), current_page: MV.opts.page || 'Thư viện phim' };
      var r = await sb.from('online_users').upsert(payload);
      if (r.error && /column .* does not exist|42703/i.test((r.error.message || '') + (r.error.code || ''))) {
        await sb.from('online_users').upsert({ user_name: cur.name, last_seen: new Date().toISOString() });
      }
    } catch (e) { }
  }
  function startOnline() { if (!MV.opts.online) return; pingOnline(); clearInterval(_onlineTimer); _onlineTimer = setInterval(pingOnline, 20000); }
  function stopOnline() { clearInterval(_onlineTimer); }
  async function removeOnlineRow() {
    if (!cur.name || !MV.opts.online) return;
    try { await sb.from('online_users').delete().eq('user_name', cur.name); } catch (e) { }
  }
  function releaseOnUnload(table, query) {
    try {
      fetch(SUPABASE_URL + '/rest/v1/' + table + '?' + query, {
        method: 'DELETE', keepalive: true,
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }
      }).catch(function () { });
    } catch (e) { }
  }
  function onPageLeave() {
    if (cur.name && MV.opts.online) releaseOnUnload('online_users', 'user_name=eq.' + encodeURIComponent(cur.name));
    if (MV.opts.lock && cur.code && cur.token) releaseOnUnload('active_sessions', 'identity_code=eq.' + encodeURIComponent(cur.code) + '&session_token=eq.' + encodeURIComponent(cur.token));
  }

  /* ---------------------------------------------------------------- đăng nhập / cổng */
  function loggedIn(row, fresh) {
    MV.user = { id: String(row.id), name: cur.name, code: cur.code, canAdmin: !!row.can_access_movie_admin, identity: row };
    if (MV.opts.requireAdmin && !MV.user.canAdmin) { showDenied(cur.name); return; }
    hideGate();
    if (MV.opts.lock) startLockHeartbeat();
    startOnline();
    if (fresh) logLoginHistory();
    if (_ready) { location.reload(); return; }   // đăng nhập lại sau khi bị đá/đăng xuất: nạp lại trang cho sạch trạng thái
    _ready = true; _resolve(MV.user);
  }

  async function submitGate() {
    var name = (el('gateNameInput').value || '').trim();
    var code = (el('gateCodeInput').value || '').trim();
    el('gateErr').style.display = 'none';
    if (!name || !code) { showGateError('Vui lòng nhập đầy đủ Tên đăng nhập và Mã định danh'); return; }
    var btn = el('gateSubmitBtn'); btn.disabled = true; btn.style.opacity = '0.7';
    var res = await fetchIdentity(name, code);
    btn.disabled = false; btn.style.opacity = '1';
    if (res.error) {
      if (TABLE_MISSING.test((res.error.message || '') + (res.error.code || ''))) showGateError('Hệ thống định danh chưa được thiết lập. Vui lòng liên hệ Gia Bảo.');
      else showGateError('Không thể kiểm tra, vui lòng thử lại');
      return;
    }
    if (!res.row) { showGateError('Tên hoặc Mã định danh không đúng (hoặc đã bị thu hồi)'); return; }
    var canonical = (res.row.identity_code || code).substring(0, 60);
    if (MV.opts.lock) {
      var chk = await acquireOrVerifySession(canonical, name.substring(0, 30));
      if (!chk.ok) { showGateError('Tài khoản đang được đăng nhập ở nơi khác, vui lòng thử lại sau'); return; }
    }
    cur.name = name.substring(0, 30); cur.code = canonical;
    try { sessionStorage.setItem('gb_username', cur.name); sessionStorage.setItem('gb_identity_code', cur.code); } catch (e) { }
    if (el('gateRememberMe').checked) saveRemembered('student', cur.code, cur.name); else clearRemembered('student');
    loggedIn(res.row, true);
  }

  async function checkGate() {
    try { cur.name = sessionStorage.getItem('gb_username') || ''; cur.code = sessionStorage.getItem('gb_identity_code') || ''; cur.token = sessionStorage.getItem('gb_session_token') || ''; } catch (e) { }
    if (cur.name && cur.code) {
      var res = await fetchIdentity(cur.name, cur.code);
      if (res.error) { showGate('Không thể kiểm tra đăng nhập, vui lòng thử lại'); return; }
      if (!res.row) { clearSession(); showGate('Mã định danh đã bị thu hồi, vui lòng đăng nhập lại'); return; }
      if (MV.opts.lock) {
        var chk = await acquireOrVerifySession(cur.code, cur.name);
        if (!chk.ok) { clearSession(); showGate('Tài khoản đang được đăng nhập ở nơi khác, vui lòng thử lại sau'); return; }
      }
      loggedIn(res.row, false);
      return;
    }
    var rem = await loadRemembered('student');
    if (rem && rem.identity_code && rem.display_name) {
      var r2 = await fetchIdentity(rem.display_name, rem.identity_code);
      if (r2.row) {
        cur.name = rem.display_name; cur.code = rem.identity_code;
        try { sessionStorage.setItem('gb_username', cur.name); sessionStorage.setItem('gb_identity_code', cur.code); } catch (e) { }
        return checkGate();
      }
    }
    showGate();
  }

  MV.logout = async function () {
    stopLockHeartbeat(); stopOnline();
    await removeOnlineRow();
    if (cur.code && cur.token) { try { await sb.from('active_sessions').delete().eq('identity_code', cur.code).eq('session_token', cur.token); } catch (e) { } }
    await clearRemembered('student');
    clearSession();
    location.reload();
  };

  MV.rpc = function (fn, args) {
    if (!MV.user) return Promise.resolve({ data: null, error: { message: 'Chưa đăng nhập', code: '42501' } });
    return sb.rpc(fn, Object.assign({ p_name: MV.user.name, p_code: MV.user.code }, args || {}));
  };
  // Dùng trong pagehide: fetch keepalive để yêu cầu không bị huỷ khi trang đóng.
  MV.rpcKeepalive = function (fn, args) {
    if (!MV.user) return;
    try {
      fetch(SUPABASE_URL + '/rest/v1/rpc/' + fn, {
        method: 'POST', keepalive: true,
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({ p_name: MV.user.name, p_code: MV.user.code }, args || {}))
      }).catch(function () { });
    } catch (e) { }
  };

  MV.init = function (opts) {
    MV.opts = Object.assign({ page: 'Thư viện phim', online: false, lock: true, requireAdmin: false }, opts || {});
    return new Promise(function (resolve) {
      _resolve = resolve;
      var go = function () {
        if (!window.supabase || !window.supabase.createClient) {
          document.body.innerHTML = '<div style="padding:40px;font-family:sans-serif">Không tải được thư viện Supabase. Kiểm tra kết nối mạng rồi tải lại trang.</div>';
          return;
        }
        sb = MV.sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        mountUi();
        window.addEventListener('pagehide', onPageLeave);
        setTimeout(hideLoader, 8000);
        checkGate().catch(function (e) { console.error(e); showGate('Có lỗi khi kiểm tra đăng nhập, vui lòng thử lại'); });
      };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
    });
  };
})();
