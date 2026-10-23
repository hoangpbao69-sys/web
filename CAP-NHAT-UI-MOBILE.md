# Cập nhật: UI thích ứng mobile/tablet + sửa giật lag bản laptop

## 1. Cần làm ngay (bảo mật)

`redis-bitmap.js` đang để lộ token Upstash Redis trong mã chạy ở trình duyệt:

```js
const REDIS_TOKEN = 'gQAAAAAA...';
```

Ai mở web cũng đọc được token này và có toàn quyền đọc/ghi/xoá dữ liệu Redis.

Việc cần làm:
1. Vào Upstash → thu hồi (revoke) token hiện tại.
2. Tạo token mới, **không** đặt vào file JS.
3. Chuyển các lệnh Redis sang một serverless function trên Vercel (giống
   `/api/qrcode` bạn đã có), để token trong Environment Variables của Vercel.

Bản cập nhật này chưa đụng tới phần đó vì nó đổi kiến trúc — nhưng nó quan
trọng hơn chuyện giật lag.

---

## 2. File mới

```
lib/mobile-ui.css     ← giao diện rút gọn cho mobile/tablet + spinner dùng chung
lib/mobile-ui.js      ← phát hiện thiết bị + tái cấu trúc DOM + spinner tự động
```

Mỗi trang được chèn đúng 2 dòng ngay sau `</title>`:

```html
<link rel="stylesheet" href="lib/mobile-ui.css">
<script src="lib/mobile-ui.js"></script>
```

Script đặt trong `<head>` và chạy **đồng bộ** (không `defer`) để class
`ui-mobile` kịp gắn vào `<html>` trước khung hình đầu tiên, tránh nháy giao diện.

### Laptop có bị đổi gì không?

Không. Toàn bộ CSS mới nằm sau bộ chọn `html.ui-mobile`. Trên laptop class đó
không được gắn, nên không một dòng nào có tác dụng. Phần JS trên laptop chỉ
bật sẵn API spinner, không sửa DOM.

### Cách phát hiện thiết bị

Kết hợp 4 tín hiệu: `pointer: coarse`, `hover: none`, số điểm chạm, và chiều
rộng ≤ 1024px. Có xử lý riêng cho iPadOS 13 trở lên (nó tự khai báo là
"Macintosh" nên nếu chỉ đọc User-Agent sẽ nhận nhầm thành máy tính).

Xoay ngang/dọc hoặc đổi kích thước cửa sổ sẽ tự tính lại.

---

## 3. Bản UI mobile/tablet làm gì

| Việc | Cách làm |
|---|---|
| Tắt hiệu ứng | Rút thời lượng animation/transition về ~0 và ép `animation-iteration-count:1` |
| Tắt kính mờ | `backdrop-filter: none`, giảm đổ bóng còn 1 lớp mỏng |
| Tắt Liquid Glass | Chặn `RealLiquidGlass.enable()` ngay từ đầu |
| Bảng | Tự bọc mỗi `<table>` vào khung cuộn ngang |
| Lưới nhiều cột | Ép về 1 cột, **chỉ khi** lưới có 2–4 cột và mỗi cột hẹp hơn 150px |
| Ô nhập liệu | `font-size: 16px` để iOS không tự phóng to trang khi gõ |
| Nút bấm | Tối thiểu 44px chiều cao |
| Thanh nav | Ẩn chữ trong logo (giữ biểu tượng) — trước đây chữ xuống 3 dòng, đè nội dung |
| Hộp thoại | Tràn gần hết bề ngang, cuộn được, tối đa 88% chiều cao màn hình |

### Vì sao không dùng `animation: none`?

Nhiều hộp thoại trong web dùng animation để đưa `opacity` từ 0 lên 1. Cắt hẳn
animation sẽ làm chúng **mất hiển thị hoàn toàn**. Cách rút thời lượng giữ
đúng trạng thái cuối mà vẫn bỏ được chuyển động.

### Vì sao không ép mọi lưới về 1 cột?

`manage.html` và `library.html` có lưới lịch 7–8 cột. Ép về 1 cột sẽ hỏng bố
cục. Điều kiện "2–4 cột và mỗi cột < 150px" loại trừ chúng.

---

## 4. Spinner / Circular progress

Dùng lại đúng tông màu spinner sẵn có của site (`#ec1561`), nên nhìn đồng bộ
với màn "Đang tải..." lúc mở web.

**Tự động, không cần sửa tay từng `onclick`:** `mobile-ui.js` đếm số request
đang chạy bằng cách bao `window.fetch` và `XMLHttpRequest.prototype.send`.
Khi bạn bấm một nút mà trong 150ms sau đó có request bắt đầu, nút đó tự khoá
lại và hiện spinner cho tới khi request xong. Supabase, Upstash, pdf.js đều
đi qua 2 đường này nên gần như mọi thao tác chờ đều được phủ.

Ngoài ra có vòng tiến trình tròn ở góc màn hình, chỉ hiện sau 220ms để các
request nhanh không gây nhấp nháy.

**Gọi thủ công khi cần:**

```js
const xong = UISpin.button(btn);      // khoá nút + spinner, gọi xong() để nhả
UISpin.wrap(btn, () => luuDuLieu());  // tự bật/tắt quanh 1 hàm async
const xong = UISpin.block(el, 'Đang tải…');  // phủ spinner lên 1 vùng
```

Có chốt chặn: nút không bao giờ bị khoá quá 20 giây dù mạng có sự cố.

---

## 5. Sửa giật lag bản laptop

Nguyên nhân **không phải** hiệu ứng CSS, mà là lượng dữ liệu tải về.

### manage.html

`refreshPosts()` cũ dùng `select('*')` — kéo về toàn bộ cột của mọi bài soạn,
gồm `content_html` (bài dán từ Word, rất dài) và `answer_file_data` (file đáp
án lưu base64, có thể vài MB mỗi bài). Hàm này được gọi lại mỗi lần đăng bài,
ghim bài, mở mục Tiện ích bổ trợ và Bảng nhiệm vụ.

Đã sửa:
- Danh sách chỉ lấy 17 cột nhẹ.
- Nội dung nặng tải riêng đúng 1 bài qua `ensurePostFull()`, đúng lúc bạn xem
  trước / sửa / nhân bản.
- Nội dung đã tải được giữ lại trong cache, mở lại bài vừa xem không tải lại.
- Gộp các lệnh `refreshPosts()` trùng nhau chạy cùng lúc.
- `goSection('utils')` trước đây chạy liền 9 hàm dựng giao diện trong cùng một
  nhịp nên trình duyệt không kịp vẽ. Giờ mỗi hàm chạy ở một khung hình riêng
  (`runChunked`), có spinner phủ lên khu vực đang dựng, và dừng giữa chừng nếu
  bạn chuyển sang mục khác.

### library.html

Nặng nhất: `showDetail()` gọi `fetchPosts()` — tải lại cả kho bài **cộng toàn
bộ bảng `post_files`** (file đính kèm + ảnh từng trang PDF) chỉ để mở một bài.

Đã sửa:
- Danh sách chỉ lấy cột nhẹ; `post_files` chỉ lấy tên/loại file, không lấy
  `file_data`, `word_html`, `pdf_page_images`.
- `showDetail()` dùng cache rồi gọi `ensurePostFull(id)` để tải đầy đủ đúng
  bài đang mở.
- Cache ngắn 8 giây + gộp request trùng.
- `invalidatePostsCache()` được gọi trong `insertPost`, `insertPostFiles`,
  `removePost`, `updatePost` nên dữ liệu sau khi ghi luôn được làm mới.

### Đường lui

Nếu bảng `posts` hoặc `post_files` trên Supabase thiếu cột nào đó, mã tự động
quay về `select('*')` như cũ — chậm hơn nhưng chắc chắn chạy được.

---

## 6. Đã kiểm tra hiển thị

Chạy thật 6 trang trong Chromium ở 3 kích thước: 1440×900 (laptop),
820×1180 (tablet, có cảm ứng), 390×844 (điện thoại).

- Nhận diện thiết bị đúng ở cả 3 mức.
- Không trang nào tràn ngang (`scrollWidth` = `clientWidth` ở mọi kích thước).
- Không phát sinh lỗi JavaScript mới. Hai lỗi xuất hiện trong lúc kiểm tra
  (`createClient`, `SUBJECTS is not defined`) là do môi trường kiểm tra chặn
  CDN Supabase — bản gốc chưa sửa cũng báo đúng hai lỗi đó.
- Đã kiểm tra chức năng spinner: nút khoá + hiện spinner trong lúc chờ, nhả
  sạch sau khi xong; bảng được bọc khung cuộn; lưới 3 cột hẹp gộp về 1 cột;
  lưới lịch 7 cột giữ nguyên.

## 7. Nên kiểm tra thêm khi deploy

Môi trường kiểm tra không có mạng nên không đăng nhập được. Sau khi deploy,
nên thử trên máy thật:

1. Đăng một bài soạn mới → xem tốc độ và spinner trên nút.
2. Ghim/bỏ ghim bài → danh sách cập nhật ngay.
3. Mở mục Tiện ích bổ trợ → nội dung hiện dần, không đứng hình.
4. Mở một bài có file PDF/Word đính kèm ở library → file vẫn hiện đúng
   (đây là chỗ dùng `ensurePostFull`, cần xác nhận kỹ nhất).
5. Sửa một bài đã có nội dung định dạng từ Word → nội dung phải nạp đủ.
