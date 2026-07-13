# Video Tool

Web app chạy local để **cắt & nối video** hàng loạt bằng ffmpeg.

Cắt mỗi video thành các đoạn ngẫu nhiên (mặc định **3–5s**), **bỏ** một khoảng ngắn ngẫu nhiên
(mặc định **0.4–0.5s**) giữa các đoạn, rồi nối các đoạn giữ lại thành một video mới. Mỗi video
đầu vào cho ra một file `<tên>_cut.mp4` trong thư mục xuất.

## Chạy nhanh trên Windows (bản đóng gói .exe)

Dành cho người dùng cuối — **không cần cài Node.js hay ffmpeg**:

1. Giải nén thư mục `VideoTool-win` (gồm `VideoTool.exe`, `ffmpeg.exe`, `ffprobe.exe` — cả 3 phải
   nằm cùng một thư mục).
2. Double-click **`VideoTool.exe`**. Cửa sổ dòng lệnh hiện lên và trình duyệt tự mở tới app
   (mặc định `http://localhost:5390`; nếu cổng bận sẽ tự nhảy cổng khác — xem dòng URL trong cửa sổ đó).
3. Dùng app như bình thường. Muốn tắt: đóng cửa sổ dòng lệnh đó.

> Windows có thể cảnh báo SmartScreen (do exe chưa ký) → **More info → Run anyway**.
> Cách tạo ra thư mục `VideoTool-win` xem mục **"Đóng gói .exe cho Windows"** bên dưới.

## Yêu cầu (khi chạy từ mã nguồn)

*(Bỏ qua phần này nếu bạn dùng bản `.exe` đóng gói ở trên.)*

- **Node.js 20+** (https://nodejs.org)
- **ffmpeg + ffprobe** phải có trong `PATH` (xem cách cài bên dưới).

Kiểm tra sau khi cài:

```bash
ffmpeg -version
ffprobe -version
```

Thấy `ffmpeg version ...` là được. Trong app, nếu chưa có ffmpeg sẽ hiện banner đỏ cảnh báo
và nút **THỰC HIỆN** bị khóa.

### Cài ffmpeg trên Linux (Ubuntu/Debian)

```bash
sudo apt install ffmpeg
```

Hoặc tải bản static: https://johnvansickle.com/ffmpeg/ rồi thêm vào `PATH`.

### Cài ffmpeg trên Windows (tải thủ công, không cần package manager)

1. Tải bản build Windows: **https://www.gyan.dev/ffmpeg/builds/** → mục *release builds* →
   `ffmpeg-release-essentials.zip`
   (nguồn khác: https://github.com/BtbN/FFmpeg-Builds/releases).
2. Giải nén, ví dụ vào `C:\ffmpeg`. Bên trong có thư mục `bin` chứa `ffmpeg.exe` và `ffprobe.exe`
   (đường dẫn đầy đủ: `C:\ffmpeg\bin`).
3. Thêm `C:\ffmpeg\bin` vào **PATH**:
   - Nhấn **Start** → gõ *environment variables* → mở **Edit the system environment variables**
     → nút **Environment Variables…**
   - Ở mục **Path** (trong *User variables* hoặc *System variables*) → **Edit** → **New** →
     dán `C:\ffmpeg\bin` → **OK** ở tất cả cửa sổ.
4. **Mở lại** terminal (PowerShell/CMD) để PATH cập nhật, rồi chạy `ffmpeg -version` để kiểm tra.

> Trên Windows, đường dẫn thư mục nhập vào app dùng kiểu Windows, ví dụ `D:\videos\input`.

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
- `src/ffmpeg.js` — kiểm tra ffmpeg, `ffprobe` (thời lượng/audio/fps), dựng lệnh `select`, chạy cắt;
  `resolveBinary` xác định đường dẫn ffmpeg (env → cạnh exe → PATH).
- `public/` — giao diện (HTML/CSS/JS thuần).
- `scripts/build-win.mjs` — đóng gói `.exe` cho Windows (tải ffmpeg + `pkg`).

Cắt bằng **một lệnh ffmpeg** với bộ lọc `select`/`aselect` + `setpts=N/FRAME_RATE/TB`, kèm
`-r <fps gốc>` để không bị rớt frame / đổi frame rate.

## Đóng gói .exe cho Windows

Tạo bản `.exe` chạy độc lập (không cần Node/ffmpeg trên máy người dùng) bằng
[`@yao-pkg/pkg`](https://github.com/yao-pkg/pkg). Có thể build **ngay trên Linux/macOS**
(cross-compile về win-x64).

```bash
npm install          # cần cả devDependencies
npm run build:win
```

Kết quả nằm ở `dist/VideoTool-win/` gồm `VideoTool.exe` + `ffmpeg.exe` + `ffprobe.exe`. Zip thư
mục này lại rồi gửi cho người dùng.

Cách hoạt động:
- `public/` (giao diện) được **nhúng vào `VideoTool.exe`** (khai báo ở `pkg.assets`).
- Script tải ffmpeg/ffprobe Windows static (mặc định từ GitHub BtbN; đổi nguồn qua biến môi trường
  `FFMPEG_WIN_ZIP`). Cần `curl` + `unzip` trong PATH khi build.
- Lúc chạy, app tìm ffmpeg theo thứ tự: biến môi trường `FFMPEG_PATH`/`FFPROBE_PATH` → file
  `ffmpeg.exe` **cạnh** `VideoTool.exe` → cuối cùng là PATH hệ thống.
- Bản đóng gói tự mở trình duyệt khi khởi động (tắt bằng `NO_OPEN=1`) và tự nhảy cổng nếu 5390 bận.

> ffmpeg static khá lớn (~140MB mỗi file với bản BtbN gpl) nên thư mục ~330MB. Muốn nhỏ hơn có thể
> trỏ `FFMPEG_WIN_ZIP` tới bản essentials của gyan.dev.

## Kiểm thử

```bash
npm test        # 31 unit test (planner, scanner, fsbrowser, ffmpeg, server)
```

## Ghi chú phạm vi

Các mục menu khác (Đổi tên hàng loạt, Random Video, Merge Stock, Tách Block, ...) hiện là
placeholder "đang phát triển".
