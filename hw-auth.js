/* =============================================================================
   hw-auth.js — ĐĂNG NHẬP cho homework.html, LOGIC GIỐNG HỆT manage.html
   -----------------------------------------------------------------------------
   Giống manage.html ở các điểm sau:
   - 2 cách vào: Mật khẩu + Mã số quản lý (VD B001), hoặc quét / tải ảnh mã QR.
   - Mật khẩu kiểm tra ở máy chủ (/api/manager-login); chưa deploy thì dùng lớp
     dự phòng băm SHA-256 (cùng giá trị với manage.html).
   - Mã quản lý phải tồn tại + đang bật trong bảng manager_codes.
   - Khoá phiên duy nhất (bảng manager_sessions): mã đang đăng nhập ở nơi khác
     (còn "nhấp nháy" trong 40 giây) thì bị chặn; heartbeat 20 giây/lần.
   - "Ghi nhớ đăng nhập trên máy này" dùng bảng remembered_logins, kind='admin'.
   - DÙNG CHUNG sessionStorage với manage.html (mgr_code, mgr_session_token...)
     nên đang đăng nhập ở manage rồi bấm sang homework CÙNG TAB là vào thẳng.

   Cần có sẵn ở trang: supabaseClient, SUPABASE_URL, SUPABASE_ANON_KEY, các phần
   tử của khung đăng nhập, và hàm window.hwEnterApp(code) do trang định nghĩa.
   ============================================================================= */

/* Dự phòng nếu chưa có lib/gb-safe.js (giữ nguyên hành vi băm SHA-256) */
if(!window.GBSafe){
  window.GBSafe = {
    sha256Hex: async function(s){
      var b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
      return Array.prototype.map.call(new Uint8Array(b), function(x){ return x.toString(16).padStart(2, '0'); }).join('');
    },
    onPageLeave: function(){},
    releaseOnUnload: function(){}
  };
}

const MANAGER_PASSWORD_SHA256 = '5b33003a928495b97792ac286d477b54dd20eb773c74ae2fb3653bc5950ad6dd';
const MGR_SESSION_TIMEOUT_MS = 40000;

let myCode = sessionStorage.getItem('mgr_code') || '';
let _mgrSessionToken = sessionStorage.getItem('mgr_session_token') || '';
let _deviceId = sessionStorage.getItem('mgr_device') || ('dev_' + Math.random().toString(36).slice(2, 8));
sessionStorage.setItem('mgr_device', _deviceId);
let _sessionHeartbeat = null;

async function verifyManagerPassword(pw){
  // 1) Ưu tiên hỏi máy chủ (an toàn thật). Chưa deploy (404) thì rơi xuống (2).
  try{
    const res = await fetch('/api/manager-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw })
    });
    if(res.ok){ const j = await res.json(); return !!j.ok; }
    if(res.status !== 404) return false;
  }catch(e){ /* chưa deploy / mất mạng -> dùng lớp dự phòng */ }
  // 2) Lớp dự phòng: so khớp băm SHA-256 phía trình duyệt.
  try{
    const hex = await GBSafe.sha256Hex(pw);
    return hex === MANAGER_PASSWORD_SHA256;
  }catch(e){ return false; }
}

/* ---------- Ghi nhớ đăng nhập (giống manage.html) ---------- */
let _myIp = null;
async function getMyIp(){
  if(_myIp) return _myIp;
  try{
    const res = await fetch('https://api.ipify.org?format=json');
    const data = await res.json();
    _myIp = data.ip || null;
  }catch(e){ /* bỏ qua */ }
  return _myIp;
}
function getDeviceFingerprint(){
  try{
    const s = [navigator.userAgent, navigator.language, screen.width + 'x' + screen.height,
      Intl.DateTimeFormat().resolvedOptions().timeZone].join('|');
    let hash = 0;
    for(let i = 0; i < s.length; i++){ hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0; }
    return 'fp' + Math.abs(hash).toString(36);
  }catch(e){ return 'fp0'; }
}
let _gbDeviceId = null;
function getDeviceId(){
  if(_gbDeviceId) return _gbDeviceId;
  try{ _gbDeviceId = localStorage.getItem('gb_device_id') || ''; }catch(e){ _gbDeviceId = ''; }
  if(!_gbDeviceId){
    _gbDeviceId = 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    try{ localStorage.setItem('gb_device_id', _gbDeviceId); }catch(e){}
  }
  return _gbDeviceId;
}
function getRememberKeySync(kind){ return kind + '_' + getDeviceId(); }
async function getLegacyRememberKey(kind){
  try{
    const ip = await getMyIp();
    return kind + '_' + (ip || 'noip').replace(/[^a-zA-Z0-9]/g, '') + '_' + getDeviceFingerprint();
  }catch(e){ return null; }
}
async function saveRememberedLogin(kind, identityCode, displayName){
  const key = getRememberKeySync(kind);
  try{
    await supabaseClient.from('remembered_logins').upsert({
      id: key, kind: kind, ip: _myIp || null, fingerprint: getDeviceFingerprint(),
      identity_code: identityCode, display_name: displayName || null,
      last_seen: new Date().toISOString()
    });
  }catch(e){ return; }
  try{
    getMyIp().then(function(ip){
      if(!ip) return;
      return supabaseClient.from('remembered_logins').update({ ip: ip }).eq('id', key);
    }).catch(function(){});
  }catch(e){}
}
async function loadRememberedLogin(kind){
  try{
    const { data, error } = await supabaseClient.from('remembered_logins')
      .select('*').eq('id', getRememberKeySync(kind)).maybeSingle();
    if(!error && data) return data;
  }catch(e){}
  try{
    const legacy = await getLegacyRememberKey(kind);
    if(!legacy) return null;
    const { data, error } = await supabaseClient.from('remembered_logins')
      .select('*').eq('id', legacy).maybeSingle();
    if(error || !data) return null;
    saveRememberedLogin(kind, data.identity_code, data.display_name);
    return data;
  }catch(e){ return null; }
}
async function clearRememberedLogin(kind){
  try{ await supabaseClient.from('remembered_logins').delete().eq('id', getRememberKeySync(kind)); }catch(e){}
  try{
    const legacy = await getLegacyRememberKey(kind);
    if(legacy) await supabaseClient.from('remembered_logins').delete().eq('id', legacy);
  }catch(e){}
}

/* ---------- Đăng nhập chung cho cả mật khẩu và QR ---------- */
function _showLoginError(msg){
  const errEl = document.getElementById('loginError');
  errEl.textContent = msg;
  errEl.style.display = 'block';
}
async function completeManagerLogin(code, identityRow, opts){
  opts = opts || {};
  const errEl = document.getElementById('loginError');
  errEl.style.display = 'none';
  try{
    let { data, error } = await supabaseClient.from('manager_codes').select('*').eq('code', code).maybeSingle();
    if(error){
      const t = (error.message || '') + (error.code || '');
      if(/relation .* does not exist|42P01/i.test(t)) _showLoginError('Chưa chạy file setup-database.sql trên Supabase (bảng manager_codes chưa tồn tại).');
      else if(/permission denied|row-level security|42501/i.test(t)) _showLoginError('Bị chặn bởi Row Level Security. Kiểm tra lại các policy trong setup-database.sql.');
      else if(/fetch|network|Failed to fetch/i.test(error.message || '')) _showLoginError('Không kết nối được tới Supabase. Kiểm tra mạng hoặc SUPABASE_URL/KEY.');
      else _showLoginError('Lỗi: ' + (error.message || 'không rõ nguyên nhân') + ' (xem Console - F12 để biết chi tiết)');
      return false;
    }
    if(!data){
      _showLoginError('Mã ' + code + ' chưa được tạo. Vào trang quản lý, mục "Tài khoản quản trị" để tạo mã này trước khi đăng nhập.');
      return false;
    }
    if(!data.active){
      _showLoginError('Mã ' + code + ' chưa được cấp quyền hoặc đã bị thu hồi. Liên hệ quản lý B001.');
      return false;
    }
    // Khoá phiên duy nhất: mã đang đăng nhập (còn heartbeat) ở nơi khác -> chặn.
    const sessionToken = _mgrSessionToken || (Date.now() + '_' + Math.random().toString(36).slice(2, 10));
    try{
      const { data: existSess, error: sessErr } = await supabaseClient.from('manager_sessions').select('*').eq('code', code).maybeSingle();
      if(!sessErr && existSess){
        const lastSeenMs = existSess.last_seen ? new Date(existSess.last_seen).getTime() : 0;
        const isStale = !existSess.last_seen || (Date.now() - lastSeenMs) > MGR_SESSION_TIMEOUT_MS;
        const isMine = existSess.session_token && existSess.session_token === sessionToken;
        if(!isStale && !isMine){
          _showLoginError('Tài khoản hiện đang được đăng nhập ở nơi khác, vui lòng thử lại sau');
          return false;
        }
      }
    }catch(e){ /* lỗi mạng tạm thời: không chặn cứng */ }

    myCode = code;
    _mgrSessionToken = sessionToken;
    sessionStorage.setItem('mgr_code', code);
    sessionStorage.setItem('mgr_session_token', sessionToken);
    if(identityRow) sessionStorage.setItem('mgr_identity_id', identityRow.id);
    else if(!opts.keepIdentity) sessionStorage.removeItem('mgr_identity_id');
    await supabaseClient.from('manager_sessions').upsert({ code: code, device_name: _deviceId, session_token: sessionToken, last_seen: new Date().toISOString() });
    if(!opts.silent){
      const rememberEl = document.getElementById('mgrRememberMe');
      if(rememberEl && rememberEl.checked){ saveRememberedLogin('admin', code, null); }
      else{ clearRememberedLogin('admin'); }
    }
    hwStartHeartbeat();
    if(window.hwEnterApp) window.hwEnterApp(code);
    return true;
  }catch(e){
    console.error(e);
    _showLoginError('Lỗi kết nối tới máy chủ.');
    return false;
  }
}

async function doManagerLogin(){
  const pw = document.getElementById('loginPw').value;
  const code = (document.getElementById('loginCode').value || '').trim().toUpperCase();
  document.getElementById('loginError').style.display = 'none';
  if(!(await verifyManagerPassword(pw))){ _showLoginError('Sai mật khẩu.'); return; }
  if(!code){ _showLoginError('Vui lòng nhập mã số quản lý.'); return; }
  await completeManagerLogin(code, null);
}

/* ---------- Heartbeat + đăng xuất ---------- */
function hwStartHeartbeat(){
  clearInterval(_sessionHeartbeat);
  _sessionHeartbeat = setInterval(async function(){
    try{
      const { data, error } = await supabaseClient
        .from('manager_sessions')
        .update({ device_name: _deviceId, last_seen: new Date().toISOString() })
        .eq('code', myCode)
        .eq('session_token', _mgrSessionToken)
        .select();
      if(!error && (!data || !data.length)) forceKickManagerSession();
    }catch(e){}
  }, 20000);
}
function forceKickManagerSession(){
  clearInterval(_sessionHeartbeat);
  sessionStorage.removeItem('mgr_code');
  sessionStorage.removeItem('mgr_session_token');
  alert('Tài khoản quản lý của bạn hiện đang được đăng nhập ở nơi khác, vui lòng thử lại sau.');
  location.reload();
}
async function doManagerLogout(){
  if(myCode && _mgrSessionToken){
    try{ await supabaseClient.from('manager_sessions').delete().eq('code', myCode).eq('session_token', _mgrSessionToken); }catch(e){}
  }
  await clearRememberedLogin('admin');
  sessionStorage.removeItem('mgr_code');
  sessionStorage.removeItem('mgr_session_token');
  sessionStorage.removeItem('mgr_identity_id');
  location.reload();
}

/* ---------- Đăng nhập bằng QR ---------- */
let _qrScanStream = null;
let _qrScanRAF = null;
let _qrScanBusy = false;

function switchLoginTab(tab){
  document.getElementById('loginTabPwBtn').classList.toggle('active', tab === 'pw');
  document.getElementById('loginTabQrBtn').classList.toggle('active', tab === 'qr');
  document.getElementById('loginPwPanel').style.display = tab === 'pw' ? 'block' : 'none';
  document.getElementById('loginQrPanel').style.display = tab === 'qr' ? 'block' : 'none';
  document.getElementById('loginError').style.display = 'none';
  if(tab !== 'qr') stopQrScan();
}
async function toggleQrScan(){
  if(_qrScanStream){ stopQrScan(); return; }
  await startQrScan();
}
function _setQrBtn(scanning){
  const btn = document.getElementById('qrScanToggleBtn');
  if(!btn) return;
  btn.innerHTML = window.hwBtnLabel
    ? window.hwBtnLabel(scanning ? 'stop' : 'camera', scanning ? 'Tắt camera' : 'Bật camera quét QR')
    : (scanning ? 'Tắt camera' : 'Bật camera quét QR');
}
async function startQrScan(){
  const statusEl = document.getElementById('qrScanStatus');
  if(typeof jsQR !== 'function'){
    statusEl.textContent = 'Chưa tải được thư viện đọc mã QR (kiểm tra kết nối mạng rồi thử lại).';
    return;
  }
  statusEl.textContent = 'Đang xin quyền truy cập camera...';
  try{
    _qrScanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  }catch(e){
    statusEl.textContent = 'Không mở được camera. Hãy cấp quyền truy cập camera cho trình duyệt rồi bấm lại nút bên dưới.';
    _qrScanStream = null;
    return;
  }
  const video = document.getElementById('qrVideo');
  video.srcObject = _qrScanStream;
  await video.play();
  _setQrBtn(true);
  statusEl.textContent = 'Đưa mã QR vào giữa khung hình...';
  const canvas = document.getElementById('qrCanvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const tick = function(){
    if(!_qrScanStream) return;
    if(!_qrScanBusy && video.readyState === video.HAVE_ENOUGH_DATA){
      canvas.width = video.videoWidth || 300;
      canvas.height = video.videoHeight || 300;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      try{
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imgData.data, imgData.width, imgData.height, { inversionAttempts: 'dontInvert' });
        if(code && code.data){ _qrScanBusy = true; handleQrScanned(code.data); return; }
      }catch(e){ /* khung hình lỗi tạm thời */ }
    }
    _qrScanRAF = requestAnimationFrame(tick);
  };
  _qrScanRAF = requestAnimationFrame(tick);
}
function stopQrScan(){
  if(_qrScanRAF) cancelAnimationFrame(_qrScanRAF);
  _qrScanRAF = null;
  _qrScanBusy = false;
  if(_qrScanStream){ _qrScanStream.getTracks().forEach(function(t){ t.stop(); }); _qrScanStream = null; }
  const video = document.getElementById('qrVideo');
  if(video) video.srcObject = null;
  _setQrBtn(false);
  const statusEl = document.getElementById('qrScanStatus');
  if(statusEl) statusEl.textContent = 'Bấm nút bên dưới để bật camera';
}
async function handleQrImageUpload(input){
  const file = input && input.files && input.files[0];
  if(!file) return;
  const statusEl = document.getElementById('qrScanStatus');
  document.getElementById('loginError').style.display = 'none';
  if(typeof jsQR !== 'function'){
    statusEl.textContent = 'Chưa tải được thư viện đọc mã QR, thử tải lại trang.';
    input.value = '';
    return;
  }
  stopQrScan();
  statusEl.textContent = 'Đang đọc ảnh...';
  try{
    const dataUrl = await new Promise(function(resolve, reject){
      const reader = new FileReader();
      reader.onload = function(){ resolve(reader.result); };
      reader.onerror = function(){ reject(new Error('read-failed')); };
      reader.readAsDataURL(file);
    });
    const img = await new Promise(function(resolve, reject){
      const im = new Image();
      im.onload = function(){ resolve(im); };
      im.onerror = function(){ reject(new Error('image-decode-failed')); };
      im.src = dataUrl;
    });
    const canvas = document.getElementById('qrCanvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const maxDim = 1600;
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(imgData.data, imgData.width, imgData.height, { inversionAttempts: 'attemptBoth' });
    input.value = '';
    if(!code || !code.data){
      statusEl.textContent = 'Không tìm thấy mã QR trong ảnh. Hãy chọn ảnh rõ nét, chụp thẳng, không bị mờ/cắt góc.';
      return;
    }
    await handleQrScanned(code.data);
  }catch(e){
    statusEl.textContent = 'Không đọc được ảnh vừa chọn. Hãy thử ảnh khác (định dạng JPG/PNG).';
    input.value = '';
  }
}
async function handleQrScanned(text){
  stopQrScan();
  const statusEl = document.getElementById('qrScanStatus');
  document.getElementById('loginError').style.display = 'none';
  statusEl.textContent = 'Đang kiểm tra mã QR...';
  const m = /^QUANLYADMIN:(.+)$/.exec((text || '').trim());
  const token = m ? m[1] : (text || '').trim();
  try{
    const { data, error } = await supabaseClient.from('admin_qr_identities').select('*').eq('qr_token', token).maybeSingle();
    if(error){
      if(/relation .* does not exist|42P01/i.test((error.message || '') + (error.code || ''))){
        statusEl.textContent = 'Chưa tạo bảng admin_qr_identities trên Supabase. Chạy file setup-ma-qr.sql trước.';
      } else {
        statusEl.textContent = 'Lỗi: ' + (error.message || 'không rõ nguyên nhân');
      }
      return;
    }
    if(!data){
      statusEl.textContent = 'Mã QR không hợp lệ hoặc đã bị xoá. Bấm nút bên dưới để quét lại.';
      _qrScanBusy = false;
      return;
    }
    const code = (data.manager_code || '').toUpperCase();
    const ok = await completeManagerLogin(code, data);
    if(!ok){
      statusEl.textContent = 'Bấm nút bên dưới để quét lại';
      _qrScanBusy = false;
    }
  }catch(e){
    statusEl.textContent = 'Lỗi kết nối tới máy chủ.';
    _qrScanBusy = false;
  }
}

/* ---------- Khởi động: vào thẳng nếu còn phiên / đã "ghi nhớ" ---------- */
window.hwAuthBoot = async function(){
  if(myCode){
    // Có phiên từ manage.html (cùng tab): xác nhận lại + tạo lại dòng khoá phiên
    // (manage.html đã nhả khoá khi rời trang) rồi vào thẳng.
    const ok = await completeManagerLogin(myCode, null, { keepIdentity: true, silent: true });
    if(!ok){
      myCode = '';
      sessionStorage.removeItem('mgr_code');
      sessionStorage.removeItem('mgr_session_token');
      _mgrSessionToken = '';
    }
    return;
  }
  const remembered = await loadRememberedLogin('admin');
  if(remembered && remembered.identity_code){
    await completeManagerLogin(remembered.identity_code, null);
  }
};
window.hwGetManagerCode = function(){ return myCode; };
