# Gắn Thư Viện Phim vào web Thư Viện Bài Soạn (đăng nhập bằng Mã định danh)

Copy tất cả file trong thư mục này vào thư mục gốc dự án (cạnh library.html, logbook.html), **ghi đè** `index.html` và `manage.html`.

| File | Ghi chú |
|---|---|
| `index.html` | Trang chủ gốc, thêm khối "Thư viện phim" cạnh "Sổ theo dõi" |
| `manage.html` | Thêm ô ✔️ **🎬 Cho phép truy cập trang admin/analytics phim** trong mục 🪪 Mã định danh (lúc tạo mới và lúc sửa) |
| `indexmovie.html` + `indexmovie.js` | Trang phim. Đăng nhập bằng **Tên + Mã định danh** — cùng khung, cùng logic với `index.html`/`manage.html` (ghi nhớ thiết bị, khoá phiên duy nhất, lịch sử đăng nhập, đang online) |
| `adminmovie.html` | Vận hành: link hỏng, SEO. Chỉ vào được nếu tài khoản có quyền 🎬 Admin phim |
| `analyticsmovie.html` | Dashboard lượt xem. Cũng cần quyền 🎬 Admin phim |
| `movie-auth.js` | Module đăng nhập dùng chung cho 3 trang trên |
| `movie-icons.js` | Bộ icon SVG nét vẽ (thay toàn bộ icon emoji cũ) dùng chung cho 3 trang trên |
| `movie-mobile-ui.js` + `movie-mobile-ui.css` | Nhận diện thiết bị thật (cảm ứng + kích thước) và bật giao diện rút gọn riêng cho mobile/tablet trên cả 3 trang. Laptop giữ nguyên 100% |
| `movie-gate-logo.png` | Logo hiện ở khung đăng nhập (không đổi) |
| `movie-favicon-32.png` / `-180.png` / `-256.png` | Icon tab trình duyệt (favicon) — logo cuốn sách xanh bạn gửi, đã tự tách sẵn 3 cỡ |
| `supabase.sql` | Chạy 1 lần trong SQL Editor. Thêm cột `can_access_movie_admin` vào bảng `user_identities` có sẵn, tạo các bảng/hàm riêng cho phim (tiền tố `movie_`), **thêm bảng `movie_hero_slides` cho poster đầu trang** |
| `supabase/functions/check-broken-links/index.ts` | Edge Function quét link hỏng (tuỳ chọn) |
| `vercel.json` | Nếu dự án ĐÃ có vercel.json: chỉ gộp 2 mục `rewrites` vào file cũ, đừng ghi đè |

## Cách hoạt động
- **Ai vào `indexmovie.html` cũng đăng nhập bằng Tên + Mã định danh**, y hệt cách vào `index.html`: cùng khung xanh đêm, cùng "Ghi nhớ đăng nhập", cùng cơ chế 1 mã chỉ đăng nhập được ở 1 nơi.
- **Toàn bộ dữ liệu (phim, tập, yêu thích, lịch sử, báo lỗi, poster) đi qua các hàm RPC** trong `supabase.sql` — hàm tự kiểm tra Tên + Mã định danh ở phía server, không lộ bảng cho client thao tác trực tiếp trừ danh mục phim công khai.
- **Quyền admin phim** = cột `can_access_movie_admin` trên chính dòng mã định danh đó. Bật ở `manage.html → 🪪 Mã định danh`. Không cần tài khoản/mật khẩu riêng nào khác.
- `adminmovie.html`, `analyticsmovie.html` và mục **Quản trị** trên trang phim đều yêu cầu quyền này.

## Poster đầu trang (mới)
- Trang phim (`indexmovie.html`) hiện một banner lớn ở trên cùng, tự trượt qua từng phim sau mỗi 5 giây, bấm vào poster hoặc nút "Xem ngay" mở thẳng phim đó. Có nút mũi tên và chấm tròn để lướt qua lướt lại bằng tay. Nếu chưa đăng poster nào thì banner này tự ẩn.
- Đăng poster ở `adminmovie.html → Poster`: gõ từ khoá tìm ngay trên nguonc (không cần phim đó có sẵn trong Catalog Supabase trước), bấm "Thêm". Đăng bao nhiêu phim cũng được, có nút ↑↓ đổi thứ tự, Ẩn/Hiện, Xoá.
- Ảnh nền mờ phía sau banner tự lấy từ poster phim (làm mờ + tối đi) nên không cần chuẩn bị ảnh riêng. Muốn ảnh nền sắc nét hơn, có thể set thêm `backdrop_url` thẳng trong bảng `movie_hero_slides` trên Supabase (chưa có ô nhập trong giao diện).

## Giao diện mobile/tablet (mới)
- `movie-mobile-ui.js` nhận diện thiết bị thật (cảm ứng, không có chuột, User-Agent, kể cả iPad tự nhận "Macintosh") — không chỉ dựa vào bề rộng cửa sổ, nên **laptop thu nhỏ cửa sổ trình duyệt vẫn không bị đổi giao diện nếu không phải màn cảm ứng và đủ rộng**; ngược lại tablet cảm ứng màn hình rộng (ví dụ iPad ngang) vẫn nhận đúng giao diện gọn.
- Trên mobile/tablet: menu luôn thu vào biểu tượng ☰, lưới phim cố định 2 cột (điện thoại) / 3 cột (tablet), bớt hiệu ứng chuyển động, form quản trị dồn về 1 cột, bảng cho cuộn ngang trong khung riêng, vùng bấm đủ lớn, ô nhập liệu không bị iOS tự phóng to trang.
- Trên laptop: không đổi gì, toàn bộ CSS này chỉ có tác dụng khi thiết bị thật sự là mobile/tablet.

## Các bước
1. Giải nén, copy đè vào dự án.
2. Supabase → SQL Editor → dán toàn bộ `supabase.sql` → Run (an toàn dù đã chạy bản cũ trước đó).
3. Mở `manage.html → 🪪 Mã định danh`, bật ô 🎬 cho tài khoản cần quản trị phim.
4. Đăng poster ở `adminmovie.html → Poster` (không bắt buộc, banner tự ẩn nếu chưa đăng).
5. Deploy lên Vercel. Nếu đã có `vercel.json`, chỉ gộp phần `rewrites`.
6. (Tuỳ chọn) Deploy Edge Function `check-broken-links` để nút "Quét" trong `adminmovie.html` hoạt động.
