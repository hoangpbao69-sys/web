# Sửa lỗi "mất mạng" khi tạo/quét mã QR đăng nhập Admin

## Vấn đề cũ
Trong `manage.html` (mục 🔳 Mã QR đăng nhập), 2 thư viện JS dùng để **tạo mã QR**
(`qrcode.js`) và **đọc mã QR qua camera** (`jsQR.js`) được tải từ CDN ngoài
(jsdelivr, có fallback sang unpkg). Nếu mạng/DNS chặn 2 CDN này (hay chặn
quảng cáo/CDN), trình duyệt báo lỗi kiểu "không có mạng" và tính năng QR
không hoạt động — dù phần còn lại của web (Supabase...) vẫn chạy bình thường.

## Đã sửa gì
1. **Tự lưu trữ 2 thư viện ngay trong site**, không gọi CDN ngoài nữa:
   - `lib/qrcode.min.js` — build lại từ gói npm chính chủ `qrcode@1.5.3`
   - `lib/jsQR.js` — build sẵn từ gói npm chính chủ `jsqr@1.4.0`
   
   `manage.html` giờ chỉ load:
   ```html
   <script src="lib/qrcode.min.js"></script>
   <script src="lib/jsQR.js"></script>
   ```
   Không còn đoạn `onerror` fallback sang CDN khác nữa vì không cần thiết.

2. **Thêm 1 API tạo QR phía server** (`/api/qrcode`) làm phương án dự phòng /
   dùng khi cần in mã QR ra ảnh tĩnh mà không cần JS phía trình duyệt:
   ```
   GET /api/qrcode?text=NOI_DUNG&size=300   → trả về ảnh PNG
   ```
   Ví dụ nhúng trực tiếp:
   ```html
   <img src="/api/qrcode?text=B001|Nguyen Van A" width="220" height="220">
   ```
   API này chạy trên Vercel Functions (Node.js), dùng gói `qrcode` phía
   server — không liên quan gì tới việc tải JS ở trình duyệt nên không bao
   giờ bị lỗi "mất mạng" kiểu CDN nữa.

   > Việc tạo mã QR hiển thị trong trang quản lý (mục "🔳 Mã QR đăng nhập")
   > vẫn dùng `lib/qrcode.min.js` (client-side, để giữ nguyên hành vi cũ:
   > preview ngay, không cần gọi server). API `/api/qrcode` chỉ là công cụ
   > bổ sung nếu bạn cần lấy ảnh QR trực tiếp (ví dụ để in, để nhúng nơi
   > khác, hoặc build sau này).

## Cấu trúc thư mục
```
qr-tool-deploy/
├── index.html          ← trang web chính (không đổi)
├── manage.html          ← trang quản trị (đã sửa 2 dòng <script>)
├── lib/
│   ├── qrcode.min.js    ← tự lưu trữ, không phụ thuộc CDN
│   └── jsQR.js          ← tự lưu trữ, không phụ thuộc CDN
├── api/
│   └── qrcode.js        ← API tạo QR phía server (tuỳ chọn)
├── node_modules/qrcode  ← dependency cho api/qrcode.js
├── package.json
└── vercel.json
```

## Cách deploy lên Vercel
1. Đưa toàn bộ thư mục này lên GitHub (hoặc kéo thả thẳng vào Vercel qua CLI).
2. Trên [vercel.com](https://vercel.com) → **Add New → Project** → chọn repo này.
   Không cần cấu hình gì thêm (Framework Preset: **Other**, Build Command: để trống).
3. Deploy. Vercel tự nhận:
   - `index.html`, `manage.html`, `lib/*` → phục vụ như file tĩnh.
   - `api/qrcode.js` → tự động thành 1 serverless function tại `/api/qrcode`.
4. Test lại mục "🔳 Mã QR đăng nhập" trong `manage.html` — giờ tạo/hiển thị/
   quét QR sẽ chạy hoàn toàn từ file của chính site, không còn phụ thuộc
   CDN ngoài nên không còn báo lỗi mất mạng nữa.

### Deploy bằng CLI (thay cho bước GitHub, nếu muốn nhanh)
```bash
npm i -g vercel
cd qr-tool-deploy
vercel        # lần đầu sẽ hỏi link project, chọn theo hướng dẫn
vercel --prod # deploy bản chính thức
```

## Lưu ý
- Nếu sau này bạn thêm cột/nội dung mới muốn tạo QR, chỉ cần gọi lại hàm
  `QRCode.toDataURL(...)` / `QRCode.toCanvas(...)` như code hiện tại trong
  `manage.html` — API không đổi, chỉ đổi nguồn tải thư viện.
- Muốn cập nhật thư viện lên bản mới hơn sau này: chạy lại
  `npm install qrcode@<version> jsqr@<version>` rồi build lại file trong
  `lib/` (dùng esbuild để đóng gói `qrcode` thành 1 file IIFE, còn `jsqr`
  đã có sẵn file build trong gói npm ở `dist/jsQR.js`).
