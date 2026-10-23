// /api/qrcode?text=NOI_DUNG&size=300
// Tạo mã QR ngay trên server (Vercel Function) — dùng khi cần một mã QR
// độc lập, không phụ thuộc JS phía trình duyệt. Trả về ảnh PNG.
//
// Ví dụ dùng trong HTML:
//   <img src="/api/qrcode?text=B001|Nguyen+Van+A" width="220" height="220">

const QRCode = require('qrcode');

module.exports = async (req, res) => {
  try {
    const text = (req.query.text || '').toString();
    const size = Math.min(Math.max(parseInt(req.query.size, 10) || 300, 64), 1024);

    if (!text) {
      res.status(400).json({ error: 'Thiếu tham số ?text=' });
      return;
    }

    const pngBuffer = await QRCode.toBuffer(text, {
      type: 'png',
      width: size,
      margin: 2,
      errorCorrectionLevel: 'M'
    });

    res.setHeader('Content-Type', 'image/png');
    // Cache 1 năm vì nội dung QR không đổi nếu text không đổi
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.status(200).send(pngBuffer);
  } catch (err) {
    res.status(500).json({ error: 'Không tạo được mã QR', detail: String(err && err.message || err) });
  }
};
