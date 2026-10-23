/* =============================================================================
   hw-guest.js — vào thẳng homework.html KHÔNG cần đăng nhập, nhưng vẫn ghi
   "Khách N" (N tăng dần) + IP + vị trí + thiết bị vào bảng login_history,
   để xem trong manage.html -> "🕓 Lịch sử đăng nhập".
   -----------------------------------------------------------------------------
   - CỐ Ý KHÔNG ghi gb_username / gb_identity_code vào sessionStorage. Nhờ vậy
     bấm "Trang chủ" (index.html) vẫn hiện khung đăng nhập như bình thường.
   - Mỗi tab/phiên chỉ ghi 1 lần (F5 hoặc mở lại trang trong cùng tab không
     tạo thêm dòng). Mở tab mới / tắt hẳn rồi vào lại => "Khách" số mới.
   - Nếu tab này đã đăng nhập thật (từ index.html) hoặc là quản lý (từ
     manage.html) thì bỏ qua, không ghi "Khách".
   Cần có sẵn: supabaseClient (khai báo trong homework.html trước khi nạp file này).
   ============================================================================= */
(function(){
  var GUEST_PREFIX = 'Khách';
  var KEY = 'hw_guest_name';

  function ss(k){ try{ return sessionStorage.getItem(k) || ''; }catch(e){ return ''; } }

  async function getIp(){
    try{
      var res = await fetch('https://api.ipify.org?format=json');
      var data = await res.json();
      return data.ip || null;
    }catch(e){ return null; }
  }
  async function getLocation(){
    try{
      var res = await fetch('https://ipapi.co/json/');
      var d = await res.json();
      if(d && !d.error) return { city: d.city || null, region: d.region || null, country: d.country_name || null };
    }catch(e){}
    return null;
  }
  async function buildDeviceInfo(){
    var ua = navigator.userAgent || '';
    var deviceType = 'Máy tính (Desktop/Laptop)';
    if(/iPad|Android(?!.*Mobile)|Tablet/i.test(ua)) deviceType = 'Máy tính bảng';
    else if(/Mobi|iPhone|iPod|Android.*Mobile|Windows Phone/i.test(ua)) deviceType = 'Điện thoại di động';
    var os = 'Không rõ', m;
    if((m = ua.match(/Windows NT (\d+\.\d+)/))){
      var w = { '10.0':'Windows 10/11', '6.3':'Windows 8.1', '6.2':'Windows 8', '6.1':'Windows 7' };
      os = w[m[1]] || ('Windows (NT ' + m[1] + ')');
    } else if((m = ua.match(/Mac OS X (\d+[._]\d+(?:[._]\d+)?)/))){ os = 'macOS ' + m[1].replace(/_/g, '.'); }
    else if((m = ua.match(/Android (\d+(\.\d+)?)/))){ os = 'Android ' + m[1]; }
    else if((m = ua.match(/(?:iPhone OS|CPU OS) (\d+[._]\d+)/))){ os = 'iOS ' + m[1].replace(/_/g, '.'); }
    else if(/Linux/.test(ua)){ os = 'Linux'; }
    var browser = 'Không rõ';
    if(/Edg\//.test(ua)) browser = 'Microsoft Edge';
    else if(/OPR\//.test(ua)) browser = 'Opera';
    else if(/Chrome\//.test(ua) && !/Chromium/.test(ua)) browser = 'Chrome';
    else if(/Firefox\//.test(ua)) browser = 'Firefox';
    else if(/Safari\//.test(ua) && !/Chrome/.test(ua)) browser = 'Safari';
    var info = {
      deviceType: deviceType, os: os, browser: browser,
      cores: navigator.hardwareConcurrency || null, mem: navigator.deviceMemory || null,
      screen: (screen.width && screen.height) ? (screen.width + '×' + screen.height) : null,
      brand: null, ua: ua
    };
    if(os.indexOf('macOS') === 0) info.brand = 'Apple (macOS)';
    else if(os.indexOf('iOS') === 0) info.brand = 'Apple';
    try{
      if(navigator.userAgentData && navigator.userAgentData.getHighEntropyValues){
        var u = await navigator.userAgentData.getHighEntropyValues(['platformVersion', 'model']);
        if(navigator.userAgentData.platform === 'Windows' && u.platformVersion){
          info.os = parseInt(u.platformVersion.split('.')[0], 10) >= 13 ? 'Windows 11' : 'Windows 10';
        }
        if(u.model) info.brand = u.model;
      }
    }catch(e){}
    return info;
  }

  /* Số thứ tự kế tiếp = số "Khách N" lớn nhất trong 100 dòng Khách gần nhất + 1 */
  async function nextGuestNumber(){
    try{
      var r = await supabaseClient.from('login_history').select('user_name')
        .like('user_name', GUEST_PREFIX + ' %')
        .order('logged_in_at', { ascending: false }).limit(100);
      var max = 0;
      ((r && r.data) || []).forEach(function(row){
        var mm = /^Khách (\d+)$/.exec(row.user_name || '');
        if(mm) max = Math.max(max, parseInt(mm[1], 10));
      });
      return max + 1;
    }catch(e){ return 1; }
  }

  async function logGuest(){
    // Đã có tên trong phiên này (F5 / mở lại trang) -> không ghi lại
    if(ss(KEY)){ window.hwGuestName = ss(KEY); return; }
    // Đã đăng nhập thật (index.html) hoặc là quản lý (manage.html) -> không phải khách
    if(ss('gb_username') || ss('mgr_code')) return;

    var results = await Promise.all([
      nextGuestNumber(),
      getIp().catch(function(){ return null; }),
      getLocation().catch(function(){ return null; }),
      buildDeviceInfo().catch(function(){ return null; })
    ]);
    var name = GUEST_PREFIX + ' ' + results[0];
    try{ sessionStorage.setItem(KEY, name); }catch(e){}
    window.hwGuestName = name;

    var id = 'login_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    var at = new Date().toISOString();
    var row = {
      id: id, user_name: name, ip: results[1] || null,
      location: results[2] ? JSON.stringify(results[2]) : null,
      logged_in_at: at,
      device_info: results[3] ? JSON.stringify(results[3]) : null
    };
    try{
      var res = await supabaseClient.from('login_history').insert(row);
      if(!res.error) return;
      var t = (res.error.message || '') + (res.error.code || '');
      if(/column .* does not exist|42703|could not find/i.test(t)){
        // Bảng thiếu cột location/device_info -> ghi bản rút gọn (giống index.html)
        await supabaseClient.from('login_history').insert({ id: id, user_name: name, ip: results[1] || null, logged_in_at: at });
      } else {
        console.warn('Không ghi được lịch sử đăng nhập của khách:', res.error);
      }
    }catch(e){ console.warn(e); }
  }

  logGuest();
})();
