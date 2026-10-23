/* =========================================================================
   redis-bitmap.js — BẢN VIẾT LẠI, KHÔNG CÒN TOKEN TRONG TRÌNH DUYỆT
   -------------------------------------------------------------------------
   THAY ĐỔI DUY NHẤT VỀ KIẾN TRÚC: mọi lệnh Redis đi qua `/api/redis`
   (serverless function trên Vercel) thay vì gọi thẳng Upstash bằng token dán
   sẵn trong mã. Token nằm trong Environment Variables của Vercel, trình duyệt
   không bao giờ nhìn thấy.

   API CÔNG KHAI GIỮ NGUYÊN 100% so với bản cũ, nên library.html / manage.html
   không cần sửa một dòng nào:
       RedisBitmap.init() / ready() / isAvailable()
       setOnline / setOffline / isOnline / getOnlineCount / getAllOnlineUsers
       kickUser / unkickUser / isKicked
       setWarning / hasWarning / clearWarning
       setNotification

   Các lỗi khác của bản cũ đã sửa luôn:
   • ready() cũ dùng vòng lặp "ngủ 50ms rồi kiểm tra lại, tối đa 3 giây" — vừa
     tốn vừa không chính xác. Giờ init() được gọi ngay khi file được nạp và
     ready() chỉ việc await đúng promise đó.
   • Mỗi thao tác cũ bắn 2-4 request rời rạc (setBit + hSet + 2 expire). Giờ
     gộp thành 1 request pipeline -> nhanh hơn và ít tốn hạn mức Upstash.
   • Khi Redis không dùng được, bản cũ vẫn thử đi thử lại mỗi lần gọi. Giờ có
     "cầu dao": hỏng thì nghỉ 60 giây rồi mới thử lại, không làm chậm giao diện.
   • getAllOnlineUsers cũ giả định HGETALL luôn trả mảng; giờ chấp nhận cả
     dạng object (tuỳ phiên bản Upstash REST).

   ⚠️ TRƯỚC KHI DÙNG: vào Upstash THU HỒI token cũ (token đó đã nằm công khai
   trong mã nguồn nên phải coi như đã lộ), tạo token mới rồi đặt vào Vercel:
       UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
   ========================================================================= */
(function () {
  'use strict';

  var PROXY_URL = '/api/redis';
  var KEYS = {
    ONLINE_USERS: 'web:online_users',
    KICKED_USERS: 'web:kicked_users',
    WARNED_USERS: 'web:warned_users',
    USER_NOTIFICATIONS: 'web:notifications',
    LAST_SEEN_TIMESTAMPS: 'web:timestamps'
  };
  var ONLINE_TTL_SEC = 300;

  var available = false;
  var readyPromise = null;
  var circuitOpenUntil = 0;   // "cầu dao": mốc thời gian được phép thử lại

  /* ---------- Tầng giao tiếp ---------- */
  async function send(payload) {
    if (Date.now() < circuitOpenUntil) return null;
    try {
      var res = await fetch(PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        // 503 = chưa cấu hình Upstash; 404 = chưa deploy api/redis.js.
        // Cả hai đều là trạng thái bình thường: web vẫn chạy bằng Supabase.
        if (res.status === 503 || res.status === 404) {
          available = false;
          circuitOpenUntil = Date.now() + 10 * 60 * 1000;
        } else {
          circuitOpenUntil = Date.now() + 60 * 1000;
        }
        return null;
      }
      return await res.json();
    } catch (e) {
      circuitOpenUntil = Date.now() + 60 * 1000;
      return null;
    }
  }

  /** Một lệnh. Trả về giá trị result, hoặc null nếu hỏng. */
  async function cmd(command) {
    var data = await send(command);
    if (!data || data.error) return null;
    return data.result;
  }

  /** Nhiều lệnh trong 1 request. Trả về mảng result theo đúng thứ tự. */
  async function pipeline(commands) {
    var data = await send(commands);
    if (!Array.isArray(data)) return null;
    return data.map(function (x) { return x && x.result !== undefined ? x.result : null; });
  }

  /* ---------- Ánh xạ tên người dùng -> vị trí bit ----------
     Giữ nguyên thuật toán hash của bản cũ để dữ liệu bitmap đang có trong
     Redis vẫn đọc đúng, không bị lệch vị trí sau khi cập nhật. */
  function userIdOffset(username) {
    if (!username) return 0;
    var hash = 0;
    var str = String(username);
    for (var i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash = hash | 0;
    }
    return Math.abs(hash) % 100000;
  }

  var RedisBitmap = {
    isAvailable: function () { return available; },

    async init() {
      var r = await cmd(['SETBIT', 'web:ping', '0', '1']);
      if (r === null) {
        available = false;
        return false;
      }
      available = true;
      cmd(['DEL', 'web:ping']);
      return true;
    },

    async ready() {
      if (readyPromise) { try { await readyPromise; } catch (e) {} }
      return available;
    },

    async setOnline(username, timestamp) {
      if (!available || !username) return false;
      var off = String(userIdOffset(username));
      var res = await pipeline([
        ['SETBIT', KEYS.ONLINE_USERS, off, '1'],
        ['HSET', KEYS.LAST_SEEN_TIMESTAMPS, String(username), String(timestamp || Date.now())],
        ['EXPIRE', KEYS.ONLINE_USERS, String(ONLINE_TTL_SEC)],
        ['EXPIRE', KEYS.LAST_SEEN_TIMESTAMPS, String(ONLINE_TTL_SEC)]
      ]);
      return res !== null;
    },

    async setOffline(username) {
      if (!available || !username) return false;
      var res = await pipeline([
        ['SETBIT', KEYS.ONLINE_USERS, String(userIdOffset(username)), '0'],
        ['HDEL', KEYS.LAST_SEEN_TIMESTAMPS, String(username)]
      ]);
      return res !== null;
    },

    async getOnlineCount() {
      if (!available) return -1;                 // -1 = "không biết", gọi Supabase
      var n = await cmd(['BITCOUNT', KEYS.ONLINE_USERS]);
      return n === null ? -1 : parseInt(n, 10) || 0;
    },

    async isOnline(username) {
      if (!available || !username) return null;  // null = "không biết"
      var b = await cmd(['GETBIT', KEYS.ONLINE_USERS, String(userIdOffset(username))]);
      return b === null ? null : b === 1 || b === '1';
    },

    async kickUser(username) {
      if (!available || !username) return false;
      var off = String(userIdOffset(username));
      var res = await pipeline([
        ['SETBIT', KEYS.KICKED_USERS, off, '1'],
        ['SETBIT', KEYS.ONLINE_USERS, off, '0']
      ]);
      return res !== null;
    },

    async isKicked(username) {
      if (!available || !username) return null;
      var b = await cmd(['GETBIT', KEYS.KICKED_USERS, String(userIdOffset(username))]);
      return b === null ? null : b === 1 || b === '1';
    },

    async unkickUser(username) {
      if (!available || !username) return false;
      return (await cmd(['SETBIT', KEYS.KICKED_USERS, String(userIdOffset(username)), '0'])) !== null;
    },

    async setWarning(username) {
      if (!available || !username) return false;
      return (await cmd(['SETBIT', KEYS.WARNED_USERS, String(userIdOffset(username)), '1'])) !== null;
    },

    async hasWarning(username) {
      if (!available || !username) return null;
      var b = await cmd(['GETBIT', KEYS.WARNED_USERS, String(userIdOffset(username))]);
      return b === null ? null : b === 1 || b === '1';
    },

    async clearWarning(username) {
      if (!available || !username) return false;
      return (await cmd(['SETBIT', KEYS.WARNED_USERS, String(userIdOffset(username)), '0'])) !== null;
    },

    async setNotification(username, notificationId) {
      if (!available || !username) return false;
      var key = KEYS.USER_NOTIFICATIONS + ':' + userIdOffset(username);
      var res = await pipeline([
        ['HSET', key, String(notificationId), '1'],
        ['EXPIRE', key, '86400']
      ]);
      return res !== null;
    },

    async getAllOnlineUsers() {
      if (!available) return [];
      var raw = await cmd(['HGETALL', KEYS.LAST_SEEN_TIMESTAMPS]);
      if (!raw) return [];
      // Upstash REST trả về mảng phẳng [field, value, ...] ở bản này và object
      // { field: value } ở bản khác. Chấp nhận cả hai cho chắc.
      var pairs = [];
      if (Array.isArray(raw)) {
        for (var i = 0; i + 1 < raw.length; i += 2) pairs.push([raw[i], raw[i + 1]]);
      } else if (typeof raw === 'object') {
        pairs = Object.keys(raw).map(function (k) { return [k, raw[k]]; });
      }
      var cutoff = Date.now() - ONLINE_TTL_SEC * 1000;
      return pairs.reduce(function (acc, p) {
        var ts = parseInt(p[1], 10);
        if (p[0] && !isNaN(ts) && ts > cutoff) {
          acc.push({ user_name: p[0], last_seen: new Date(ts).toISOString() });
        }
        return acc;
      }, []);
    }
  };

  if (typeof window !== 'undefined') {
    window.RedisBitmap = RedisBitmap;
    // Bắt đầu ngay, không đợi DOMContentLoaded: lệnh đầu tiên là một request
    // mạng nên càng sớm càng tốt, và ready() luôn có promise để chờ.
    readyPromise = RedisBitmap.init().catch(function () { available = false; return false; });
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = RedisBitmap;
})();
