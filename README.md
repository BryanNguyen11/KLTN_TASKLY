## KLTN_TASKLY – Task, Project & Calendar for students

KLTN_TASKLY là ứng dụng quản lý học tập và cộng tác nhóm dành cho sinh viên, gồm:
- Tác vụ có lặp, nhiều ngày, nhắc nhở, tiến độ, checklist con
- Lịch (Calendar) có loại (type), lặp, nhắc nhở giống iOS Calendar
- Dự án với lời mời, chấp nhận/từ chối, phân quyền cơ bản
- Thông báo đẩy (Expo push) và mô phỏng local trong Expo Go (tránh trùng lặp)
- Realtime với Socket.IO, cập nhật tức thì theo dự án
- Scheduler trên server: tóm tắt hàng ngày và nhắc đúng thời điểm

## Monorepo

- backend/ — Node.js + Express + Mongoose + Socket.IO (API, push scheduler)
- frontend/ — Expo Router + React Native (ứng dụng di động/web)

## Tính năng chính

- Tác vụ
  - Lặp (ngày/tuần/tháng/năm), kéo dài nhiều ngày, giờ bắt đầu/kết thúc
  - Checklist con, phần trăm hoàn thành, mức độ quan trọng
  - Nhắc nhở theo phút trước sự kiện hoặc giờ cụ thể
- Lịch (Calendar)
  - Phân loại (Calendar Type), trường tùy biến theo loại (label + key)
  - Lặp, kéo dài nhiều ngày, nhắc nhở (giống iOS)
  - Giao diện tạo/sửa rõ ràng, hiển thị tóm tắt
- Dự án & mời thành viên
  - Gửi lời mời theo email, chấp nhận/từ chối, thu hồi
  - Thông báo chỉ gửi cho người mời (fallback owner), hạn chế spam
  - Quản lý thành viên, rời dự án
- Thông báo
  - Server là nguồn push duy nhất (Expo Push API); có cửa sổ “dedupe” tránh trùng
  - Trong Expo Go, mô phỏng local notification khi chưa có push token
- Realtime
  - Socket.IO, phòng theo dự án, gửi sự kiện: task created/updated, project updated
- Scheduler
  - Quét nhắc nhở theo phút (tasks & calendar) và gửi push “đúng giờ”
  - Tóm tắt hàng ngày (có thể tùy chỉnh)

## Công nghệ

- Backend: Node.js, Express 5, Mongoose 8, Socket.IO 4, JWT, dotenv
- Frontend: Expo SDK 54, expo-router 6, React Native 0.81, expo-notifications
- Hạ tầng: Expo Go/dev client, LAN

## Yêu cầu

- Node.js LTS (>= 18)
- MongoDB (local hoặc Atlas)
- Thiết bị/simulator trong cùng mạng LAN với backend khi chạy Expo Go

## Cấu trúc thư mục (rút gọn)

- backend/
  - server.js, controllers/, models/, routes/, middleware/
- frontend/
  - app/ (file-based routing)
    - create-task.tsx, create-calendar.tsx, create-calendar-type.tsx
    - (tabs)/dashboard.tsx, auth/, project-members/[id].tsx, …
  - contexts/ (Auth, Notifications)
  - utils/ (calendar.ts, dashboard.ts, …)
  - scripts/update-env-ip.js

## Backend – Cài đặt & chạy

1) Cài dependencies
```bash
cd backend
npm install
```

2) Tạo file .env (ví dụ):
```
MONGODB_URI=mongodb://localhost:27017/kltn_taskly
JWT_SECRET=change-me
PORT=5000
```

3) Chạy server
```bash
npm run dev
# hoặc:
npm start
```

4) Kiểm tra health
- GET http://localhost:5000/api/health → 200 OK

Ghi chú:
- Server có scheduler gửi nhắc nhở và tóm tắt; không cần bật riêng.
- Socket.IO bật sẵn (transport websocket), client sẽ join theo dự án.

## Frontend – Cài đặt & chạy

1) Cài dependencies
```bash
cd frontend
npm install
```

2) Cấu hình API base cho LAN
- Tùy chọn A (khuyến nghị): dùng script tự động cập nhật IP LAN cho Expo
  - macOS:
    ```bash
    npm run start:mac
    ```
    Script sẽ cập nhật endpoint theo IP máy và port backend (mặc định 5050/5000 theo cấu hình) rồi mở Expo.
  - Windows:
    ```bash
    npm run start:win
    ```
- Tùy chọn B (thủ công): đặt biến môi trường `EXPO_PUBLIC_API_BASE` (ví dụ: http://192.168.1.10:5000/api) thông qua app config/env theo hướng dẫn Expo. Ứng dụng dùng `process.env.EXPO_PUBLIC_API_BASE`.

3) Chạy ứng dụng
```bash
npx expo start
# mở bằng:
# - iOS Simulator
# - Android Emulator
# - Expo Go trên thiết bị thật (cùng LAN)
```

4) Thông báo đẩy
- Lần đầu, ứng dụng sẽ xin quyền thông báo.
- Trong Expo Go, app sẽ mô phỏng local notification nếu chưa đăng ký push token, tránh duplicate với push server.
- Khi build dev client/production và có push token, server sẽ gửi Expo push; client sẽ tắt mô phỏng local để không bị trùng.

## Luồng chính trong ứng dụng

- Dashboard
  - Tabs Hôm nay/Tuần/Tháng, hiển thị cả Tasks & Calendar occurrences
  - Nút nổi (FAB) để tạo Nhanh: Tác vụ, Lịch, Dự án
- Tạo Tác vụ (`/create-task`)
  - Ngày, giờ, lặp, nhiều ngày, nhắc nhở, checklist
- Tạo Lịch (`/create-calendar`)
  - Loại lịch (Calendar Type), thuộc tính theo loại, lặp, nhiều ngày, nhắc nhở
- Loại Lịch (`/create-calendar-type`)
  - Tạo các trường hiển thị (label/key), đặt mặc định
- Dự án & thành viên
  - Quản lý trong modal từ Dashboard và màn hình thành viên `/project-members/[id]`
  - Lời mời: chỉ hiển thị “pending”; có “X” để thu hồi; input mời có xử lý tránh bị bàn phím che

## Đặt tên & chuyển đổi

- “Event” đã được đổi sang “Calendar” ở frontend:
  - create-event.tsx → create-calendar.tsx
  - create-event-type.tsx → create-calendar-type.tsx
  - events.ts → calendar.ts
- Các route và import đã cập nhật tương ứng.

## Scripts hữu ích (frontend)

- `npm run start:mac` — cập nhật IP LAN + start Expo (macOS)
- `npm run start:win` — cập nhật IP LAN + start Expo (Windows)
- `npm run update:ip -- <PORT>` — chỉ chạy phần cập nhật IP (advanced)
- `npm run lint` — linting

## Troubleshooting

- Không nhận được dữ liệu trong Expo Go
  - Đảm bảo `EXPO_PUBLIC_API_BASE` trỏ đúng IP LAN của máy chạy backend và thiết bị ở chung mạng
  - Thử `npm run start:mac` hoặc `start:win` để tự set
- Thông báo đẩy bị trùng
  - App đã chặn mô phỏng local khi có push token; nếu đang dùng Expo Go, hãy chấp nhận quyền thông báo và/hoặc đăng ký token đúng cách
- Giờ/ngày lệch múi giờ
  - Ứng dụng chuẩn hóa ngày theo local device (YYYY-MM-DD), lưu ý khi test qua nhiều múi giờ

## Lộ trình (gợi ý)

- Nâng cấp phân quyền dự án (owner/admin/member chi tiết hơn)
- Nhắc nhở theo chuỗi (nhiều mốc cho cùng một mục)
- Bộ lọc/nhãn nâng cao, search
- Hỗ trợ offline-first

## License

MIT (tùy chỉnh theo yêu cầu của bạn)
