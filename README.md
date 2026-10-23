# Website Quản lý điểm hạnh kiểm — bản đã bổ sung quản lý tổ

## Chạy trên máy tính
Yêu cầu Node.js 18 trở lên.

```bash
npm start
```

Mở `http://localhost:3000`.

## Các chức năng được bổ sung
- Quản lý lớp và tạo tổ theo lớp.
- Phân học sinh vào tổ.
- Xếp hạng tổ và xếp hạng học sinh.
- Ba cách tính điểm tổ: tổng điểm thành viên, điểm trung bình thành viên, hoặc điểm tổ riêng do Admin nhập.
- Trừ điểm nhiều học sinh trong cùng lớp cùng lúc.
- Xem lịch sử theo tuần, xóa lịch sử tuần; Admin có thể xóa toàn bộ lịch sử.
- Admin có thể bật/tắt ghi nhật ký hoạt động.
- Cấu hình điểm tối thiểu/tối đa trong phạm vi 0–10.
- Dữ liệu tổ/lớp/cấu hình được lưu chung với dữ liệu ứng dụng trên Firebase Realtime Database.

## Đưa lên GitHub Pages
Đưa toàn bộ các tệp trong thư mục này lên repository, bao gồm `teams-addon.js`. `index.html` đã được nối với tệp bổ sung. Firebase phải được cấu hình đúng và Database Rules phải cho phép ứng dụng đọc/ghi theo thiết lập của dự án.

## Đồng bộ điện thoại và máy tính
Cả hai thiết bị phải truy cập cùng website và cùng Firebase project/database. Không mở tệp HTML trực tiếp từ máy tính. Khi Firebase chưa kết nối, ứng dụng có thể chỉ lưu dữ liệu cục bộ trên thiết bị đó.

## Tài khoản mặc định
- Admin: `admin` / `admin123`

Hãy đổi mật khẩu Admin trước khi dùng thật. Không nên công khai database rules cho phép mọi người đọc/ghi khi website dùng trên Internet; cần cấu hình xác thực và phân quyền phù hợp.
