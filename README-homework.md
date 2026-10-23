# Web "Bài tập về nhà" (homework) — hướng dẫn gắn vào dự án

Copy TẤT CẢ file trong thư mục này vào thư mục gốc dự án (cạnh index.html, manage.html, library.html, logbook.html), ghi đè `index.html` và `manage.html`.

| File | Việc |
|---|---|
| `homework.html` | Trang xem bài tập. Đăng nhập Tên + Mã định danh (cùng khung/logic với index/logbook), sáng/tối, dùng được trên điện thoại |
| `hw-auth.js` | Đăng nhập dùng chung (khoá 1 phiên, ghi nhớ thiết bị, lịch sử đăng nhập, online) |
| `hw-icons.js` | Bộ icon SVG nét vẽ |
| `hw-subjects.js` | 17 môn học + màu pastel (sửa màu/thêm môn ở đây) |
| `hw-render.js` | Dựng thẻ bài tập — dùng chung để xem trước ở manage khớp trang thật |
| `gate-logo.png`, `favicon-16.png`, `favicon-32.png` | Logo cuốn sách xanh cho khung đăng nhập + tab trình duyệt |
| `setup-homework.sql` | Chạy 1 lần trong Supabase SQL Editor (tạo bảng homework_posts) |
| `manage.html` | Thêm mục "📚 Bài tập về nhà" + sửa highlight + dạng file đính kèm |
| `index.html` | Thêm khối "Bài tập về nhà" ở trang chủ + hiện dạng file đính kèm |

## Các bước
1. Chạy `setup-homework.sql` trong Supabase.
2. Copy các file vào dự án, deploy lại Vercel.
3. Vào manage.html → 📚 Bài tập về nhà để soạn và đăng.
