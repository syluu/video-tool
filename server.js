'use strict';
const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { spawn } = require('node:child_process');
const { checkFfmpeg, probe, runCut } = require('./src/ffmpeg');
const { scanVideos } = require('./src/scanner');
const { listDirs } = require('./src/fsbrowser');
const { planSegments } = require('./src/planner');

function validateParams({ keepMin, keepMax, gapMin, gapMax }) {
  const nums = { keepMin, keepMax, gapMin, gapMax };
  for (const [k, val] of Object.entries(nums)) {
    if (typeof val !== 'number' || !Number.isFinite(val) || val <= 0) {
      return `Tham số ${k} không hợp lệ`;
    }
  }
  if (keepMin > keepMax) return 'Giữ min phải ≤ giữ max';
  if (gapMin > gapMax) return 'Bỏ min phải ≤ bỏ max';
  return null;
}

const app = express();
app.use(express.json());

// Phục vụ file tĩnh bằng cách đọc trực tiếp (fs.readFileSync). Cách này chạy được cả khi
// đóng gói bằng pkg (public/ nhúng vào snapshot) — tránh sự cố express.static + pkg.
const PUBLIC_DIR = path.join(__dirname, 'public');
const STATIC_FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'application/javascript; charset=utf-8'],
};
app.get(Object.keys(STATIC_FILES), (req, res) => {
  const entry = STATIC_FILES[req.path] || STATIC_FILES['/'];
  try {
    res.type(entry[1]).send(fs.readFileSync(path.join(PUBLIC_DIR, entry[0])));
  } catch {
    res.status(404).send('Not found');
  }
});

app.get('/api/health', async (req, res) => {
  res.json(await checkFfmpeg());
});

app.post('/api/browse', async (req, res) => {
  try {
    res.json(await listDirs(req.body.path));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/scan', async (req, res) => {
  try {
    const videos = await scanVideos(req.body.folder);
    res.json({ videos });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/process', async (req, res) => {
  const { folder, outDir, keepMin, keepMax, gapMin, gapMax } = req.body;
  const paramErr = validateParams({ keepMin, keepMax, gapMin, gapMax });
  if (paramErr) return res.status(400).json({ error: paramErr });
  if (!folder) return res.status(400).json({ error: 'Thiếu thư mục video' });

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  const ac = new AbortController();
  // Chỉ hủy khi client thực sự ngắt kết nối giữa chừng (response chưa hoàn tất).
  // Lưu ý: KHÔNG dùng req.on('close') vì nó bắn ngay khi body POST được nhận xong.
  res.on('close', () => {
    if (!res.writableFinished) ac.abort();
  });

  try {
    const health = await checkFfmpeg();
    if (!health.ffmpeg || !health.ffprobe) {
      send('error', { message: 'Chưa cài ffmpeg/ffprobe trên máy' });
      return res.end();
    }
    const videos = await scanVideos(folder);
    if (!videos.length) {
      send('error', { message: 'Không tìm thấy video trong thư mục' });
      return res.end();
    }
    const out = outDir && String(outDir).trim()
      ? path.resolve(String(outDir))
      : path.join(path.resolve(folder), 'output');
    await fsp.mkdir(out, { recursive: true });
    send('log', { message: `Tìm thấy ${videos.length} video. Xuất ra: ${out}` });

    let ok = 0;
    let fail = 0;
    for (let i = 0; i < videos.length; i++) {
      if (ac.signal.aborted) break;
      const v = videos[i];
      send('log', { message: `(${i + 1}/${videos.length}) Đang xử lý ${v.name}` });
      try {
        const { duration, hasAudio, fps } = await probe(v.path);
        const segments = planSegments(duration, { keepMin, keepMax, gapMin, gapMax });
        if (!segments.length) {
          send('log', { message: `Bỏ qua ${v.name}: video quá ngắn`, level: 'warn' });
          continue;
        }
        const base = v.name.replace(/\.[^.]+$/, '');
        const outFile = path.join(out, `${base}_cut.mp4`);
        await runCut(
          { input: v.path, output: outFile, segments, hasAudio, fps, crf: 20 },
          {
            signal: ac.signal,
            onProgress: (pct) => send('progress', { file: v.name, index: i, total: videos.length, pct }),
          }
        );
        ok++;
        send('file-done', { file: v.name, output: outFile, segments: segments.length });
      } catch (e) {
        if (ac.signal.aborted) break;
        fail++;
        send('log', { message: `Lỗi ${v.name}: ${e.message}`, level: 'error' });
      }
    }
    if (!ac.signal.aborted) send('done', { ok, fail, outDir: out });
  } catch (e) {
    if (!ac.signal.aborted) send('error', { message: e.message });
  } finally {
    res.end();
  }
});

// Lệnh mở trình duyệt theo nền tảng (tách riêng để unit test).
function browserOpenCommand(url, platform = process.platform) {
  if (platform === 'win32') return { cmd: 'cmd', args: ['/c', 'start', '', url] };
  if (platform === 'darwin') return { cmd: 'open', args: [url] };
  return { cmd: 'xdg-open', args: [url] };
}

function openBrowser(url) {
  const { cmd, args } = browserOpenCommand(url);
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch { /* không mở được thì thôi, người dùng tự mở URL */ }
}

// Nghe cổng startPort; nếu bận (EADDRINUSE) thì tự thử cổng kế tiếp, tối đa `attempts` lần.
function listenWithFallback(app, startPort, attempts = 10) {
  return new Promise((resolve, reject) => {
    let port = startPort;
    let tries = 0;
    const tryListen = () => {
      const server = app.listen(port);
      server.once('listening', () => resolve({ server, port }));
      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE' && tries < attempts) {
          tries += 1;
          port += 1;
          setImmediate(tryListen);
        } else {
          reject(err);
        }
      });
    };
    tryListen();
  });
}

async function start() {
  const startPort = Number(process.env.PORT) || 5390;
  const { port } = await listenWithFallback(app, startPort, 10);
  const url = `http://localhost:${port}`;
  console.log(`Video Tool chạy tại ${url}`);
  // Khi chạy bản đóng gói (.exe), tự mở trình duyệt cho tiện. Tắt bằng NO_OPEN=1.
  if (process.pkg && !process.env.NO_OPEN) openBrowser(url);
}

if (require.main === module) {
  start().catch((e) => {
    console.error('Không khởi động được server:', e.message);
    process.exit(1);
  });
}

module.exports = { app, validateParams, browserOpenCommand, listenWithFallback };
