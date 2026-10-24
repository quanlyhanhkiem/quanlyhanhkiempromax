HƯỚNG DẪN ĐƯA WEBSITE LÊN MẠNG VÀ ĐỒNG BỘ ĐIỆN THOẠI - MÁY TÍNH

1. Giải nén ZIP. Mở thư mục hanhkiem_revised.
2. Tạo repository trên https://github.com/ (ví dụ: quan-ly-hanh-kiem).
3. Upload TOÀN BỘ các file bên trong hanhkiem_revised vào thư mục gốc của repository. Phải có index.html, app.js, teams-addon.js, styles.css và firebase-config.js cùng cấp.
4. Trên GitHub mở Settings -> Pages. Ở Build and deployment, chọn Deploy from a branch, Branch main, Folder /(root), nhấn Save.
5. Đợi GitHub Pages triển khai và mở URL hiện ra trong Settings -> Pages trên cả máy tính và điện thoại.
6. Đăng nhập tài khoản mặc định admin / admin123 và đổi mật khẩu ngay trong phần cài đặt nếu có.

FIREBASE
- Website đã được nối với Firebase Realtime Database của project quanlyhanhkiem.
- Khi database còn trống, website sẽ thử khởi tạo dữ liệu mặc định (hoặc dữ liệu cục bộ hiện có) lên Firebase.
- Nếu hiện lỗi Permission denied hoặc không thể đồng bộ, cần sửa Rules/Authentication trong Firebase Console. Không đặt Rules cho phép mọi người đọc/ghi lâu dài vì dữ liệu học sinh có thể bị xem hoặc sửa bởi người lạ.
- Để kiểm tra: mở cùng URL trên hai thiết bị, sửa một thông tin thử và kiểm tra thiết bị kia có cập nhật không.

LƯU Ý
- Tôi không thể tự xuất bản vào tài khoản GitHub/Firebase của bạn nếu chưa có quyền truy cập; ZIP này đã chuẩn bị để bạn tải lên.
- Trước khi dùng dữ liệu học sinh thật, hãy cấu hình bảo mật Firebase phù hợp và đổi mật khẩu mặc định.
