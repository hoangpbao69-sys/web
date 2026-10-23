/* =========================================================
   REDIS BITMAP OPTIMIZATION LAYER
   - Online user tracking: O(1) bit operations instead of table scans
   - Kick/ban: Instant bitmap check instead of DB queries
   - Warnings/notifications: Efficient bit flags
   - Falls back to Supabase if Redis is unavailable
   ========================================================= */

(function() {
  'use strict';

  // ============ CONFIGURATION ============
  // Upstash Redis (free tier): https://upstash.com
  const REDIS_URL = 'https://expert-aphid-177973.upstash.io';
  const REDIS_TOKEN = 'gQAAAAAAArc1AAIgcDIxN2FiNTVlYzI4ZGU0MzRiOWEwZWNjYmY1MjBlNjRkNw';
  
  // If using a simple Redis server, uncomment below:
  // const REDIS_HOST = 'your-redis-host';
  // const REDIS_PORT = 6379;
  // const REDIS_PASSWORD = null;

  // ============ BITMAP KEYS ============
  const KEYS = {
    ONLINE_USERS: 'web:online_users',      // Bitmap: 1 = online, 0 = offline
    KICKED_USERS: 'web:kicked_users',      // Bitmap: 1 = kicked/banned
    WARNED_USERS: 'web:warned_users',      // Bitmap: 1 = has warning
    USER_NOTIFICATIONS: 'web:notifications', // Bitmap per user session
    LAST_SEEN_TIMESTAMPS: 'web:timestamps'  // Hash: user -> last_seen timestamp
  };

  // ============ REDIS CLIENT ============
  let redisAvailable = false;
  let redisClient = null;
  let _readyPromise = null; // Promise được set khi bắt đầu init(), dùng cho ready()

  // Simple Redis client using REST API (Upstash compatible)
  class RedisBitmapClient {
    constructor(url, token) {
      this.url = url.replace(/\/$/, '');
      this.token = token;
      this.baseUrl = url;
    }

    async _exec(command) {
      try {
        // Upstash REST API: gửi mảng lệnh trực tiếp trong body (KHÔNG bọc thêm
        // 1 lớp mảng nữa - "[command]" trước đây là sai, khiến Upstash luôn
        // trả lỗi cú pháp lệnh).
        const resp = await fetch(this.url, {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + this.token,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(command)
        });
        const data = await resp.json();
        // Upstash trả về { "result": ... } khi thành công hoặc
        // { "error": "..." } khi thất bại - KHÔNG phải dạng mảng [cmd, result]
        // như bản cũ tưởng nhầm (đây là lý do mọi lệnh trước đây luôn coi như
        // thất bại/rỗng). Chuẩn hoá lại để phần code phía dưới dùng result[1]
        // theo thói quen cũ vẫn hoạt động đúng.
        if (!resp.ok || (data && data.error)) {
          if (data && data.error) console.warn('Upstash trả lỗi:', data.error);
          return null;
        }
        return [null, data.result];
      } catch (e) {
        console.warn('Redis not available, falling back to Supabase:', e.message);
        return null;
      }
    }

    // SETBIT key offset value
    async setBit(key, offset, value) {
      return this._exec(['SETBIT', key, String(offset), value ? '1' : '0']);
    }

    // GETBIT key offset
    async getBit(key, offset) {
      const result = await this._exec(['GETBIT', key, String(offset)]);
      return result && result[1] === 1;
    }

    // SETBIT multiple offsets
    async setBits(key, offsets, value) {
      const promises = offsets.map(offset => this.setBit(key, offset, value));
      return Promise.all(promises);
    }

    // BITCOUNT key
    async bitCount(key) {
      const result = await this._exec(['BITCOUNT', key]);
      return result && result[1] !== undefined ? parseInt(result[1]) : 0;
    }

    // HSET key field value
    async hSet(key, field, value) {
      return this._exec(['HSET', key, field, String(value)]);
    }

    // HGET key field
    async hGet(key, field) {
      const result = await this._exec(['HGET', key, field]);
      return result && result[1] !== undefined ? result[1] : null;
    }

    // EXPIRE key seconds
    async expire(key, seconds) {
      return this._exec(['EXPIRE', key, String(seconds)]);
    }

    // DEL key
    async del(key) {
      return this._exec(['DEL', key]);
    }
  }

  // ============ USER ID GENERATOR ============
  // Generate consistent numeric ID from username for bitmap offset
  function userIdOffset(username) {
    if (!username) return 0;
    let hash = 0;
    const str = String(username);
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash) % 100000; // Support up to 100k users
  }

  // ============ REDIS BITMAP API ============
  const RedisBitmap = {
    // Check if Redis is available
    isAvailable() {
      return redisAvailable && redisClient !== null;
    },

    // Initialize connection
    async init() {
      if (!REDIS_URL || !REDIS_TOKEN) {
        console.log('Redis Bitmap: Not configured (using Supabase fallback)');
        return false;
      }
      try {
        redisClient = new RedisBitmapClient(REDIS_URL, REDIS_TOKEN);
        // Test connection - dùng 1 key tạm rồi xoá ngay, tránh rác trong Redis
        const testResult = await redisClient.setBit('web:ping', 0, true);
        if (testResult !== null) {
          redisAvailable = true;
          redisClient.del('web:ping');
          console.log('✅ Redis Bitmap connected');
          return true;
        }
      } catch (e) {
        console.warn('Redis connection failed:', e);
      }
      return false;
    },

    // Chờ cho tới khi init() xong (thành công hoặc thất bại). Các trang
    // web nên "await RedisBitmap.ready()" trước khi gọi các hàm khác, để
    // tránh trường hợp gọi RedisBitmap ngay khi trang vừa tải xong nhưng
    // init() (bất đồng bộ) chưa kịp chạy xong -> isAvailable() sai thành false.
    async ready() {
      // Nếu init() chưa được gọi tới (VD: đang gọi ready() rất sớm, trước cả
      // khi sự kiện DOMContentLoaded kích hoạt init()), tự đợi tối đa 3 giây
      // rồi kiểm tra lại, tránh treo mãi mãi.
      let waited = 0;
      while (!_readyPromise && waited < 3000) {
        await new Promise(function(r){ setTimeout(r, 50); });
        waited += 50;
      }
      if (_readyPromise) await _readyPromise;
      return this.isAvailable();
    },

    // Mark user as online
    async setOnline(username, timestamp) {
      if (!this.isAvailable()) return false;
      const offset = userIdOffset(username);
      try {
        await Promise.all([
          redisClient.setBit(KEYS.ONLINE_USERS, offset, true),
          redisClient.hSet(KEYS.LAST_SEEN_TIMESTAMPS, username, timestamp || Date.now()),
          redisClient.expire(KEYS.ONLINE_USERS, 300), // 5 min TTL
          redisClient.expire(KEYS.LAST_SEEN_TIMESTAMPS, 300)
        ]);
        return true;
      } catch (e) {
        return false;
      }
    },

    // Mark user as offline
    async setOffline(username) {
      if (!this.isAvailable()) return false;
      const offset = userIdOffset(username);
      try {
        await redisClient.setBit(KEYS.ONLINE_USERS, offset, false);
        return true;
      } catch (e) {
        return false;
      }
    },

    // Get online count
    async getOnlineCount() {
      if (!this.isAvailable()) return -1; // -1 means fallback
      try {
        const count = await redisClient.bitCount(KEYS.ONLINE_USERS);
        return count;
      } catch (e) {
        return -1;
      }
    },

    // Check if user is online
    async isOnline(username) {
      if (!this.isAvailable()) return null; // null means unknown
      const offset = userIdOffset(username);
      try {
        return await redisClient.getBit(KEYS.ONLINE_USERS, offset);
      } catch (e) {
        return null;
      }
    },

    // Kick/ban user (set bit)
    async kickUser(username) {
      if (!this.isAvailable()) return false;
      const offset = userIdOffset(username);
      try {
        await Promise.all([
          redisClient.setBit(KEYS.KICKED_USERS, offset, true),
          redisClient.setBit(KEYS.ONLINE_USERS, offset, false) // Remove from online
        ]);
        return true;
      } catch (e) {
        return false;
      }
    },

    // Check if user is kicked
    async isKicked(username) {
      if (!this.isAvailable()) return null;
      const offset = userIdOffset(username);
      try {
        return await redisClient.getBit(KEYS.KICKED_USERS, offset);
      } catch (e) {
        return null;
      }
    },

    // Unkick user
    async unkickUser(username) {
      if (!this.isAvailable()) return false;
      const offset = userIdOffset(username);
      try {
        await redisClient.setBit(KEYS.KICKED_USERS, offset, false);
        return true;
      } catch (e) {
        return false;
      }
    },

    // Set warning flag
    async setWarning(username) {
      if (!this.isAvailable()) return false;
      const offset = userIdOffset(username);
      try {
        await redisClient.setBit(KEYS.WARNED_USERS, offset, true);
        return true;
      } catch (e) {
        return false;
      }
    },

    // Check if user has warning
    async hasWarning(username) {
      if (!this.isAvailable()) return null;
      const offset = userIdOffset(username);
      try {
        return await redisClient.getBit(KEYS.WARNED_USERS, offset);
      } catch (e) {
        return null;
      }
    },

    // Clear warning
    async clearWarning(username) {
      if (!this.isAvailable()) return false;
      const offset = userIdOffset(username);
      try {
        await redisClient.setBit(KEYS.WARNED_USERS, offset, false);
        return true;
      } catch (e) {
        return false;
      }
    },

    // Set notification for user
    async setNotification(username, notificationId) {
      if (!this.isAvailable()) return false;
      const userKey = KEYS.USER_NOTIFICATIONS + ':' + userIdOffset(username);
      try {
        await redisClient.hSet(userKey, notificationId, '1');
        await redisClient.expire(userKey, 86400); // 24h TTL
        return true;
      } catch (e) {
        return false;
      }
    },

    // Get all online users (from Redis hash)
    async getAllOnlineUsers() {
      if (!this.isAvailable()) return [];
      try {
        const result = await redisClient._exec(['HGETALL', KEYS.LAST_SEEN_TIMESTAMPS]);
        if (!result || !result[1]) return [];
        // Parse HGETALL response: [field1, value1, field2, value2, ...]
        const users = [];
        const data = result[1];
        for (let i = 0; i < data.length; i += 2) {
          if (data[i] && data[i+1]) {
            const timestamp = parseInt(data[i+1]);
            // Only include users seen in last 5 minutes
            if (Date.now() - timestamp < 300000) {
              users.push({ user_name: data[i], last_seen: new Date(timestamp).toISOString() });
            }
          }
        }
        return users;
      } catch (e) {
        return [];
      }
    }
  };

  // ============ EXPORT TO GLOBAL SCOPE ============
  if (typeof window !== 'undefined') {
    window.RedisBitmap = RedisBitmap;
    
    // Auto-initialize when DOM is ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function() {
        _readyPromise = RedisBitmap.init();
      });
    } else {
      _readyPromise = RedisBitmap.init();
    }
  }

  // ============ EXPORT FOR NODE.JS (if needed) ============
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = RedisBitmap;
  }

})();