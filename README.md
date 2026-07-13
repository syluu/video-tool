# Video Tool

Web app chạy local để **cắt & nối video** hàng loạt bằng ffmpeg.

Cắt mỗi video thành các đoạn ngẫu nhiên (mặc định **3–5s**), **bỏ** một khoảng ngắn ngẫu nhiên
(mặc định **0.4–0.5s**) giữa các đoạn, rồi nối các đoạn giữ lại thành một video mới. Mỗi video
đầu vào cho ra một file `<tên>_cut.mp4` trong thư mục xuất.

## Yêu cầu

- **Node.js 20+**
- **ffmpeg + ffprobe** phải có trong `PATH`.
  - Ubuntu/Debian: `sudo apt install ffmpeg`
  - hoặc tải bản static: https://johnvansickle.com/ffmpeg/ rồi thêm vào `PATH`.
  - Kiểm tra: `ffmpeg -version` và `ffprobe -version`.

## Chạy

```bash
npm install
npm start
# mở http://localhost:5390
```

Đổi cổng: `PORT=8642 npm start`.

## Sử dụng

1. Vào mục **"Cắt & Nối Video"** (mở sẵn mặc định).
2. Nhập/chọn **thư mục video** → **QUÉT & XEM TRƯỚC** để liệt kê video.
3. (Tuỳ chọn) đặt **thư mục xuất** — để trống sẽ dùng `<thư mục video>/output`.
4. Chỉnh 4 thông số: **Giữ min/max** và **Bỏ min/max** (giây).
5. Nhấn **THỰC HIỆN**. Theo dõi thanh tiến trình và ô **Nhật ký hoạt động**. Nút **DỪNG** để hủy.

## Định dạng đầu ra

MP4 H.264 (`libx264 -crf 20 -preset veryfast`) + audio AAC 128k, **giữ nguyên độ phân giải và
frame rate gốc**. Video không có audio sẽ được xuất không audio.

## Kiến trúc

- `server.js` — Express: phục vụ UI tĩnh + API `health` / `browse` / `scan` / `process` (SSE).
- `src/planner.js` — sinh danh sách đoạn giữ lại từ thời lượng + tham số.
- `src/scanner.js` — quét thư mục tìm file video.
- `src/fsbrowser.js` — liệt kê thư mục con cho modal chọn thư mục.
- `src/ffmpeg.js` — kiểm tra ffmpeg, `ffprobe` (thời lượng/audio/fps), dựng lệnh `select`, chạy cắt.
- `public/` — giao diện (HTML/CSS/JS thuần).

Cắt bằng **một lệnh ffmpeg** với bộ lọc `select`/`aselect` + `setpts=N/FRAME_RATE/TB`, kèm
`-r <fps gốc>` để không bị rớt frame / đổi frame rate.

## Kiểm thử

```bash
npm test        # 24 unit test (planner, scanner, fsbrowser, ffmpeg, server)
```

## Ghi chú phạm vi

Các mục menu khác (Đổi tên hàng loạt, Random Video, Merge Stock, Tách Block, ...) hiện là
placeholder "đang phát triển".
