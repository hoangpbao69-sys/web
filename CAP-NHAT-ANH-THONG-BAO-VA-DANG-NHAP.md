# Cập nhật: khung ảnh thông báo + sửa lỗi đăng nhập 2 nơi + UI đăng nhập mới

## 0. Nhắc lại việc gấp (chưa làm, vì đổi kiến trúc)

`lib/redis-bitmap.js` vẫn để lộ token Upstash Redis ngay trong mã chạy ở trình
duyệt. Ai mở web cũng đọc được và có toàn quyền đọc/ghi/xoá Redis. Nên thu hồi
token cũ và chuyển các lệnh Redis sang serverless function của Vercel (giống
`/api/qrcode`). Việc này quan trọng hơn mọi thứ trong bản cập nhật này.

---

## 1. File mới

```
lib/auth-ui.css          ← giao diện đăng nhập mới, dùng chung 4 trang
lib/notice-gallery.css   ← khung ảnh thông báo ở trang chủ
lib/notice-gallery.js    ← logic lướt ảnh / vuốt / xem toàn màn hình
```

Mỗi trang được chèn thêm đúng 1–3 dòng ngay **trước** `</head>` (phải nằm sau
khối `<style>` gốc thì mới ghi đè được):

| Trang | Dòng thêm |
|---|---|
| `index.html` | `auth-ui.css` + `notice-gallery.css` + `notice-gallery.js` |
| `logbook.html`, `library.html`, `manage.html` | `auth-ui.css` |

---

## 2. Ảnh trong "Thông báo chung" (mục bạn yêu cầu số 1)

### Trước
Trang chủ hiện ảnh thành một dải nhỏ cao 92px, cuộn ngang — ảnh bé, khó nhìn.

### Giờ
Ảnh hiện **to hẳn** trong một khung riêng, chiều cao tự tính theo **bề ngang
màn hình** và **loại thiết bị** (class `ui-phone` / `ui-tablet` do
`lib/mobile-ui.js` gắn vào `<html>`):

| Thiết bị | Chiều cao khung ảnh |
|---|---|
| Laptop / máy tính | `clamp(280px, 34vw, 440px)` |
| Máy tính bảng | `clamp(250px, 44vw, 420px)` |
| Điện thoại | `clamp(200px, 60vw, 330px)` |
| Điện thoại nằm ngang (màn thấp) | `min(62vh, 300px)` |

Có cả bản dự phòng bằng `@media (max-width: ...)` để nếu `mobile-ui.js` chưa kịp
chạy thì kích thước vẫn đúng.

**Nhiều ảnh:**
- Tự lướt sang ảnh kế sau mỗi **4,5 giây**. Dừng lại khi rê chuột vào khung,
  khi đang vuốt, hoặc khi tab bị ẩn (đỡ tốn pin).
- Nút mũi tên **‹ ›** hai bên: tròn 42px (38px trên điện thoại), có viền trắng
  mảnh, nền kính mờ, nhấn vào hơi phóng to.
- Hàng chấm tròn phía dưới chỉ đang xem ảnh thứ mấy; chấm đang chọn kéo dài ra.
- Góc trên bên phải có số thứ tự kiểu `2/5`.
- Vuốt ngang trên điện thoại/tablet để chuyển ảnh.

**Một ảnh:** ẩn hết nút mũi tên, chấm tròn, số thứ tự — chỉ còn ảnh to.

**Bấm vào ảnh:** phóng to toàn màn hình, dùng phím ←/→ để lướt, Esc để đóng.

**Ảnh dọc và ảnh ngang đều vừa khung, không bị cắt:** ảnh nằm giữa theo kiểu
`object-fit: contain`, phần trống hai bên lấp bằng chính ảnh đó làm mờ đi.

**Ghi chú từng ảnh** (ô "Ghi chú dưới ảnh này" bên trang quản lý) hiện ngay
dưới khung và đổi theo ảnh đang xem.

### Đường lui
Nếu vì lý do gì `lib/notice-gallery.js` không tải được, `renderNoticeCard()` tự
quay về dải ảnh nhỏ như cũ — thông báo không bao giờ bị mất ảnh.

### Bên trang quản lý
Không đổi cách đăng, chỉ sửa lại dòng ghi chú dưới nút "📷 Đính kèm ảnh" để mô
tả đúng cách ảnh sẽ hiện bên trang chính.

---

## 3. Sửa lỗi "1 tài khoản đăng nhập được 2 nơi" (mục số 2)

### Nguyên nhân
Khoá phiên nằm ở bảng `active_sessions` (`identity_code`, `session_token`,
`last_seen`). Một nơi khác chỉ bị chặn nếu bản ghi còn "mới" — tức `last_seen`
trong vòng 40 giây (`SESSION_LOCK_TIMEOUT_MS`).

`library.html` làm đúng: cứ 20 giây gia hạn `last_seen` một lần.

Nhưng `index.html` và `logbook.html` **chỉ chiếm khoá lúc đăng nhập rồi thôi**,
không gia hạn. Nên chỉ cần ngồi ở trang chủ quá 40 giây là bản ghi bị coi là cũ,
và máy thứ hai đăng nhập cùng tài khoản được ngay → thành ra 1 tài khoản dùng ở
2 nơi.

### Đã sửa
Thêm vào cả `index.html` và `logbook.html` đúng cơ chế của `library.html`:

- `startSessionLockHeartbeat()` — cứ **20 giây** gia hạn `last_seen` cho đúng
  `session_token` của mình. Bật ở **cả hai lối vào**: vừa đăng nhập xong, và khi
  mở lại trang bằng phiên có sẵn.
- `renewSessionLock()` — nếu lệnh gia hạn không khớp dòng nào nghĩa là nơi khác
  đã chiếm khoá → gọi `forceKickBySession()`.
- `forceKickBySession()` — tắt hẹn giờ, xoá `online_users`, xoá sessionStorage,
  đưa về cổng đăng nhập kèm câu "⚠️ Tài khoản của bạn vừa được đăng nhập ở nơi
  khác nên phiên này đã kết thúc".
- `stopSessionLockHeartbeat()` — gọi khi bấm "Đăng xuất".
- Riêng `logbook.html` trước đây mở lại trang là vào thẳng, **không kiểm tra
  khoá phiên**. Giờ có kiểm tra như hai trang kia.

**Lỗi mạng tạm thời không làm đăng xuất:** nếu lệnh gia hạn lỗi (mất mạng,
Supabase chậm) thì bỏ qua và thử lại ở nhịp 20 giây sau, chứ không đá người dùng
ra — tránh khoá cứng oan.

---

## 4. UI đăng nhập làm lại (mục số 3)

Bỏ hẳn hình vẽ SVG cũ (mấy cái cây tam giác — khối `.gate-trees`). HTML vẫn giữ
nguyên, chỉ bị CSS ẩn đi, nên nếu không thích bản mới thì gỡ 1 dòng
`<link ... auth-ui.css>` là quay về y như cũ.

Thiết kế mới, **dùng chung cho cả 4 trang** nên nhìn đồng bộ:

- **Nền:** gradient xanh đêm + 3 vệt sáng "aurora" (xanh dương / tím / ngọc) thở
  rất chậm, thuần CSS. Thêm lớp lưới chấm mờ cho có chiều sâu.
- **Khung đăng nhập:** kính mờ (`backdrop-filter`), bo 28px, viền sáng mảnh,
  bóng đổ sâu, có một vệt sáng chạy ngang mép trên. Trượt lên nhẹ khi hiện ra.
- **Logo:** bọc trong ô bo tròn nền trắng, bỏ hiệu ứng nhún nhảy cũ.
- **Ô nhập:** nền mờ, bo 14px, icon nằm bên phải; khi bấm vào thì viền sáng lên
  kèm quầng xanh.
- **Nút đăng nhập:** gradient xanh → tím, nhấc lên khi rê chuột.
- **Báo lỗi:** ô đỏ hồng bo tròn, chữ sáng, dễ đọc trên nền tối.
- **Trang quản lý:** hai tab "🔒 Mật khẩu / 📷 Quét QR" cũng đổi theo tông này,
  tab đang chọn có nền gradient.
- **Hộp đăng nhập admin bên thư viện** (mật khẩu + mã OTP 6 số) cũng dùng chung
  kiểu kính mờ, lớp phủ phía sau tối và mờ hơn.

Trên điện thoại/tablet: tắt hiệu ứng aurora, bỏ kính mờ (đổi sang nền đặc) cho
nhẹ máy — đúng tinh thần bản UI mobile đã làm trước đó.

---

## 5. Đã kiểm tra những gì

Máy dựng bản cập nhật này **không tải được Chromium** (bị chặn tải trình duyệt),
nên khác lần trước, mình **không chụp/đo được bố cục thật ở 3 kích thước màn
hình**. Thay vào đó đã kiểm tra bằng jsdom + trình phân tích CSS:

| Việc kiểm tra | Kết quả |
|---|---|
| Cú pháp 12 khối `<script>` nội tuyến của 4 trang (`node --check`) | 0 lỗi |
| Cú pháp `auth-ui.css` (55 rule), `notice-gallery.css` (35 rule) bằng css-tree | 0 lỗi |
| Khung ảnh: dựng DOM, bấm ‹ ›, bấm chấm, quay vòng, ghi chú đổi theo ảnh, mở/đóng xem toàn màn hình, 1 ảnh thì ẩn nút, bỏ qua dữ liệu hỏng, gọi `init()` nhiều lần không nhân đôi | 27/27 đạt |
| Chống chèn mã: ghi chú và đường dẫn ảnh độc hại được escape, không tạo ra thẻ mới | đạt |
| Vẽ thật thẻ thông báo bằng đúng `renderNoticeCard()` của `index.html`: 3 ảnh / dữ liệu cũ `image_url` / không ảnh / có tài liệu đính kèm / thiếu lib thì quay về kiểu cũ | 17/17 đạt |
| Khoá phiên: dựng Supabase giả — tái hiện đúng lỗi cũ (quá 40s là máy B vào được), rồi chứng minh có heartbeat thì máy B luôn bị chặn; máy bị đăng nhập đè thì tự về cổng; mất mạng tạm thời **không** làm đăng xuất | 12/12 đạt |
| Cấu trúc 4 trang: còn đủ ID/nút/`onclick` của phần đăng nhập, file mới được nạp, `auth-ui.css` nằm sau CSS gốc | 60/60 đạt |
| Lớp phủ đăng nhập vẫn `position: fixed`, `inset: 0`, z-index đủ cao sau khi bị ghi đè (xem mục 5b) | 14/14 đạt |

Có một điểm suýt hỏng đã bắt được và sửa: `lib/mobile-ui.css` ép **mọi** `button`
cao tối thiểu 44px, mà chấm tròn của khung ảnh cũng là `button` — sẽ bị kéo cao
44px làm vỡ hàng chấm. Đã thêm ngoại lệ cho các nút của khung ảnh, đồng thời mở
rộng vùng chạm vô hình quanh chấm để ngón tay vẫn bấm trúng.

---

## 5b. LỖI ĐÃ PHÁT HIỆN VÀ SỬA (bản vá sau khi bạn báo)

**Triệu chứng:** vừa mở trang chủ đã thấy khung đăng nhập chỉ nằm ở nửa trên,
kéo xuống là vào thẳng nội dung web dù chưa đăng nhập.

**Nguyên nhân:** trong `lib/auth-ui.css`, khối đổi nền màn đăng nhập gom chung
3 selector `.gate-overlay`, `.name-gate-overlay`, `.login-screen` và đặt
`position: relative`. Hai cái đầu vốn là `position: fixed` phủ kín màn hình,
bị đổi thành `relative` nên tụt xuống theo dòng chảy trang, chỉ cao bằng nội
dung của nó -> phần web bên dưới lộ ra và bấm vào được. Cái thứ ba
(`.login-screen` của trang quản lý) mới là cái cần `relative`.

**Đã sửa:** bỏ `position` khỏi khối gom chung; ép riêng
`.gate-overlay, .name-gate-overlay { position: fixed !important; inset: 0 !important; z-index: 2000 }`
và để `.login-screen { position: relative }` riêng.

**Đã thêm bài test `overlay.test.js`** để lỗi này không lặp lại: tự dựng lại
cascade từ CSS gốc của trang + `auth-ui.css` rồi tính ra giá trị cuối cùng của
`position` / `inset` / `z-index` cho từng lớp phủ. Đã chạy thử với bản CSS lỗi
cũ để chắc chắn bài test bắt được (3 FAIL), và chạy với bản đã sửa thì đạt hết.

---

## 6. Nên thử lại trên máy thật sau khi deploy

1. Đăng một thông báo có 3–4 ảnh (ảnh ngang + ảnh dọc lẫn lộn) → xem trang chủ
   trên laptop, tablet và điện thoại: ảnh có đủ to không, có tự lướt không, nút
   ‹ › và chấm tròn có bị lệch không.
2. Bấm vào ảnh xem toàn màn hình, thử phím ←/→ và Esc.
3. Vuốt ngang trên điện thoại.
4. **Thử lỗi đăng nhập 2 nơi:** đăng nhập cùng 1 tài khoản ở máy A (để yên ở
   trang chủ hơn 1 phút), rồi thử đăng nhập ở máy B → máy B phải bị chặn. Sau đó
   đóng hẳn tab máy A, đợi ~1 phút rồi đăng nhập máy B → phải vào được.
5. Thử tương tự với `logbook.html`.
6. Xem lại màn đăng nhập của cả 4 trang trên nền tối/sáng và trên điện thoại.
7. **Quan trọng:** mở từng trang khi CHƯA đăng nhập và thử cuộn xuống — khung
   đăng nhập phải phủ kín màn hình, không nhìn/bấm được gì phía sau (đây chính
   là lỗi ở mục 5b).
