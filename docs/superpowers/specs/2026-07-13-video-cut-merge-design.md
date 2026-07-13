# Video Tool — Tính năng "Cắt & Nối Video" (Design Spec)

**Ngày:** 2026-07-13
**Trạng thái:** Đã duyệt hướng, chờ review spec

## 1. Mục tiêu

Web app chạy local giúp xử lý hàng loạt video trong một thư mục: cắt mỗi video thành
các đoạn ngẫu nhiên có độ dài giữ lại (mặc định 3–5s), giữa các đoạn giữ lại thì **bỏ đi**
một khoảng ngắn ngẫu nhiên (mặc định 0.4–0.5s), rồi **nối** các đoạn giữ lại thành một
video mới, xuất ra thư mục đầu ra. Mỗi video đầu vào → một video đầu ra.

Giao diện dark theme mô phỏng ảnh mẫu "Video Tool": sidebar 9 mục bên trái + vùng nội dung
bên phải. Ở phạm vi lần này chỉ triển khai đầy đủ **một** mục: **"Cắt & Nối Video"** (đặt
làm mục mặc định khi mở app). Các mục còn lại là placeholder "đang phát triển".

## 2. Quyết định đã chốt

| Vấn đề | Quyết định |
|---|---|
| Kiến trúc | Web app chạy local: Node.js + Express backend, frontend HTML/CSS/JS thuần |
| Phạm vi | Chỉ tính năng Cắt & Nối video (UI shell đầy đủ, các menu khác placeholder) |
| Logic đoạn 0.4–0.5s | **Bỏ đi** (cắt loại bỏ) — video ra ngắn hơn bản gốc |
| Vị trí menu | Thêm mục mới **"Cắt & Nối Video"**, đặt làm mặc định |
| Định dạng xuất | MP4 H.264 (libx264 CRF 20) + audio AAC 128k, giữ nguyên độ phân giải |
| Phương pháp ffmpeg | Một lệnh `ffmpeg` + bộ lọc `select`/`aselect` (re-encode, chính xác từng frame) |

## 3. Kiến trúc

```
video-tool/
├── package.json
├── server.js                # Express: serve UI + API
├── src/
│   ├── ffmpeg.js            # kiểm tra ffmpeg, ffprobe duration/audio, build & chạy lệnh cắt
│   ├── planner.js          # sinh danh sách đoạn giữ lại từ duration + tham số
│   ├── scanner.js          # quét thư mục tìm file video
│   └── fsbrowser.js        # liệt kê thư mục con (cho modal CHỌN THƯ MỤC)
├── public/
│   ├── index.html          # UI shell + màn hình Cắt & Nối
│   ├── styles.css          # dark theme mô phỏng ảnh mẫu
│   └── app.js              # logic frontend, gọi API, hiển thị log/tiến trình
└── docs/superpowers/specs/2026-07-13-video-cut-merge-design.md
```

Không cần database. Trạng thái job giữ trong bộ nhớ server (một job tại một thời điểm là đủ
cho phạm vi này).

## 4. Thuật toán cắt (module `planner.js`)

Đầu vào: `duration` (giây), `keepMin`, `keepMax`, `gapMin`, `gapMax`.

```
segments = []
cursor = 0
while cursor < duration:
    keepLen = random_uniform(keepMin, keepMax)
    segEnd  = min(cursor + keepLen, duration)
    if segEnd - cursor >= MIN_SEG (0.1s):     # bỏ qua mảnh quá vụn ở cuối
        segments.push([cursor, segEnd])
    gap    = random_uniform(gapMin, gapMax)
    cursor = segEnd + gap
return segments
```

- `random_uniform` dùng `Math.random()`; làm tròn 3 chữ số thập phân.
- Nếu `duration` không lấy được (ffprobe lỗi) → báo lỗi, bỏ qua file đó, tiếp tục file khác.

## 5. Dựng lệnh ffmpeg (module `ffmpeg.js`)

Với danh sách đoạn `[[s0,e0],[s1,e1],...]`:

- Biểu thức chọn video:
  `select='between(t,s0,e0)+between(t,s1,e1)+...',setpts=N/FRAME_RATE/TB`
  Dùng `setpts=N/FRAME_RATE/TB` (đánh số lại frame liên tục) chứ **không** dùng
  `setpts=PTS-STARTPTS`, vì các đoạn giữ lại không liền nhau — nếu chỉ offset PTS sẽ
  để lại khoảng trống (frame đứng hình) giữa các đoạn.
- Nếu có audio: `aselect='between(t,...)+...',asetpts=N/SR/TB` (đánh số lại mẫu audio).
- Lệnh:
  ```
  ffmpeg -y -i INPUT \
    -vf "select='<expr>',setpts=N/FRAME_RATE/TB" \
    -af "aselect='<expr>',asetpts=N/SR/TB" \   # bỏ nếu không có audio
    -c:v libx264 -crf 20 -preset veryfast \
    -c:a aac -b:a 128k \
    OUTPUT
  ```
- Nếu video không có luồng audio: bỏ toàn bộ phần `-af` và `-c:a`.
- Tiến trình: parse stderr ffmpeg lấy `time=` để tính % so với tổng thời lượng các đoạn giữ.

## 6. API (server.js)

| Method | Path | Body | Trả về |
|---|---|---|---|
| GET | `/` | — | index.html |
| GET | `/api/health` | — | `{ ffmpeg: bool, ffprobe: bool, version }` — kiểm tra ffmpeg đã cài |
| POST | `/api/browse` | `{ path }` | `{ current, parent, dirs[] }` — liệt kê thư mục con cho modal |
| POST | `/api/scan` | `{ folder }` | `{ videos: [{name, size, duration?}] }` |
| POST | `/api/process` | `{ folder, outDir, keepMin, keepMax, gapMin, gapMax }` | SSE stream: `log`, `progress`, `file-done`, `done`, `error` |

- Định dạng video nhận diện: `.mp4 .mov .mkv .avi .webm .flv .m4v` (không phân biệt hoa/thường).
- Validate: `keepMin <= keepMax`, `gapMin <= gapMax`, tất cả > 0; đường dẫn tồn tại; `outDir`
  tạo nếu chưa có (mặc định `<folder>/output`). Không cho `outDir` nằm trong tập file input
  đang quét để tránh xử lý chồng.
- Chống path traversal ở `/api/browse`/`/api/scan`: chỉ thao tác đọc; không xóa file người dùng.

## 7. Frontend (public/)

- **Sidebar:** logo "Video Tool" + 9 mục như ảnh (Đổi tên hàng loạt, Chuẩn hóa & Fill,
  Random Video, Merge Stock Random, Change-file, Filter Stock, Ảnh + Video,
  Ảnh + Stock + Video, Tách Block) **+ mục mới "Cắt & Nối Video"** (mặc định active).
- **Màn hình Cắt & Nối:**
  - Banner "Hướng dẫn sử dụng" (collapse) mô tả quy trình.
  - Ô "Thư mục video" + nút **CHỌN THƯ MỤC** (mở modal duyệt thư mục) + **QUÉT & XEM TRƯỚC**.
  - Ô "Thư mục xuất" (mặc định tự điền `<input>/output`).
  - 4 ô số: Giữ min (3), Giữ max (5), Bỏ min (0.4), Bỏ max (0.5).
  - Bảng preview video tìm thấy (tên, dung lượng, thời lượng).
  - Nút **THỰC HIỆN** (xanh lá, giống ảnh) → mở SSE, disable khi đang chạy.
  - **Thanh tiến trình** tổng + theo từng file.
  - Ô **"Nhật ký hoạt động"** cuộn, hiển thị log realtime.
- **Placeholder:** click các mục menu khác → hiển thị "Tính năng đang phát triển".
- **Kiểm tra ffmpeg:** khi load gọi `/api/health`; nếu thiếu ffmpeg → banner cảnh báo đỏ
  kèm hướng dẫn `sudo apt install ffmpeg` và disable nút THỰC HIỆN.
- CSS: mô phỏng bảng màu ảnh mẫu (nền `#0d1b2a`/`#132a43`, sidebar tối, accent xanh dương,
  nút chính xanh lá). Responsive tối thiểu (desktop-first).

## 8. Xử lý lỗi

- Thiếu ffmpeg/ffprobe → banner + chặn chạy.
- Thư mục không tồn tại / rỗng → thông báo rõ ràng.
- File lỗi (ffprobe/ffmpeg fail) → log lỗi cho file đó, **tiếp tục** các file còn lại, cuối cùng
  báo tổng: thành công X / lỗi Y.
- Tham số không hợp lệ → chặn ở cả frontend và backend.
- Ngắt kết nối SSE giữa chừng → server dừng ffmpeg đang chạy (kill child process).

## 9. Kiểm thử

- **planner.js (unit):** duration 0 → rỗng; duration nhỏ hơn keepMin → 1 đoạn = cả video;
  tổng các đoạn giữ < duration; min==max cho kết quả cố định; đoạn cuối không vượt duration.
- **ffmpeg.js (unit):** build đúng chuỗi filter cho có/không audio; escape đúng.
- **Tích hợp (thủ công):** tạo 1 video test bằng ffmpeg (`testsrc`), chạy end-to-end, kiểm tra
  file xuất tồn tại, thời lượng ≈ tổng các đoạn giữ, phát được.
- **API:** health khi thiếu/đủ ffmpeg; scan thư mục mẫu; process trả SSE `done`.

## 10. Ngoài phạm vi (YAGNI)

- 8 tính năng menu còn lại (chỉ placeholder).
- Hàng đợi nhiều job song song, tài khoản/đăng nhập, lưu lịch sử job vào DB.
- Chọn CRF/codec trong UI (dùng mặc định cố định).
- Đóng gói Electron.
