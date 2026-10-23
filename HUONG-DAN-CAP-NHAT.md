# Bản vá 16/09/2026 — Thông báo chung hiện ra HTML thô + Ghi nhớ đăng nhập

## Cách cài (2 phút)

1. Giải nén file `web-cap-nhat.zip`.
2. Chép đè vào thư mục dự án, giữ nguyên cấu trúc:

```
index.html      → thay file cũ ở thư mục gốc
library.html    → thay file cũ ở thư mục gốc
manage.html     → thay file cũ ở thư mục gốc
logbook.html    → thay file cũ ở thư mục gốc
lib/gb-safe.js  → thay file cũ trong thư mục lib/
```

3. Deploy lại (Vercel).
4. **Bấm Ctrl + F5** (hoặc Ctrl + Shift + R) ở trang chủ để trình duyệt bỏ
   bản cũ trong bộ nhớ đệm.

Trong gói **chỉ có 5 file đã sửa**. Các file khác (`lib/mobile-ui.*`,
`lib/auth-ui.css`, `lib/notice-gallery.*`, `lib/qrcode.min.js`, `lib/jsQR.js`,
`api/*`, `math.html`, `tts-tool.html`...) giữ nguyên, **không xoá, không thay**.

Không đụng tới Supabase URL / anon key / token — đúng như bạn dặn.

---

## 1. Vì sao thông báo hiện ra nguyên chuỗi `<h3 style="...">`, `<b>`, `&nbsp;`

Trang chủ nạp bộ lọc HTML từ `lib/gb-safe.js`. Trong `index.html` có sẵn một
khối "dự phòng" chạy khi file đó **không tải được**:

```js
if (typeof window.GBSafe === 'undefined') {
  ...
  sanitizeHtml: function(h){ return _esc(h); }   // ← escape sạch mọi thứ
}
```

Bản dự phòng đó chọn hướng "thà mất định dạng còn hơn mất an toàn": nó **escape
toàn bộ nội dung**, biến `<b>` thành chữ `<b>`, `&nbsp;` thành chữ `&nbsp;`.
Đó chính xác là cái bạn nhìn thấy trong ảnh — kể cả dấu `&nbsp;` lộ ra cũng là
dấu hiệu đặc trưng của việc bị escape.

Nghĩa là: **`lib/gb-safe.js` trên bản đã deploy không tải được** (chưa upload,
sai đường dẫn, hoặc cache hỏng), nên trang chủ rơi xuống bản dự phòng, và mọi
thứ bạn tô đậm / tô nền / đổi màu / chèn icon đều bị biến thành chữ.

### Đã sửa thế nào

**a) Bản dự phòng giờ là bộ lọc thật, không còn escape.**
Khối dự phòng trong `index.html`, `library.html`, `manage.html` được viết lại
thành một bộ lọc DOMParser + danh sách trắng đầy đủ — giống hệt `gb-safe.js`.
Vẫn chặn `<script>`, `onerror`, `<iframe>`, `javascript:`… nhưng **giữ nguyên**
in đậm, nghiêng, gạch chân, phông chữ, cỡ chữ, màu chữ, màu nền (highlight),
căn lề, bảng, danh sách, emoji.

Từ giờ, dù thiếu file `lib/gb-safe.js` thì trang vẫn hiển thị đúng — lỗi này
không thể tái diễn.

**b) Chữa luôn các thông báo CŨ đã trót bị lưu ở dạng escape.**
Thêm `GBSafe.looksEscapedHtml()` / `unescapeIfEscaped()` / `renderRichHtml()`
và hàm `gbRichHtml()` dùng chung. Quy tắc:

- Nội dung bình thường → **trả về y nguyên**, không đụng gì (nên không có nguy
  cơ làm hỏng bài soạn đang hiển thị tốt).
- Nội dung phát hiện là "HTML đã bị escape" (có `&lt;b&gt;` nhưng **không có**
  một thẻ thật nào) → giải escape rồi **lọc lại** bằng danh sách trắng trước
  khi hiện.

Nhờ vậy các thông báo cũ trong ảnh sẽ hiện lại đúng định dạng mà bạn **không
phải soạn lại hay sửa tay trong Supabase**.

**c) Đã rà và vá tất cả các chỗ hiển thị nội dung có định dạng**, không chỉ
trang chủ:

| Trang | Chỗ đã vá |
|---|---|
| `index.html` | Nội dung thông báo chung (`message_html`) |
| `manage.html` | Khung soạn thảo khi bấm **Sửa** một thông báo cũ |
| `manage.html` | Khung **Xem trước** bài soạn |
| `manage.html` | Khung soạn thảo khi **Sửa / Nhân bản** bài (nội dung + đáp án chữ) |
| `library.html` | Nội dung bài soạn (`content_html`) |
| `library.html` | Đáp án dạng chữ (`answerTextHtml`) |
| `library.html` | Nội dung file Word đính kèm (`wordHtml`) |

Quan trọng nhất là chỗ ở `manage.html`: trước đây mở một thông báo đã bị escape
ra sửa rồi lưu lại sẽ **escape thêm một lớp nữa**, càng sửa càng hỏng.

**d) Mở rộng danh sách trắng trong `lib/gb-safe.js`.**
Bộ lọc cũ âm thầm cắt mất vài thứ mà thanh công cụ soạn thảo thật sự sinh ra:

- Thẻ: thêm `MARK`, `DEL`, `INS`, `SMALL`, `BIG`, `CENTER`, `DL/DT/DD`,
  `COLGROUP/COL`, `ABBR`, `FIGURE/FIGCAPTION`…
- Thuộc tính CSS: thêm `background` (viết tắt), `text-decoration-line`,
  `text-decoration-color`, `text-transform`, `letter-spacing`, `word-spacing`,
  `border-radius`, `border-top/right/bottom/left`, `max-width`, `opacity`,
  `list-style`…

Vẫn **không** cho qua `position`, `z-index`, `url(...)`, `expression(...)`,
`javascript:`, `@import`, `behavior:` — nên không hạ mức an toàn chút nào.

**e) Thêm luật CSS cơ bản cho `.notice-body`** (ảnh không tràn khung, bảng có
viền, tiêu đề/danh sách có khoảng cách hợp lý) vì giờ thông báo hiện HTML thật.

---

## 2. Ghi nhớ đăng nhập ("Remember me") — đúng là đang hỏng

### Nguyên nhân

Khoá ghi nhớ được ghép từ **địa chỉ IP công cộng** + vân tay trình duyệt:

```js
return kind + '_' + ip.replace(/[^a-zA-Z0-9]/g,'') + '_' + fp;
```

IP của nhà mạng Việt Nam đổi liên tục: khởi động lại modem, đổi Wi-Fi, chuyển
sang 4G/5G, ra quán… là IP khác → khoá khác → **không tìm thấy bản ghi nào** →
vẫn phải nhập lại Tên + Mã định danh dù đã tích ô ghi nhớ.

Thêm hai vấn đề nữa:
- Nếu `api.ipify.org` bị chặn/chậm, khoá thành `..._noip_...` (lệch tiếp).
- Màn hình đăng nhập phải **đợi request lấy IP xong** mới hiện được.

### Đã sửa

Sinh một **mã thiết bị ngẫu nhiên** lưu trong `localStorage` (`gb_device_id`).
`localStorage` sống qua việc tắt hẳn trình duyệt, đổi mạng, đổi IP → ghi nhớ
đăng nhập mới thật sự bền, lại **không cần chờ mạng**. IP vẫn được lưu kèm vào
bảng để bạn xem, nhưng không còn tham gia vào khoá.

**Tương thích ngược:** nếu chưa có bản ghi theo mã thiết bị, hệ thống thử tìm
theo khoá kiểu cũ (IP + vân tay) đúng một lần; tìm thấy thì tự chuyển sang khoá
mới, nên ai đang được ghi nhớ sẽ không bị văng ra.

**Đăng xuất / bỏ tích ô ghi nhớ:** xoá **cả** bản ghi khoá mới lẫn khoá cũ, để
không còn trường hợp "đã bỏ tích mà lần sau vẫn tự đăng nhập".

Áp dụng cho cả 4 trang: `index.html`, `library.html`, `manage.html`,
`logbook.html`.

Lưu ý: mỗi trình duyệt là một mã thiết bị riêng (Chrome và Safari trên cùng một
máy sẽ phải tích ghi nhớ riêng), và **chế độ ẩn danh sẽ không ghi nhớ được** —
đó là đúng bản chất, không phải lỗi.

---

## 3. Nên kiểm tra sau khi deploy

1. Mở trang chủ, **Ctrl + F5**. Các thông báo trong ảnh phải hiện lại đúng định
   dạng (đậm, màu, nền vàng, icon), không còn chuỗi `<h3 style=...>`.
2. Nhấn **F12 → Console**. Nếu thấy dòng
   `[GBSafe] lib/gb-safe.js không tải được — đang dùng bản dự phòng…`
   thì file `lib/gb-safe.js` chưa lên server. Mở thẳng
   `https://<tên-miền-của-bạn>/lib/gb-safe.js` — nếu ra **404** thì upload file
   trong gói này vào đúng thư mục `lib/`. Trang vẫn chạy đúng khi thiếu, nhưng
   nên có đủ file.
3. Vào **manage.html → 📢 Thông báo chung**, soạn thử một thông báo có in đậm,
   tô nền, đổi màu chữ, chèn icon → gửi → xem trang chủ.
4. Bấm **✏️ Sửa** một thông báo cũ: khung soạn thảo phải hiện chữ có định dạng,
   không hiện chuỗi thẻ. Lưu lại rồi xem trang chủ, định dạng phải còn nguyên.
5. Mở một bài soạn trong **library.html** có nội dung dán từ Word + đáp án dạng
   chữ + file Word đính kèm → định dạng phải giữ nguyên như trước.
6. **Ghi nhớ đăng nhập:** tích ô, đăng nhập, đóng hẳn trình duyệt, mở lại →
   phải vào thẳng. Thử đổi từ Wi-Fi sang 4G rồi mở lại → vẫn phải vào thẳng
   (đây chính là trường hợp trước kia hỏng).
7. Bấm **Đăng xuất** → mở lại → phải bắt nhập lại từ đầu.

---

## 4. Việc cũ vẫn còn treo (không nằm trong bản vá này)

Token Upstash Redis và mật khẩu quản trị từng nằm trong mã chạy ở trình duyệt.
Bạn có sẵn `api/redis.js`, `api/manager-login.js` và `lib/redis-bitmap.js` bản
mới để chuyển sang biến môi trường của Vercel. Bạn nói sẽ tự xử lý phần key nên
bản vá này không đụng tới.
