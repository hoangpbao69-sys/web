/**
 * api/manager-login.js — Kiểm tra mật khẩu quản trị Ở PHÍA MÁY CHỦ.
 * ---------------------------------------------------------------------------
 * VÌ SAO CẦN FILE NÀY
 * manage.html trước đây chứa nguyên dòng `const MANAGER_PASSWORD = '1508';`.
 * Mọi file JS/HTML của một trang web tĩnh đều được gửi xuống trình duyệt, nên
 * bất kỳ ai bấm Ctrl+U cũng đọc được mật khẩu đó. Không có cách nào "giấu"
 * mật khẩu trong mã chạy ở trình duyệt — chỉ có thể chuyển việc so khớp sang
 * máy chủ, nơi người dùng không đọc được mã.
 *
 * CÁCH CÀI (1 phút, làm 1 lần)
 *   1. Đặt file này vào thư mục `api/` của dự án (cùng chỗ với api/qrcode.js).
 *   2. Vercel → Project → Settings → Environment Variables → thêm:
 *          MANAGER_PASSWORD = <mật khẩu mới bạn tự đặt>
 *      Nên đổi hẳn sang mật khẩu mới, vì mật khẩu cũ đã nằm công khai trong
 *      mã nguồn suốt thời gian qua, phải coi như đã lộ.
 *   3. Deploy lại. manage.html tự động gọi endpoint này; nếu endpoint chưa có
 *      (404) nó mới rơi xuống lớp dự phòng băm SHA-256 phía trình duyệt.
 *
 * CHỐNG DÒ MẬT KHẨU: mỗi IP tối đa 10 lần thử sai trong 10 phút. Bộ đếm nằm
 * trong bộ nhớ của từng instance serverless — đủ để chặn dò tự động thô sơ.
 * Muốn chắc chắn hơn thì chuyển bộ đếm sang Upstash Redis (xem api/redis.js).
 */

const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILS = 10;
const attempts = new Map(); // ip -> { count, resetAt }

function tooManyAttempts(ip) {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || now > rec.resetAt) return false;
  return rec.count >= MAX_FAILS;
}

function noteFailure(ip) {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || now > rec.resetAt) attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
  else rec.count++;
}

/** So sánh chuỗi theo thời gian hằng số — không để lộ độ dài/prefix đúng qua
 *  thời gian phản hồi. Với mật khẩu ngắn thì khác biệt là nhỏ, nhưng đây là
 *  thói quen đúng và không tốn gì. */
function safeEqual(a, b) {
  const sa = String(a || '');
  const sb = String(b || '');
  let diff = sa.length ^ sb.length;
  for (let i = 0; i < Math.max(sa.length, sb.length); i++) {
    diff |= sa.charCodeAt(i % (sa.length || 1)) ^ sb.charCodeAt(i % (sb.length || 1));
  }
  return diff === 0;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'method_not_allowed' });
    return;
  }

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (tooManyAttempts(ip)) {
    res.status(429).json({ ok: false, error: 'too_many_attempts' });
    return;
  }

  const expected = process.env.MANAGER_PASSWORD;
  if (!expected) {
    // Chưa đặt biến môi trường: trả 404 để manage.html hiểu là "chưa cài" và
    // dùng lớp dự phòng, thay vì khoá luôn không ai đăng nhập được.
    res.status(404).json({ ok: false, error: 'not_configured' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  const given = body && body.password;

  if (!given || !safeEqual(given, expected)) {
    noteFailure(ip);
    // Trễ nhẹ, cố định — làm chậm việc dò mà không tạo kênh rò rỉ thời gian.
    await new Promise(r => setTimeout(r, 400));
    res.status(200).json({ ok: false });
    return;
  }

  attempts.delete(ip);
  res.status(200).json({ ok: true });
};
