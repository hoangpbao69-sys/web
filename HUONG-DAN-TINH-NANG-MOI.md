# Tính năng mới: "Đã xem / Đã hoàn thành" cho Thông báo chung

## Vì sao chọn tính năng này

Các trang của bạn đã có 30 bảng Supabase và gần như đủ mọi thứ: bài soạn, file
đính kèm, bình luận, đánh giá, chat riêng, cảnh cáo, kiểm duyệt, thùng rác,
lịch sử đăng nhập, mã định danh, QR, sổ theo dõi…

Chỗ còn trống rõ nhất là **vòng phản hồi của thông báo**. Nhìn ảnh bạn gửi thì
thông báo chung thực chất chính là **nhiệm vụ về nhà** ("NHIỆM VỤ VỀ NHÀ - VĂN 9",
"HẠN 19H30 HÔM NAY"). Nhưng đăng xong là hết: bảng `broadcast_notices` chỉ lưu
nội dung, không có một dòng nào ghi lại **em nào đã mở ra đọc**, **em nào đã
làm**. Bạn phải hỏi tay từng em hoặc chờ tới buổi học sau mới biết.

Đó là lý do tính năng này được thêm — nó dùng đúng dữ liệu đã có
(`broadcast_notices` + `user_identities`) và chỉ cần thêm **một bảng duy nhất**.

---

## Cách cài (3 bước, khoảng 3 phút)

**Bước 1 — Chạy SQL.**
Supabase → chọn project → **SQL Editor** → **New query** → dán toàn bộ nội dung
file `sql-notice-reads.sql` → **Run**.
(Chạy lại nhiều lần cũng không sao, và không đụng tới bảng nào đang có.)

**Bước 2 — Chép file.**
Giải nén, chép đè vào thư mục dự án:

```
index.html   → thay file cũ ở thư mục gốc
manage.html  → thay file cũ ở thư mục gốc
library.html → thay file cũ ở thư mục gốc   (bản vá HTML thô hôm nay)
logbook.html → thay file cũ ở thư mục gốc   (bản vá ghi nhớ đăng nhập)
lib/gb-safe.js → thay file cũ trong thư mục lib/
```

**Bước 3 — Deploy lại Vercel, rồi Ctrl + F5.**

> **Nếu bạn chưa chạy SQL:** web vẫn chạy bình thường y như cũ. Toàn bộ phần
> mới tự tắt (không hiện chip, không hiện nút, không báo lỗi). Chỉ khi bảng
> `notice_reads` tồn tại thì tính năng mới bật lên.

---

## Bên trang chủ (`index.html`) — học sinh thấy gì

**1. Chip trạng thái dưới mỗi thông báo**

| Chip | Nghĩa |
|---|---|
| 🔴 Chưa đọc | Em này chưa từng mở thông báo đó |
| 👁️ Đã xem | Đã nhìn thấy thông báo nhưng chưa báo làm xong |
| ✅ Đã hoàn thành | Đã bấm nút báo làm xong, kèm giờ/ngày |

**2. Tự ghi nhận "đã xem" — không cần bấm gì.**
Thẻ thông báo phải nằm **trong màn hình liên tục quá 1,2 giây** mới được tính.
Lướt vụt qua thì không tính — nếu không thì cuộn một phát là "đã đọc" hết, con
số bạn nhìn sẽ vô nghĩa. Dùng `IntersectionObserver` nên không tốn CPU như việc
nghe sự kiện cuộn trang.

**3. Nút "✅ Tôi đã làm xong".**
Học sinh tự báo đã hoàn thành nhiệm vụ. Bấm lại lần nữa để bỏ đánh dấu (lỡ tay
thì sửa được).

**4. Bộ đếm cạnh tiêu đề 📢 Thông báo** — ví dụ "🔴 3 chưa đọc", và một nút lọc
**🔴 Chưa đọc** trong hàng bộ lọc để xem riêng phần chưa đọc.

Mất mạng lúc ghi nhận thì hệ thống lặng lẽ bỏ qua và thử lại ở lần mở sau, chứ
không hiện lỗi làm học sinh hoang mang.

---

## Bên trang quản lý (`manage.html`) — bạn thấy gì

**1. Ngay trong danh sách "📢 Thông báo chung"**, mỗi thông báo có thêm dòng
phụ: `👁️ 12 đã xem · ✅ 7 đã làm xong`.
Số này lấy về bằng **đúng một request cho cả danh sách**, không làm chậm trang.

**2. Nút 👀 trên mỗi thông báo** → mở bảng chi tiết gồm:

- Ba con số tổng: **✅ Đã làm xong** / **👁️ Đã xem** / **🔴 Chưa đọc (x/tổng số)**
- **✅ Đã báo làm xong** — tên + giờ báo xong
- **👁️ Đã xem nhưng chưa báo làm xong** — tên + giờ xem
- **🔴 Chưa mở thông báo lần nào** — đây là nhóm bạn cần nhất

Nhóm thứ ba được tính bằng cách lấy **toàn bộ mã định danh đang hoạt động**
(bảng `user_identities`, `revoked = false`) trừ đi những em đã có dòng trong
`notice_reads`. Nếu bạn chưa dùng bảng mã định danh thì phần này báo rõ là
không tính được, hai nhóm trên vẫn hiện bình thường.

---

## Bảng dữ liệu mới

`notice_reads` — mỗi (thông báo × học sinh) đúng một dòng:

| Cột | Kiểu | Ý nghĩa |
|---|---|---|
| `id` | text (khoá chính) | `<mã thông báo>__<mã định danh>` |
| `notice_id` | text | id trong `broadcast_notices` |
| `identity_code` | text | mã định danh học sinh |
| `user_name` | text | tên hiển thị lúc ghi nhận |
| `read_at` | timestamptz | lần đầu nhìn thấy thông báo |
| `done_at` | timestamptz | giờ báo làm xong (NULL = chưa báo) |

Khoá chính là chuỗi ghép nên phía web dùng `upsert` được — bấm bao nhiêu lần
cũng không sinh dòng rác, và không cần cấu hình ràng buộc UNIQUE riêng.

Kèm theo một view tuỳ chọn `notice_read_stats` để bạn xem nhanh trong SQL
Editor. Cuối file SQL còn có sẵn các câu lệnh bảo trì (dọn dữ liệu cũ, xoá dữ
liệu của thông báo đã bị xoá hẳn, và câu lệnh gỡ hẳn tính năng nếu không thích).

---

## Nên thử sau khi deploy

1. Đăng một thông báo mới ở `manage.html`.
2. Mở trang chủ bằng một tài khoản học sinh → thấy chip **🔴 Chưa đọc**; để
   thông báo nằm trong màn hình khoảng 2 giây → chip đổi thành **👁️ Đã xem**,
   bộ đếm cạnh 📢 Thông báo giảm đi 1.
3. Bấm **✅ Tôi đã làm xong** → chip thành **✅ Đã hoàn thành** kèm giờ. Tải lại
   trang → vẫn giữ nguyên (dữ liệu nằm ở Supabase, không phải ở máy).
4. Về `manage.html` → mục 📢 Thông báo chung → thấy `👁️ 1 đã xem · ✅ 1 đã làm
   xong`; bấm nút 👀 → thấy tên em đó ở nhóm "Đã báo làm xong" và các em còn
   lại ở nhóm "Chưa mở thông báo lần nào".
5. Thử trên điện thoại: nút "Tôi đã làm xong" tự kéo rộng hết hàng cho dễ bấm.

---

## Vài ý tưởng tiếp theo (chưa làm, để bạn cân nhắc)

- **Đồng bộ "Nhắc nhở / Hạn nộp" của bài soạn lên Supabase.** Hiện hai thứ này
  nằm trong `localStorage` (`gb_post_reminders`, `gb_post_deadlines`) nên đổi
  máy hoặc xoá cache là mất sạch, và bạn cũng không xem được ai đặt nhắc nhở gì.
  Chuyển sang một bảng `post_reminders` là giải quyết được cả hai.
- **"⭐ Bài đã lưu" cho học sinh** — bảng `post_bookmarks`, có bộ lọc riêng ở
  thư viện.
- **Hạn nộp cho chính thông báo** — thêm cột `due_at` vào `broadcast_notices`,
  trang chủ đếm ngược, trang quản lý lọc "quá hạn mà chưa làm xong". Cái này
  ghép rất tự nhiên với bảng `notice_reads` vừa tạo.

Nếu bạn muốn làm tiếp cái nào thì nhắn mình.
