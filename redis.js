/**
 * api/redis.js — Cổng trung gian tới Upstash Redis.
 * ---------------------------------------------------------------------------
 * VÌ SAO CẦN FILE NÀY
 * File `redis-bitmap.js` hiện tại chứa nguyên token Upstash trong mã chạy ở
 * trình duyệt. Token đó có TOÀN QUYỀN đọc/ghi/xoá Redis. Ai mở web, bấm F12
 * hoặc Ctrl+U cũng lấy được, rồi xoá sạch dữ liệu của bạn từ máy họ. Đây là
 * việc bạn đã được nhắc trong cả hai bản cập nhật trước và vẫn chưa làm — nó
 * nghiêm trọng hơn mọi lỗi giao diện.
 *
 * CÁCH CÀI
 *   1. Vào Upstash → THU HỒI (revoke) token đang nằm trong redis-bitmap.js.
 *      Token đó phải coi như đã lộ hoàn toàn.
 *   2. Tạo token mới. KHÔNG đặt nó vào bất kỳ file .js/.html nào.
 *   3. Vercel → Settings → Environment Variables:
 *          UPSTASH_REDIS_REST_URL   = https://<tên>.upstash.io
 *          UPSTASH_REDIS_REST_TOKEN = <token mới>
 *   4. Đặt file này vào `api/`, dùng kèm `lib/redis-bitmap.js` bản mới.
 *   5. Deploy.
 *
 * LỚP CHẶN: chỉ cho phép đúng những lệnh mà web thật sự dùng, và chỉ trên các
 * key có tiền tố "web:". Nhờ vậy dù trang bị chèn mã, kẻ tấn công cũng không
 * gọi được FLUSHALL, KEYS *, CONFIG... qua cổng này.
 */

const ALLOWED_COMMANDS = new Set([
  'SETBIT', 'GETBIT', 'BITCOUNT', 'HSET', 'HGET', 'HGETALL', 'HDEL', 'EXPIRE', 'DEL', 'TTL'
]);
const KEY_PREFIX = 'web:';
const MAX_PIPELINE = 20;

function validate(command) {
  if (!Array.isArray(command) || command.length < 2) return 'Lệnh không hợp lệ';
  const op = String(command[0] || '').toUpperCase();
  if (!ALLOWED_COMMANDS.has(op)) return 'Lệnh "' + op + '" không được phép';
  const key = String(command[1] || '');
  if (!key.startsWith(KEY_PREFIX)) return 'Key phải bắt đầu bằng "' + KEY_PREFIX + '"';
  if (key.length > 200) return 'Key quá dài';
  if (command.some(a => String(a).length > 500)) return 'Tham số quá dài';
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    // Chưa cấu hình: báo rõ ràng để redis-bitmap.js chuyển sang dùng Supabase.
    res.status(503).json({ error: 'redis_not_configured' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }
  if (!body) { res.status(400).json({ error: 'bad_request' }); return; }

  // Chấp nhận 1 lệnh ["SETBIT", ...] hoặc nhiều lệnh [[...],[...]] (pipeline).
  const isPipeline = Array.isArray(body) && Array.isArray(body[0]);
  const commands = isPipeline ? body : [body];
  if (commands.length > MAX_PIPELINE) {
    res.status(400).json({ error: 'too_many_commands' });
    return;
  }
  for (const c of commands) {
    const err = validate(c);
    if (err) { res.status(400).json({ error: err }); return; }
  }

  try {
    const endpoint = isPipeline ? url.replace(/\/$/, '') + '/pipeline' : url.replace(/\/$/, '');
    const upstream = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(isPipeline ? commands : commands[0])
    });
    const data = await upstream.json();
    res.status(upstream.ok ? 200 : 502).json(data);
  } catch (e) {
    res.status(502).json({ error: 'upstream_failed', detail: String(e && e.message || e) });
  }
};
