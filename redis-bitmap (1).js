/* =========================================================================
   REDIS BITMAP OPTIMIZATION LAYER — PRO v2
   Dùng chung cho index.html (trang chính) và manage.html (trang quản lý)

   ĐIỂM MỚI SO VỚI BẢN CŨ (xem chi tiết ở cuối file / tin nhắn bàn giao):
   1) Pipeline hoá mọi thao tác nhiều lệnh -> 1 lần gọi mạng thay vì nhiều lần
   2) Tự retry (exponential backoff) + timeout (AbortController) cho mỗi lệnh
   3) Tự kiểm tra sức khoẻ kết nối định kỳ + tự kết nối lại khi Redis phục hồi
      (bản cũ chỉ init() 1 lần lúc tải trang, mất kết nối tạm thời là "chết" luôn)
   4) Đọc trạng thái online/kick hàng loạt (batch) cho nhiều user cùng lúc
   5) 4 nhóm tính năng "pro" hoàn toàn mới, áp dụng được cho rất nhiều chỗ
      trong 2 web:
        - RedisBitmap.rateLimit  : chống spam (báo lỗi liên tục, xin đáp án
          liên tục, gửi chat liên tục, thử OTP sai nhiều lần...)
        - RedisBitmap.stats      : bộ đếm nhanh cho Dashboard (tổng lượt xem,
          tổng đăng nhập hôm nay...) không cần quét bảng Supabase
        - RedisBitmap.notices    : theo dõi ai đã xem thông báo chung nào
          (bitmap theo từng thông báo) — biết ngay bao nhiêu % đã đọc
        - RedisBitmap.views      : bảng xếp hạng bài soạn xem nhiều nhất
          (Sorted Set) — dùng Redis vì tăng liên tục, không nên ghi Supabase
          mỗi lượt xem (tốn quota + chậm)
        - RedisBitmap.lock       : khoá phân tán ngắn hạn, chống bấm đúp
          (double-submit) 1 hành động từ nhiều tab/thiết bị cùng lúc
   6) Vẫn giữ NGUYÊN mọi tên hàm cũ (setOnline, setOffline, kickUser,
      isKicked, setWarning, hasWarning, getAllOnlineUsers...) nên code cũ
      trong index.html/manage.html KHÔNG cần sửa gì cũng chạy được ngay,
      chỉ nhanh hơn vì bên trong đã được viết lại bằng pipeline.
   7) Luôn "fail-open" về phía Supabase khi Redis lỗi/chậm/hết hạn token -
      web không bao giờ bị đứng vì Redis, đúng tinh thần lớp tối ưu chứ
      không phải phụ thuộc bắt buộc.

   ⚠️ LƯU Ý BẢO MẬT QUAN TRỌNG (đọc kỹ):
   File này chạy ở trình duyệt (client-side) nên REDIS_TOKEN bên dưới AI
   CŨNG XEM ĐƯỢC chỉ bằng "View Page Source" / DevTools. Với token có toàn
   quyền đọc-ghi như hiện tại, về lý thuyết một người dùng biết token có thể
   tự ý xoá/sửa dữ liệu Redis (VD: tự gỡ trạng thái bị kick của chính họ).
   Vì đây là lớp "tối ưu tốc độ" chạy song song với Supabase (không phải nơi
   lưu trữ dữ liệu gốc/duy nhất — Supabase vẫn là nguồn sự thật chính), rủi ro
   thực tế khá thấp, nhưng nếu muốn an toàn tuyệt đối về sau, cách chuẩn là
   đặt 1 hàm serverless (Vercel/Cloudflare Worker/Supabase Edge Function) làm
   trung gian giữ token, web chỉ gọi hàm đó chứ không gọi thẳng Upstash. Việc
   này ngoài phạm vi 1 file JS thuần nên chưa áp dụng ở đây — nêu ra để bạn
   cân nhắc khi cần.
   ========================================================================= */

(function() {
  'use strict';

  // ============ CẤU HÌNH ============
  // Upstash Redis (free tier): https://upstash.com
  const REDIS_URL = 'https://expert-aphid-177973.upstash.io';
  const REDIS_TOKEN = 'gQAAAAAAArc1AAIgcDIxN2FiNTVlYzI4ZGU0MzRiOWEwZWNjYmY1MjBlNjRkNw';

  // Có thể chỉnh các thông số này qua RedisBitmap.configure({...}) sau khi tải trang
  const DEFAULT_OPTS = {
    timeoutMs: 5000,        // mỗi lệnh Redis chờ tối đa 5s rồi coi như lỗi (fallback Supabase)
    maxRetries: 2,          // số lần thử lại khi lỗi mạng tạm thời (không tính lỗi timeout)
    retryBaseDelayMs: 150,  // độ trễ giữa các lần thử lại, tăng dần theo cấp số nhân
    logLevel: 'warn',       // 'silent' | 'warn' | 'debug'
    healthCheckIntervalMs: 30000, // 30s/lần kiểm tra + tự kết nối lại nếu đang mất kết nối
    onlineTtlSeconds: 300   // 1 người được coi là "online" tối đa 5 phút không heartbeat
  };

  // ============ CÁC KEY DÙNG TRONG REDIS ============
  const KEYS = {
    ONLINE_USERS: 'web:online_users',        // Bitmap: 1 = online, 0 = offline
    KICKED_USERS: 'web:kicked_users',        // Bitmap: 1 = kicked/banned
    WARNED_USERS: 'web:warned_users',        // Bitmap: 1 = has warning
    USER_NOTIFICATIONS: 'web:notifications', // Hash theo từng user (cũ)
    LAST_SEEN_TIMESTAMPS: 'web:timestamps',  // Hash: user -> last_seen timestamp
    RATE_LIMIT_PREFIX: 'web:rl:',            // Counter: web:rl:<key> (chống spam)
    STATS_PREFIX: 'web:stats:',              // Counter: web:stats:<name> (Dashboard)
    NOTICE_READ_PREFIX: 'web:notice_read:',  // Bitmap: web:notice_read:<noticeId>
    POST_VIEWS_ZSET: 'web:post_views',       // Sorted Set: điểm = số lượt xem
    LOCK_PREFIX: 'web:lock:'                 // String NX PX: khoá phân tán ngắn hạn
  };

  function sleep(ms) { return new Promise(function(r){ setTimeout(r, ms); }); }

  // ============ USER ID -> OFFSET (dùng cho bitmap) ============
  // Hash FNV-1a: phân bố đều hơn, ít đụng độ (trùng offset giữa 2 username
  // khác nhau) hơn hàm hash cộng-dồn kiểu Java cũ.
  function userIdOffset(username) {
    if (!username) return 0;
    const str = String(username);
    let hash = 0x811c9dc5; // FNV offset basis
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193); // FNV prime
    }
    return Math.abs(hash) % 1000000; // hỗ trợ tới 1 triệu user, ít đụng độ hơn bản cũ (100k)
  }

  // ============ REDIS CLIENT (REST API - tương thích Upstash) ============
  class RedisBitmapClient {
    constructor(url, token, opts) {
      this.url = String(url).replace(/\/$/, '');
      this.token = token;
      this.opts = Object.assign({}, DEFAULT_OPTS, opts || {});
    }

    _log(level, ...args) {
      const order = { silent: 0, warn: 1, debug: 2 };
      if ((order[this.opts.logLevel] || 0) >= order[level]) {
        (level === 'debug' ? console.log : console.warn)('[RedisBitmap]', ...args);
      }
    }

    async _fetchWithTimeout(url, options) {
      const controller = new AbortController();
      const timer = setTimeout(function(){ controller.abort(); }, this.opts.timeoutMs);
      try {
        return await fetch(url, Object.assign({}, options, { signal: controller.signal }));
      } finally {
        clearTimeout(timer);
      }
    }

    // Gửi 1 lệnh đơn, có timeout + tự thử lại (exponential backoff) khi lỗi mạng
    // (KHÔNG thử lại khi lỗi do timeout - vì thường là Redis đang chậm/quá tải,
    // thử lại ngay lúc đó chỉ làm tình hình tệ hơn).
    async _exec(command, attempt) {
      attempt = attempt || 0;
      try {
        const resp = await this._fetchWithTimeout(this.url, {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + this.token, 'Content-Type': 'application/json' },
          body: JSON.stringify(command)
        });
        const data = await resp.json();
        // Upstash trả về { "result": ... } khi thành công hoặc { "error": "..." }
        // khi thất bại - chuẩn hoá về dạng [null, result] để phần code dưới
        // dùng result[1] cho gọn (giữ đúng quy ước của bản cũ).
        if (!resp.ok || (data && data.error)) {
          if (data && data.error) this._log('warn', 'Upstash trả lỗi:', data.error, 'lệnh:', command[0]);
          return null;
        }
        return [null, data.result];
      } catch (e) {
        const isAbort = e && e.name === 'AbortError';
        if (!isAbort && attempt < this.opts.maxRetries) {
          await sleep(this.opts.retryBaseDelayMs * Math.pow(2, attempt));
          return this._exec(command, attempt + 1);
        }
        this._log('warn', isAbort ? 'Redis timeout, fallback Supabase:' : 'Redis lỗi mạng:', e.message, 'lệnh:', command[0]);
        return null;
      }
    }

    // Gửi NHIỀU lệnh trong 1 lần gọi mạng duy nhất (Upstash /pipeline).
    // Trả về mảng kết quả theo đúng thứ tự lệnh, hoặc null nếu cả pipeline lỗi.
    async _execPipeline(commands, attempt) {
      attempt = attempt || 0;
      if (!commands || !commands.length) return [];
      try {
        const resp = await this._fetchWithTimeout(this.url + '/pipeline', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + this.token, 'Content-Type': 'application/json' },
          body: JSON.stringify(commands)
        });
        const data = await resp.json();
        if (!resp.ok || !Array.isArray(data)) {
          this._log('warn', 'Pipeline trả về không hợp lệ');
          return null;
        }
        return data.map(function(item) { return (item && !item.error) ? item.result : null; });
      } catch (e) {
        const isAbort = e && e.name === 'AbortError';
        if (!isAbort && attempt < this.opts.maxRetries) {
          await sleep(this.opts.retryBaseDelayMs * Math.pow(2, attempt));
          return this._execPipeline(commands, attempt + 1);
        }
        this._log('warn', 'Pipeline lỗi:', e.message);
        return null;
      }
    }

    // ---- Lệnh đơn lẻ (giữ để tương thích ngược + dùng khi chỉ cần 1 lệnh) ----
    async setBit(key, offset, value) { return this._exec(['SETBIT', key, String(offset), value ? '1' : '0']); }
    async getBit(key, offset) { const r = await this._exec(['GETBIT', key, String(offset)]); return r && r[1] === 1; }
    async setBits(key, offsets, value) { return Promise.all(offsets.map(o => this.setBit(key, o, value))); }
    async bitCount(key) { const r = await this._exec(['BITCOUNT', key]); return r && r[1] !== undefined ? parseInt(r[1]) : 0; }
    async hSet(key, field, value) { return this._exec(['HSET', key, field, String(value)]); }
    async hGet(key, field) { const r = await this._exec(['HGET', key, field]); return r && r[1] !== undefined ? r[1] : null; }
    async expire(key, seconds) { return this._exec(['EXPIRE', key, String(seconds)]); }
    async del(key) { return this._exec(['DEL', key]); }
    async incrBy(key, by) { const r = await this._exec(['INCRBY', key, String(by)]); return r && r[1] !== undefined ? parseInt(r[1]) : null; }
    async get(key) { const r = await this._exec(['GET', key]); return r ? r[1] : null; }
    async zIncrBy(key, by, member) { const r = await this._exec(['ZINCRBY', key, String(by), member]); return r ? parseFloat(r[1]) : null; }
    async zScore(key, member) { const r = await this._exec(['ZSCORE', key, member]); return r && r[1] != null ? parseFloat(r[1]) : 0; }
    async zRevRangeWithScores(key, start, stop) {
      const r = await this._exec(['ZREVRANGE', key, String(start), String(stop), 'WITHSCORES']);
      if (!r || !r[1]) return [];
      const arr = r[1], out = [];
      for (let i = 0; i < arr.length; i += 2) out.push({ member: arr[i], score: parseFloat(arr[i + 1]) });
      return out;
    }
    async setNx(key, value, pxMs) { const r = await this._exec(['SET', key, value, 'NX', 'PX', String(pxMs)]); return !!(r && r[1] === 'OK'); }
    async ping() { const r = await this._exec(['PING']); return !!(r && (r[1] === 'PONG' || r[1] === 'pong')); }
  }

  // ============ TRẠNG THÁI KẾT NỐI ============
  let redisAvailable = false;
  let redisClient = null;
  let _readyPromise = null;
  let _healthCheckTimer = null;
  let _config = Object.assign({}, DEFAULT_OPTS);

  // ============ API CHÍNH ============
  const RedisBitmap = {
    // Cho phép chỉnh cấu hình (timeout, số lần thử lại, mức log...) sau khi
    // tải trang - VD: RedisBitmap.configure({ logLevel: 'debug' }) lúc debug.
    configure(opts) {
      _config = Object.assign({}, _config, opts || {});
      if (redisClient) redisClient.opts = Object.assign({}, redisClient.opts, opts || {});
    },

    isAvailable() {
      return redisAvailable && redisClient !== null;
    },

    async init() {
      if (!REDIS_URL || !REDIS_TOKEN) {
        console.log('Redis Bitmap: Chưa cấu hình (dùng Supabase thay thế)');
        return false;
      }
      try {
        redisClient = new RedisBitmapClient(REDIS_URL, REDIS_TOKEN, _config);
        const ok = await redisClient.ping();
        redisAvailable = ok;
        if (ok) {
          console.log('✅ Redis Bitmap PRO đã kết nối');
          _startHealthCheck();
        } else {
          console.warn('⚠️ Redis Bitmap: không kết nối được, dùng Supabase thay thế');
        }
        return ok;
      } catch (e) {
        console.warn('Redis connection failed:', e);
        redisAvailable = false;
        return false;
      }
    },

    // Chờ tới khi init() xong (thành công hoặc thất bại)
    async ready() {
      let waited = 0;
      while (!_readyPromise && waited < 3000) {
        await sleep(50);
        waited += 50;
      }
      if (_readyPromise) await _readyPromise;
      return this.isAvailable();
    },

    // ===================== PRESENCE (ONLINE) =====================
    // Đánh dấu online: dùng PIPELINE để gộp 4 lệnh cũ (SETBIT + HSET + 2x
    // EXPIRE) thành 1 lần gọi mạng duy nhất thay vì 4 lần như bản cũ.
    async setOnline(username, timestamp) {
      if (!this.isAvailable()) return false;
      const offset = userIdOffset(username);
      const ttl = _config.onlineTtlSeconds;
      const ts = timestamp || Date.now();
      const results = await redisClient._execPipeline([
        ['SETBIT', KEYS.ONLINE_USERS, String(offset), '1'],
        ['HSET', KEYS.LAST_SEEN_TIMESTAMPS, username, String(ts)],
        ['EXPIRE', KEYS.ONLINE_USERS, String(ttl)],
        ['EXPIRE', KEYS.LAST_SEEN_TIMESTAMPS, String(ttl)]
      ]);
      return results !== null;
    },

    async setOffline(username) {
      if (!this.isAvailable()) return false;
      const offset = userIdOffset(username);
      return (await redisClient.setBit(KEYS.ONLINE_USERS, offset, false)) !== null;
    },

    async getOnlineCount() {
      if (!this.isAvailable()) return -1; // -1 = chưa rõ, để trang tự fallback Supabase
      return redisClient.bitCount(KEYS.ONLINE_USERS);
    },

    async isOnline(username) {
      if (!this.isAvailable()) return null;
      return redisClient.getBit(KEYS.ONLINE_USERS, userIdOffset(username));
    },

    // MỚI: kiểm tra online hàng loạt cho nhiều user cùng lúc trong 1 lần gọi
    // mạng (VD: manage.html cần biết trạng thái của cả danh sách user online
    // để tô sáng/kiểm tra nhanh, thay vì gọi isOnline() từng người 1).
    async getOnlineStatusBatch(usernames) {
      if (!this.isAvailable() || !usernames || !usernames.length) return {};
      const commands = usernames.map(u => ['GETBIT', KEYS.ONLINE_USERS, String(userIdOffset(u))]);
      const results = await redisClient._execPipeline(commands);
      const out = {};
      if (!results) return out;
      usernames.forEach(function(u, i) { out[u] = results[i] === 1; });
      return out;
    },

    async getAllOnlineUsers() {
      if (!this.isAvailable()) return [];
      const r = await redisClient._exec(['HGETALL', KEYS.LAST_SEEN_TIMESTAMPS]);
      if (!r || !r[1]) return [];
      const users = [], data = r[1];
      for (let i = 0; i < data.length; i += 2) {
        if (data[i] && data[i + 1]) {
          const ts = parseInt(data[i + 1]);
          if (Date.now() - ts < _config.onlineTtlSeconds * 1000) {
            users.push({ user_name: data[i], last_seen: new Date(ts).toISOString() });
          }
        }
      }
      return users;
    },

    // ===================== MODERATION (KICK / WARNING) =====================
    async kickUser(username) {
      if (!this.isAvailable()) return false;
      const offset = userIdOffset(username);
      const results = await redisClient._execPipeline([
        ['SETBIT', KEYS.KICKED_USERS, String(offset), '1'],
        ['SETBIT', KEYS.ONLINE_USERS, String(offset), '0']
      ]);
      return results !== null;
    },

    async isKicked(username) {
      if (!this.isAvailable()) return null;
      return redisClient.getBit(KEYS.KICKED_USERS, userIdOffset(username));
    },

    async unkickUser(username) {
      if (!this.isAvailable()) return false;
      return (await redisClient.setBit(KEYS.KICKED_USERS, userIdOffset(username), false)) !== null;
    },

    async setWarning(username) {
      if (!this.isAvailable()) return false;
      return (await redisClient.setBit(KEYS.WARNED_USERS, userIdOffset(username), true)) !== null;
    },

    async hasWarning(username) {
      if (!this.isAvailable()) return null;
      return redisClient.getBit(KEYS.WARNED_USERS, userIdOffset(username));
    },

    async clearWarning(username) {
      if (!this.isAvailable()) return false;
      return (await redisClient.setBit(KEYS.WARNED_USERS, userIdOffset(username), false)) !== null;
    },

    async setNotification(username, notificationId) {
      if (!this.isAvailable()) return false;
      const userKey = KEYS.USER_NOTIFICATIONS + ':' + userIdOffset(username);
      const results = await redisClient._execPipeline([
        ['HSET', userKey, notificationId, '1'],
        ['EXPIRE', userKey, '86400']
      ]);
      return results !== null;
    },

    // ===================== MỚI: CHỐNG SPAM (RATE LIMIT) =====================
    // Dùng cho: giới hạn số lần báo lỗi/xin đáp án/gửi chat/thử OTP trong 1
    // khoảng thời gian, tránh 1 người spam làm phình bảng Supabase.
    // fail-open: nếu Redis không sẵn sàng thì luôn coi là "được phép" (allowed:
    // true) - không bao giờ để lỗi hạ tầng Redis chặn nhầm người dùng thật.
    rateLimit: {
      async check(key, limit, windowSeconds) {
        if (!RedisBitmap.isAvailable()) return { allowed: true, remaining: null, count: null };
        const fullKey = KEYS.RATE_LIMIT_PREFIX + key;
        const count = await redisClient.incrBy(fullKey, 1);
        if (count === null) return { allowed: true, remaining: null, count: null };
        if (count === 1) await redisClient.expire(fullKey, windowSeconds);
        return { allowed: count <= limit, remaining: Math.max(0, limit - count), count: count };
      },
      // Xoá bộ đếm sớm (VD: sau khi người dùng xác thực OTP thành công, xoá
      // luôn bộ đếm "số lần thử sai" thay vì chờ hết hạn tự nhiên)
      async reset(key) {
        if (!RedisBitmap.isAvailable()) return false;
        return (await redisClient.del(KEYS.RATE_LIMIT_PREFIX + key)) !== null;
      }
    },

    // ===================== MỚI: BỘ ĐẾM NHANH CHO DASHBOARD =====================
    // Dùng INCRBY thay vì COUNT(*) trên Supabase mỗi lần load Dashboard -
    // đặc biệt hữu ích khi số bản ghi (lượt xem, lượt đăng nhập...) đã lớn.
    stats: {
      async increment(name, by) {
        if (!RedisBitmap.isAvailable()) return null;
        return redisClient.incrBy(KEYS.STATS_PREFIX + name, by == null ? 1 : by);
      },
      async get(name) {
        if (!RedisBitmap.isAvailable()) return null;
        const v = await redisClient.get(KEYS.STATS_PREFIX + name);
        return v !== null ? parseInt(v) : 0;
      },
      // Lấy nhiều chỉ số cùng lúc bằng 1 pipeline (VD: Dashboard cần 5-6 số
      // liệu khác nhau - trước đây phải gọi Supabase 5-6 lần riêng).
      async getMultiple(names) {
        if (!RedisBitmap.isAvailable() || !names || !names.length) return {};
        const commands = names.map(n => ['GET', KEYS.STATS_PREFIX + n]);
        const results = await redisClient._execPipeline(commands);
        const out = {};
        if (!results) { names.forEach(n => out[n] = 0); return out; }
        names.forEach(function(n, i) { out[n] = results[i] !== null ? parseInt(results[i]) : 0; });
        return out;
      }
    },

    // ===================== MỚI: THÔNG BÁO CHUNG - AI ĐÃ ĐỌC =====================
    // Mỗi thông báo chung có 1 bitmap riêng (1 bit / user, y hệt cơ chế online/
    // kicked) -> biết ngay có bao nhiêu người đã đọc 1 thông báo mà không cần
    // thêm bảng phụ trong Supabase.
    notices: {
      async markRead(username, noticeId) {
        if (!RedisBitmap.isAvailable()) return false;
        return (await redisClient.setBit(KEYS.NOTICE_READ_PREFIX + noticeId, userIdOffset(username), true)) !== null;
      },
      async hasRead(username, noticeId) {
        if (!RedisBitmap.isAvailable()) return null;
        return redisClient.getBit(KEYS.NOTICE_READ_PREFIX + noticeId, userIdOffset(username));
      },
      async getReadCount(noticeId) {
        if (!RedisBitmap.isAvailable()) return -1;
        return redisClient.bitCount(KEYS.NOTICE_READ_PREFIX + noticeId);
      }
    },

    // ===================== MỚI: BÀI SOẠN XEM NHIỀU NHẤT =====================
    // Sorted Set: mỗi lượt xem bài -> ZINCRBY +1. Không nên ghi lượt xem
    // thẳng vào Supabase (tăng liên tục, tốn quota + chậm), Redis phù hợp
    // hơn nhiều cho loại số liệu "tăng liên tục, đọc thường xuyên" này.
    views: {
      async increment(postId) {
        if (!RedisBitmap.isAvailable()) return null;
        return redisClient.zIncrBy(KEYS.POST_VIEWS_ZSET, 1, postId);
      },
      async get(postId) {
        if (!RedisBitmap.isAvailable()) return 0;
        return redisClient.zScore(KEYS.POST_VIEWS_ZSET, postId);
      },
      // Top N bài xem nhiều nhất - dùng cho mục "Bài soạn nổi bật" nếu muốn thêm
      async getTop(n) {
        if (!RedisBitmap.isAvailable()) return [];
        return redisClient.zRevRangeWithScores(KEYS.POST_VIEWS_ZSET, 0, (n || 10) - 1);
      }
    },

    // ===================== MỚI: KHOÁ PHÂN TÁN NGẮN HẠN =====================
    // Chống bấm đúp / chạy trùng 1 hành động từ 2 tab hoặc 2 thiết bị cùng
    // lúc (VD: 2 quản lý cùng bấm "duyệt yêu cầu đáp án" cho cùng 1 người
    // đúng lúc, hoặc chặn spam-click nút gửi thông báo chung).
    lock: {
      // ttlMs: khoá tự hết hạn sau bao lâu (đề phòng tab bị đứng/crash quên
      // release() thì khoá vẫn tự giải phóng, không bị kẹt vĩnh viễn)
      async acquire(key, ttlMs) {
        if (!RedisBitmap.isAvailable()) return true; // fail-open: Redis lỗi thì coi như luôn lấy được khoá
        return redisClient.setNx(KEYS.LOCK_PREFIX + key, '1', ttlMs || 5000);
      },
      async release(key) {
        if (!RedisBitmap.isAvailable()) return false;
        return (await redisClient.del(KEYS.LOCK_PREFIX + key)) !== null;
      }
    }
  };

  // ============ TỰ KIỂM TRA SỨC KHOẺ + TỰ KẾT NỐI LẠI ============
  // Bản cũ: chỉ init() 1 lần lúc tải trang, nếu Redis rớt mạng vài giây rồi
  // phục hồi thì web vẫn coi Redis là "chết" cho tới khi người dùng tải lại
  // trang. Bản mới: định kỳ ping lại - mất kết nối thì tự phát hiện, phục
  // hồi thì tự bật lại isAvailable() mà không cần tải lại trang.
  function _startHealthCheck() {
    clearInterval(_healthCheckTimer);
    _healthCheckTimer = setInterval(async function() {
      if (!redisClient) return;
      try {
        const ok = await redisClient.ping();
        if (ok !== redisAvailable) {
          console.log(ok ? '✅ Redis Bitmap đã kết nối lại' : '⚠️ Redis Bitmap mất kết nối, tạm dùng Supabase');
        }
        redisAvailable = ok;
      } catch (e) { redisAvailable = false; }
    }, _config.healthCheckIntervalMs);
  }

  // ============ EXPORT RA GLOBAL SCOPE ============
  if (typeof window !== 'undefined') {
    window.RedisBitmap = RedisBitmap;

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function() {
        _readyPromise = RedisBitmap.init();
      });
    } else {
      _readyPromise = RedisBitmap.init();
    }

    // Dừng health-check khi rời trang, tránh rò rỉ timer
    window.addEventListener('beforeunload', function() {
      clearInterval(_healthCheckTimer);
    });
  }

  // ============ EXPORT CHO NODE.JS (nếu cần test) ============
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = RedisBitmap;
  }

})();
