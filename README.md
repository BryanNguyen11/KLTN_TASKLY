Đã rõ — mình soạn một README dạng Markdown “đẹp, dễ đọc” để bạn dán thẳng lên GitHub.

---

# KLTN_TASKLY — Task, Project & Calendar cho sinh viên

[![Node.js >= 18](https://img.shields.io/badge/Node.js-%3E%3D18-green.svg)](https://nodejs.org/)
[![Expo SDK 54](https://img.shields.io/badge/Expo-SDK%2054-000000.svg?logo=expo&logoColor=white)](https://docs.expo.dev/)
[![React Native](https://img.shields.io/badge/React%20Native-mobile-blue.svg)](https://reactnative.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](#license)

Ứng dụng quản lý học tập và cộng tác nhóm:
- Tác vụ: lặp/ngày, nhiều ngày, giờ bắt đầu/kết thúc, mức độ quan trọng, checklist con, tiến độ.
- Lịch (Calendar): loại lịch (type) và trường tùy biến, lặp, nhiều ngày, nhắc nhở như iOS Calendar.
- Dự án: mời thành viên qua email, chấp nhận/từ chối, phân quyền cơ bản.
- Thông báo: Expo push (build/dev client) và mô phỏng local (Expo Go).
- Realtime: Socket.IO theo dự án.
- AI: gợi ý sắp xếp ưu tiên, hỏi đáp thời gian tự nhiên (VI/EN).

---

## Mục lục

- Tính năng nổi bật
- Kiến trúc & Công nghệ
- Cấu trúc thư mục
- Bắt đầu nhanh
- Cấu hình & Biến môi trường
- Giám sát dự án (Project Insights)
- Thông báo & Realtime
- Scripts hữu ích
- Troubleshooting
- Lộ trình
- Đóng góp
- License

---

## Tính năng nổi bật

- Tổng quan dự án (KPI tương tác)
  - Chưa hoàn thành • Hoàn thành • Quá hạn
  - Sắp tới hạn (3 ngày) • Sắp tới hạn (7 ngày)
  - Bấm KPI → Popup danh sách giữa màn hình (Modal “stick”), hỗ trợ:
    - Mở chỉnh sửa
    - Xóa nhanh qua icon thùng rác
- Biểu đồ theo dõi:
  - Donut: % hoàn thành
  - Burndown: số tác vụ còn lại theo ngày
  - Tiến độ tích lũy (Flow)
  - Hạn theo tuần (thay Gantt): biểu đồ cột số tác vụ đến hạn từng tuần — dễ đọc trên màn hình nhỏ
- Giao diện thân thiện iOS: thẻ bo tròn, bóng đổ nhẹ, target chạm lớn, responsive
- AI:
  - Gợi ý sắp xếp danh sách tác vụ theo ưu tiên
  - Hỏi đáp thời gian tự nhiên (VD: “trong 7 ngày tới”, “cuối tuần này”, khoảng ngày)

---

## Kiến trúc & Công nghệ

- Monorepo
  - `backend/` — Node.js + Express 5 + Mongoose 8 + Socket.IO 4 (API, scheduler push)
  - `frontend/` — Expo Router + React Native (ứng dụng di động/web)
- Yêu cầu
  - Node.js LTS (>= 18), MongoDB (local/Atlas), thiết bị/simulator cùng LAN khi dùng Expo Go

---

## Cấu trúc thư mục

```
KLTN_TASKLY/
├─ backend/
│  ├─ server.js
│  ├─ controllers/  models/  routes/  middleware/
│  └─ package.json
├─ frontend/
│  ├─ app/                # file-based routing (expo-router)
│  │  ├─ (tabs)/dashboard.tsx
│  │  ├─ create-task.tsx
│  │  ├─ create-calendar.tsx
│  │  └─ create-calendar-type.tsx
│  ├─ components/ProjectInsights.tsx
│  ├─ contexts/           # Auth, Notifications
│  ├─ utils/              # calendar.ts, dashboard.ts, ...
│  ├─ scripts/update-env-ip.js
│  └─ package.json
└─ README.md
```

---

## Bắt đầu nhanh

### 1) Backend

```bash
cd backend
npm install
```

Tạo `.env`:

```
MONGODB_URI=mongodb://localhost:27017/kltn_taskly
JWT_SECRET=change-me
PORT=5000
```

Chạy server:

```bash
npm run dev
# hoặc:
npm start
```

Health check: GET http://localhost:5000/api/health → 200 OK

### 2) Frontend

```bash
cd frontend
npm install
```

Cấu hình API base theo IP LAN:

- Cách A (khuyến nghị) – script tự động
  - macOS:
    ```bash
    npm run start:mac
    ```
  - Windows:
    ```bash
    npm run start:win
    ```
- Cách B (thủ công) — đặt `EXPO_PUBLIC_API_BASE` (VD: http://192.168.1.10:5000/api)

Chạy ứng dụng:

```bash
npx expo start
# Mở trên:
# - iOS Simulator
# - Android Emulator
# - Expo Go (thiết bị thật, cùng LAN)
```

---

## Cấu hình & Biến môi trường

- Backend `.env` (bắt buộc)
  - `MONGODB_URI`, `JWT_SECRET`, `PORT`
- Frontend (Expo)
  - `EXPO_PUBLIC_API_BASE` → ví dụ: `http://<IP_LAN>:5000/api`
  - Có thể cập nhật tự động qua `scripts/update-env-ip.js` với `start:mac` / `start:win`

---

## Giám sát dự án (Project Insights)

- KPI Overview: bấm để mở Modal danh sách (giữa màn hình, không bị trôi theo cuộn)
- Donut % hoàn thành
- Burndown: Số tác vụ còn lại theo thời gian
- Flow: Hoàn thành vs Còn lại (stacked)
- Hạn theo tuần (thay Gantt)
  - Biểu đồ cột số lượng tác vụ đến hạn từng tuần (Mon–Sun)
  - Tooltip: “X tác vụ” + tuần (dd/mm–dd/mm)
  - Dễ nhìn trên màn hình nhỏ hơn so với Gantt truyền thống

---

## Thông báo & Realtime

- Push
  - Server là nguồn push duy nhất khi có push token (Expo Push API)
  - Trong Expo Go (chưa có token), mô phỏng local notification để tránh trùng
- Realtime
  - Socket.IO rooms theo dự án
  - Sự kiện: task created/updated/deleted, project updated/invite, …

---

## Scripts hữu ích

Frontend:
- `npm run start:mac` — cập nhật IP LAN + start Expo (macOS)
- `npm run start:win` — cập nhật IP LAN + start Expo (Windows)
- `npm run update:ip -- <PORT>` — chỉ cập nhật endpoint (nâng cao)
- `npm run lint` — linting

---

## Troubleshooting

- Không thấy dữ liệu trong Expo Go
  - Kiểm tra `EXPO_PUBLIC_API_BASE` đúng IP LAN + port backend
  - Dùng `start:mac` / `start:win` để auto set
- Thông báo đẩy bị trùng
  - Expo Go mô phỏng local khi chưa có push token; khi có token thật, client tự tắt mô phỏng
- Lệch giờ/ngày
  - Ứng dụng chuẩn hóa ngày theo local device (YYYY-MM-DD)

---

## Lộ trình

- Phân quyền dự án chi tiết hơn (owner/admin/member)
- Nhắc nhở nhiều mốc cho cùng một mục
- Bộ lọc/nhãn nâng cao, search
- Offline-first

---

## Đóng góp

PRs/Issues được chào đón! Hãy mở một issue để thảo luận trước khi triển khai thay đổi lớn.

---

## License

MIT

