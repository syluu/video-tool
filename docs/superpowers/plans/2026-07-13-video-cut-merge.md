# Video Tool — "Cắt & Nối Video" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Web app chạy local để cắt hàng loạt video thành các đoạn ngẫu nhiên 3–5s, bỏ khoảng 0.4–0.5s giữa các đoạn, rồi nối lại và xuất ra thư mục.

**Architecture:** Node.js + Express backend gọi `ffmpeg`/`ffprobe` qua `child_process`; frontend HTML/CSS/JS thuần giao diện dark theme. Xử lý bằng một lệnh ffmpeg dùng bộ lọc `select`/`aselect`. Log realtime qua Server-Sent Events.

**Tech Stack:** Node.js v20, Express 4, node:test (built-in), ffmpeg/ffprobe (system), vanilla JS frontend.

## Global Constraints

- Node built-in test runner (`node --test`), KHÔNG thêm framework test ngoài.
- Runtime dependency duy nhất: `express`.
- Bộ lọc video PHẢI dùng `setpts=N/FRAME_RATE/TB` (audio `asetpts=N/SR/TB`) — không dùng `PTS-STARTPTS`.
- Chuỗi filter PHẢI bọc biểu thức `select` trong dấu nháy đơn literal: `select='<expr>',setpts=...` (ffmpeg tự parse nháy này; spawn chạy không qua shell).
- Định dạng xuất cố định: `-c:v libx264 -crf 20 -preset veryfast -c:a aac -b:a 128k`, đuôi `_cut.mp4`.
- Mặc định tham số: keepMin=3, keepMax=5, gapMin=0.4, gapMax=0.5.
- Định dạng video nhận diện: `.mp4 .mov .mkv .avi .webm .flv .m4v` (không phân biệt hoa/thường).
- Toàn bộ text UI/log bằng tiếng Việt.

## File Structure

```
video-tool/
├── package.json          # scripts + express dep
├── .gitignore
├── server.js             # Express: static + /api/health /api/browse /api/scan /api/process(SSE)
├── src/
│   ├── planner.js        # planSegments(duration, opts, rng) -> [[start,end],...]
│   ├── scanner.js        # scanVideos(folder) -> [{name,path,size}]
│   ├── fsbrowser.js      # listDirs(path) -> {current,parent,dirs}
│   └── ffmpeg.js         # checkFfmpeg, probe, buildSelectExpr, buildArgs, runCut
├── public/
│   ├── index.html        # UI shell + màn hình Cắt & Nối
│   ├── styles.css        # dark theme
│   └── app.js            # frontend logic + SSE parser
└── test/
    ├── planner.test.js
    ├── scanner.test.js
    ├── fsbrowser.test.js
    ├── ffmpeg.test.js
    └── server.test.js
```

---

### Task 1: Scaffold dự án

**Files:**
- Create: `package.json`
- Create: `.gitignore`

**Interfaces:**
- Produces: `npm start` chạy `node server.js`; `npm test` chạy `node --test`; dependency `express`.

- [ ] **Step 1: Tạo `package.json`**

```json
{
  "name": "video-tool",
  "version": "1.0.0",
  "description": "Web app cắt & nối video bằng ffmpeg",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "test": "node --test"
  },
  "dependencies": {
    "express": "^4.19.2"
  }
}
```

- [ ] **Step 2: Tạo `.gitignore`**

```
node_modules/
output/
*.log
.DS_Store
```

- [ ] **Step 3: Cài dependency**

Run: `npm install`
Expected: tạo `node_modules/` và `package-lock.json`, không lỗi.

- [ ] **Step 4: Kiểm tra test runner chạy (chưa có test)**

Run: `node --test 2>&1 | tail -3`
Expected: `# tests 0` / `# pass 0` / exit 0.

- [ ] **Step 5: Commit**

```bash
git add package.json .gitignore package-lock.json
git commit -m "chore: scaffold project với express + node test runner"
```

---

### Task 2: `planner.js` — sinh danh sách đoạn giữ lại

**Files:**
- Create: `src/planner.js`
- Test: `test/planner.test.js`

**Interfaces:**
- Produces:
  - `planSegments(duration: number, opts: {keepMin,keepMax,gapMin,gapMax}, rng=Math.random): [start,end][]`
  - `round3(n: number): number`
  - `MIN_SEG: number` (0.1)

- [ ] **Step 1: Viết test thất bại — `test/planner.test.js`**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { planSegments, round3, MIN_SEG } = require('../src/planner');

test('duration 0 trả về mảng rỗng', () => {
  assert.deepStrictEqual(planSegments(0, { keepMin: 3, keepMax: 5, gapMin: 0.4, gapMax: 0.5 }), []);
});

test('video ngắn hơn keepMin -> 1 đoạn bằng cả video', () => {
  const segs = planSegments(2, { keepMin: 3, keepMax: 3, gapMin: 0.5, gapMax: 0.5 });
  assert.deepStrictEqual(segs, [[0, 2]]);
});

test('min==max cho kết quả cố định', () => {
  const segs = planSegments(10, { keepMin: 4, keepMax: 4, gapMin: 0.5, gapMax: 0.5 });
  assert.deepStrictEqual(segs, [[0, 4], [4.5, 8.5], [9, 10]]);
});

test('không đoạn nào vượt quá duration', () => {
  const segs = planSegments(37, { keepMin: 3, keepMax: 5, gapMin: 0.4, gapMax: 0.5 });
  for (const [s, e] of segs) {
    assert.ok(e <= 37, `end ${e} vượt duration`);
    assert.ok(e > s, 'end phải > start');
  }
});

test('tổng đoạn giữ nhỏ hơn duration (vì có khoảng bỏ)', () => {
  const total = planSegments(100, { keepMin: 4, keepMax: 4, gapMin: 0.5, gapMax: 0.5 })
    .reduce((a, [s, e]) => a + (e - s), 0);
  assert.ok(total < 100);
});

test('rng cố định cho kết quả lặp lại được', () => {
  const rng = () => 0.5;
  const a = planSegments(20, { keepMin: 3, keepMax: 5, gapMin: 0.4, gapMax: 0.5 }, rng);
  const b = planSegments(20, { keepMin: 3, keepMax: 5, gapMin: 0.4, gapMax: 0.5 }, rng);
  assert.deepStrictEqual(a, b);
});

test('round3 làm tròn 3 chữ số', () => {
  assert.strictEqual(round3(1.23456), 1.235);
  assert.strictEqual(MIN_SEG, 0.1);
});
```

- [ ] **Step 2: Chạy test để xác nhận thất bại**

Run: `node --test test/planner.test.js`
Expected: FAIL — `Cannot find module '../src/planner'`.

- [ ] **Step 3: Viết `src/planner.js`**

```js
'use strict';

const MIN_SEG = 0.1; // bỏ mảnh cuối quá vụn

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

/**
 * Sinh danh sách đoạn GIỮ LẠI [start, end] (giây).
 * Giữ ngẫu nhiên keepMin..keepMax, rồi BỎ ngẫu nhiên gapMin..gapMax, lặp đến hết.
 */
function planSegments(duration, opts, rng = Math.random) {
  const { keepMin, keepMax, gapMin, gapMax } = opts;
  const rnd = (min, max) => min + rng() * (max - min);
  const segments = [];
  let cursor = 0;
  let guard = 0;
  while (cursor < duration && guard < 1e6) {
    guard++;
    const keepLen = rnd(keepMin, keepMax);
    const segEnd = Math.min(cursor + keepLen, duration);
    if (segEnd - cursor >= MIN_SEG) {
      segments.push([round3(cursor), round3(segEnd)]);
    }
    const gap = rnd(gapMin, gapMax);
    cursor = segEnd + gap;
  }
  return segments;
}

module.exports = { planSegments, round3, MIN_SEG };
```

- [ ] **Step 4: Chạy test để xác nhận pass**

Run: `node --test test/planner.test.js`
Expected: PASS — tất cả 7 test.

- [ ] **Step 5: Commit**

```bash
git add src/planner.js test/planner.test.js
git commit -m "feat: planner sinh danh sách đoạn giữ lại"
```

---

### Task 3: `scanner.js` — quét thư mục tìm video

**Files:**
- Create: `src/scanner.js`
- Test: `test/scanner.test.js`

**Interfaces:**
- Produces:
  - `scanVideos(folder: string): Promise<{name,path,size}[]>` (sắp xếp theo tên)
  - `isVideo(name: string): boolean`
  - `VIDEO_EXTS: Set<string>`

- [ ] **Step 1: Viết test thất bại — `test/scanner.test.js`**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { scanVideos, isVideo } = require('../src/scanner');

test('isVideo nhận diện đuôi hợp lệ, không phân biệt hoa thường', () => {
  assert.ok(isVideo('a.mp4'));
  assert.ok(isVideo('B.MOV'));
  assert.ok(isVideo('c.MkV'));
  assert.ok(!isVideo('d.txt'));
  assert.ok(!isVideo('noext'));
});

test('scanVideos chỉ trả video, sắp theo tên, kèm size', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'scan-'));
  await fs.writeFile(path.join(dir, 'b.mp4'), 'xx');
  await fs.writeFile(path.join(dir, 'a.mov'), 'y');
  await fs.writeFile(path.join(dir, 'note.txt'), 'zzz');
  await fs.mkdir(path.join(dir, 'sub'));
  const vids = await scanVideos(dir);
  assert.strictEqual(vids.length, 2);
  assert.deepStrictEqual(vids.map(v => v.name), ['a.mov', 'b.mp4']);
  assert.strictEqual(vids[0].size, 1);
  assert.strictEqual(vids[1].size, 2);
  assert.ok(vids[0].path.endsWith(path.join(dir, 'a.mov')) || vids[0].path === path.join(dir, 'a.mov'));
  await fs.rm(dir, { recursive: true, force: true });
});

test('scanVideos ném lỗi khi thư mục không tồn tại', async () => {
  await assert.rejects(() => scanVideos('/khong/ton/tai/xyz'));
});
```

- [ ] **Step 2: Chạy test để xác nhận thất bại**

Run: `node --test test/scanner.test.js`
Expected: FAIL — `Cannot find module '../src/scanner'`.

- [ ] **Step 3: Viết `src/scanner.js`**

```js
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');

const VIDEO_EXTS = new Set(['.mp4', '.mov', '.mkv', '.avi', '.webm', '.flv', '.m4v']);

function isVideo(name) {
  return VIDEO_EXTS.has(path.extname(name).toLowerCase());
}

async function scanVideos(folder) {
  const entries = await fs.readdir(folder, { withFileTypes: true });
  const videos = [];
  for (const ent of entries) {
    if (ent.isFile() && isVideo(ent.name)) {
      const full = path.join(folder, ent.name);
      const st = await fs.stat(full);
      videos.push({ name: ent.name, path: full, size: st.size });
    }
  }
  videos.sort((a, b) => a.name.localeCompare(b.name));
  return videos;
}

module.exports = { scanVideos, isVideo, VIDEO_EXTS };
```

- [ ] **Step 4: Chạy test để xác nhận pass**

Run: `node --test test/scanner.test.js`
Expected: PASS — 3 test.

- [ ] **Step 5: Commit**

```bash
git add src/scanner.js test/scanner.test.js
git commit -m "feat: scanner quét thư mục tìm file video"
```

---

### Task 4: `fsbrowser.js` — liệt kê thư mục con cho modal chọn thư mục

**Files:**
- Create: `src/fsbrowser.js`
- Test: `test/fsbrowser.test.js`

**Interfaces:**
- Produces: `listDirs(dir?: string): Promise<{current: string, parent: string|null, dirs: {name,path}[]}>`
  - `dir` rỗng/undefined → dùng `os.homedir()`; ẩn thư mục bắt đầu bằng `.`; sắp theo tên.

- [ ] **Step 1: Viết test thất bại — `test/fsbrowser.test.js`**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { listDirs } = require('../src/fsbrowser');

test('listDirs trả thư mục con, ẩn dot-dir, kèm current & parent', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'br-'));
  await fs.mkdir(path.join(dir, 'alpha'));
  await fs.mkdir(path.join(dir, 'beta'));
  await fs.mkdir(path.join(dir, '.hidden'));
  await fs.writeFile(path.join(dir, 'file.txt'), 'x');
  const res = await listDirs(dir);
  assert.strictEqual(res.current, path.resolve(dir));
  assert.deepStrictEqual(res.dirs.map(d => d.name), ['alpha', 'beta']);
  assert.strictEqual(res.parent, path.dirname(path.resolve(dir)));
  await fs.rm(dir, { recursive: true, force: true });
});

test('listDirs không tham số dùng home directory', async () => {
  const res = await listDirs();
  assert.strictEqual(res.current, os.homedir());
});

test('root có parent = null', async () => {
  const res = await listDirs('/');
  assert.strictEqual(res.parent, null);
});
```

- [ ] **Step 2: Chạy test để xác nhận thất bại**

Run: `node --test test/fsbrowser.test.js`
Expected: FAIL — `Cannot find module '../src/fsbrowser'`.

- [ ] **Step 3: Viết `src/fsbrowser.js`**

```js
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

async function listDirs(dir) {
  const target = dir && String(dir).trim() ? path.resolve(String(dir)) : os.homedir();
  const entries = await fs.readdir(target, { withFileTypes: true });
  const dirs = entries
    .filter(e => e.isDirectory() && !e.name.startsWith('.'))
    .map(e => ({ name: e.name, path: path.join(target, e.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const parent = path.dirname(target);
  return { current: target, parent: parent === target ? null : parent, dirs };
}

module.exports = { listDirs };
```

- [ ] **Step 4: Chạy test để xác nhận pass**

Run: `node --test test/fsbrowser.test.js`
Expected: PASS — 3 test.

- [ ] **Step 5: Commit**

```bash
git add src/fsbrowser.js test/fsbrowser.test.js
git commit -m "feat: fsbrowser liệt kê thư mục con cho modal chọn thư mục"
```

---

### Task 5: `ffmpeg.js` — probe, dựng lệnh, chạy cắt

**Files:**
- Create: `src/ffmpeg.js`
- Test: `test/ffmpeg.test.js` (chỉ unit test 2 hàm thuần `buildSelectExpr`, `buildArgs`; `probe`/`checkFfmpeg`/`runCut` xác minh ở Task 9 vì cần ffmpeg thật)

**Interfaces:**
- Consumes: không.
- Produces:
  - `buildSelectExpr(segments: [start,end][]): string`
  - `buildArgs({input,output,segments,hasAudio,crf=20}): string[]`
  - `checkFfmpeg(): Promise<{ffmpeg:boolean, ffprobe:boolean, version:string|null}>`
  - `probe(file: string): Promise<{duration:number, hasAudio:boolean}>`
  - `runCut(opts, {onProgress?, signal?}): Promise<void>` — opts giống buildArgs.

- [ ] **Step 1: Viết test thất bại — `test/ffmpeg.test.js`**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildSelectExpr, buildArgs } = require('../src/ffmpeg');

test('buildSelectExpr nối các đoạn bằng dấu +', () => {
  assert.strictEqual(
    buildSelectExpr([[0, 4], [4.5, 8.5]]),
    'between(t,0,4)+between(t,4.5,8.5)'
  );
});

test('buildArgs có video filter với nháy đơn literal và setpts đúng', () => {
  const args = buildArgs({ input: 'in.mp4', output: 'out.mp4', segments: [[0, 4]], hasAudio: true });
  const vf = args[args.indexOf('-vf') + 1];
  assert.strictEqual(vf, "select='between(t,0,4)',setpts=N/FRAME_RATE/TB");
  const af = args[args.indexOf('-af') + 1];
  assert.strictEqual(af, "aselect='between(t,0,4)',asetpts=N/SR/TB");
  assert.ok(args.includes('libx264'));
  assert.ok(args.includes('aac'));
  assert.strictEqual(args[0], '-y');
  assert.strictEqual(args[args.length - 1], 'out.mp4');
});

test('buildArgs bỏ audio khi hasAudio=false', () => {
  const args = buildArgs({ input: 'in.mp4', output: 'out.mp4', segments: [[0, 4]], hasAudio: false });
  assert.ok(!args.includes('-af'));
  assert.ok(!args.includes('aac'));
  assert.ok(args.includes('-vf'));
});

test('buildArgs dùng crf tuỳ chỉnh', () => {
  const args = buildArgs({ input: 'i', output: 'o', segments: [[0, 1]], hasAudio: false, crf: 23 });
  assert.strictEqual(args[args.indexOf('-crf') + 1], '23');
});
```

- [ ] **Step 2: Chạy test để xác nhận thất bại**

Run: `node --test test/ffmpeg.test.js`
Expected: FAIL — `Cannot find module '../src/ffmpeg'`.

- [ ] **Step 3: Viết `src/ffmpeg.js`**

```js
'use strict';
const { spawn } = require('node:child_process');

function buildSelectExpr(segments) {
  return segments.map(([s, e]) => `between(t,${s},${e})`).join('+');
}

function buildArgs({ input, output, segments, hasAudio, crf = 20 }) {
  const expr = buildSelectExpr(segments);
  const args = ['-y', '-i', input, '-vf', `select='${expr}',setpts=N/FRAME_RATE/TB`];
  if (hasAudio) {
    args.push('-af', `aselect='${expr}',asetpts=N/SR/TB`);
  }
  args.push('-c:v', 'libx264', '-crf', String(crf), '-preset', 'veryfast');
  if (hasAudio) {
    args.push('-c:a', 'aac', '-b:a', '128k');
  }
  args.push(output);
  return args;
}

function checkBinary(bin) {
  return new Promise((resolve) => {
    const p = spawn(bin, ['-version']);
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('error', () => resolve({ ok: false, version: null }));
    p.on('close', (code) => {
      const m = out.match(/version\s+(\S+)/);
      resolve({ ok: code === 0, version: m ? m[1] : null });
    });
  });
}

async function checkFfmpeg() {
  const [ff, fp] = await Promise.all([checkBinary('ffmpeg'), checkBinary('ffprobe')]);
  return { ffmpeg: ff.ok, ffprobe: fp.ok, version: ff.version };
}

function probe(file) {
  return new Promise((resolve, reject) => {
    const args = ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', file];
    const p = spawn('ffprobe', args);
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error(err.trim() || `ffprobe thoát mã ${code}`));
      try {
        const json = JSON.parse(out);
        const duration = parseFloat(json.format && json.format.duration);
        const hasAudio = (json.streams || []).some((s) => s.codec_type === 'audio');
        if (!Number.isFinite(duration)) return reject(new Error('Không đọc được thời lượng video'));
        resolve({ duration, hasAudio });
      } catch (e) {
        reject(e);
      }
    });
  });
}

function runCut(opts, { onProgress, signal } = {}) {
  return new Promise((resolve, reject) => {
    const args = buildArgs(opts);
    const totalKeep = opts.segments.reduce((a, [s, e]) => a + (e - s), 0);
    const p = spawn('ffmpeg', args, { signal });
    let err = '';
    p.stderr.on('data', (d) => {
      const s = d.toString();
      err += s;
      const m = s.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (m && onProgress && totalKeep > 0) {
        const t = (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
        onProgress(Math.min(1, t / totalKeep));
      }
    });
    p.on('error', reject);
    p.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(err.split('\n').filter(Boolean).slice(-4).join(' | ') || `ffmpeg thoát mã ${code}`));
    });
  });
}

module.exports = { buildSelectExpr, buildArgs, checkFfmpeg, probe, runCut };
```

- [ ] **Step 4: Chạy test để xác nhận pass**

Run: `node --test test/ffmpeg.test.js`
Expected: PASS — 4 test.

- [ ] **Step 5: Commit**

```bash
git add src/ffmpeg.js test/ffmpeg.test.js
git commit -m "feat: module ffmpeg (probe, dựng lệnh select, chạy cắt)"
```

---

### Task 6: `server.js` — Express endpoints + SSE

**Files:**
- Create: `server.js`
- Test: `test/server.test.js` (unit test `validateParams`; endpoints xác minh ở Task 9)

**Interfaces:**
- Consumes: `checkFfmpeg`, `probe`, `runCut` (ffmpeg.js); `scanVideos` (scanner.js); `listDirs` (fsbrowser.js); `planSegments` (planner.js).
- Produces: `app` (express instance, không tự listen khi require), `validateParams({keepMin,keepMax,gapMin,gapMax}): string|null`.
- Endpoints: `GET /api/health`, `POST /api/browse {path}`, `POST /api/scan {folder}`, `POST /api/process {folder,outDir,keepMin,keepMax,gapMin,gapMax}` (SSE).

- [ ] **Step 1: Viết test thất bại — `test/server.test.js`**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { validateParams } = require('../server');

test('validateParams chấp nhận tham số hợp lệ', () => {
  assert.strictEqual(validateParams({ keepMin: 3, keepMax: 5, gapMin: 0.4, gapMax: 0.5 }), null);
});

test('validateParams từ chối keepMin > keepMax', () => {
  assert.match(validateParams({ keepMin: 5, keepMax: 3, gapMin: 0.4, gapMax: 0.5 }), /Giữ min/);
});

test('validateParams từ chối gapMin > gapMax', () => {
  assert.match(validateParams({ keepMin: 3, keepMax: 5, gapMin: 0.9, gapMax: 0.5 }), /Bỏ min/);
});

test('validateParams từ chối số không hợp lệ (âm, 0, NaN, không phải số)', () => {
  assert.ok(validateParams({ keepMin: -1, keepMax: 5, gapMin: 0.4, gapMax: 0.5 }));
  assert.ok(validateParams({ keepMin: 0, keepMax: 5, gapMin: 0.4, gapMax: 0.5 }));
  assert.ok(validateParams({ keepMin: 'x', keepMax: 5, gapMin: 0.4, gapMax: 0.5 }));
  assert.ok(validateParams({ keepMin: NaN, keepMax: 5, gapMin: 0.4, gapMax: 0.5 }));
});
```

- [ ] **Step 2: Chạy test để xác nhận thất bại**

Run: `node --test test/server.test.js`
Expected: FAIL — `Cannot find module '../server'`.

- [ ] **Step 3: Viết `server.js`**

```js
'use strict';
const express = require('express');
const path = require('node:path');
const fs = require('node:fs/promises');
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
app.use(express.static(path.join(__dirname, 'public')));

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
  req.on('close', () => ac.abort());

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
    await fs.mkdir(out, { recursive: true });
    send('log', { message: `Tìm thấy ${videos.length} video. Xuất ra: ${out}` });

    let ok = 0;
    let fail = 0;
    for (let i = 0; i < videos.length; i++) {
      if (ac.signal.aborted) break;
      const v = videos[i];
      send('log', { message: `(${i + 1}/${videos.length}) Đang xử lý ${v.name}` });
      try {
        const { duration, hasAudio } = await probe(v.path);
        const segments = planSegments(duration, { keepMin, keepMax, gapMin, gapMax });
        if (!segments.length) {
          send('log', { message: `Bỏ qua ${v.name}: video quá ngắn`, level: 'warn' });
          continue;
        }
        const base = v.name.replace(/\.[^.]+$/, '');
        const outFile = path.join(out, `${base}_cut.mp4`);
        await runCut(
          { input: v.path, output: outFile, segments, hasAudio, crf: 20 },
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

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`Video Tool chạy tại http://localhost:${PORT}`));
}

module.exports = { app, validateParams };
```

- [ ] **Step 4: Chạy test để xác nhận pass**

Run: `node --test test/server.test.js`
Expected: PASS — 4 test.

- [ ] **Step 5: Chạy toàn bộ test**

Run: `node --test`
Expected: PASS — tổng tất cả test của Task 2–6.

- [ ] **Step 6: Commit**

```bash
git add server.js test/server.test.js
git commit -m "feat: server express với endpoints health/browse/scan/process (SSE)"
```

---

### Task 7: Frontend — UI shell (`index.html` + `styles.css`)

**Files:**
- Create: `public/index.html`
- Create: `public/styles.css`

**Interfaces:**
- Produces: DOM có các id mà `app.js` (Task 8) sẽ dùng: `#nav`, `#healthBanner`, `#folder`, `#btnBrowse`, `#btnScan`, `#outDir`, `#keepMin`, `#keepMax`, `#gapMin`, `#gapMax`, `#previewBody`, `#btnRun`, `#btnStop`, `#totalBar`, `#totalPct`, `#log`, `#guideToggle`, `#guideBody`, `#modal`, `#modalPath`, `#modalList`, `#modalUp`, `#modalPick`, `#modalClose`, `#placeholder`, `#cutScreen`.

- [ ] **Step 1: Viết `public/index.html`**

```html
<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Video Tool</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <div class="app">
    <aside class="sidebar">
      <div class="brand"><span class="brand-ic">🎬</span> Video Tool</div>
      <div class="menu-label">MENU</div>
      <nav id="nav">
        <button class="nav-item active" data-screen="cut">✂️ Cắt &amp; Nối Video</button>
        <button class="nav-item" data-screen="ph">✏️ Đổi tên hàng loạt</button>
        <button class="nav-item" data-screen="ph">🔄 Chuẩn hóa &amp; Fill</button>
        <button class="nav-item" data-screen="ph">🎲 Random Video</button>
        <button class="nav-item" data-screen="ph">🧩 Merge Stock Random</button>
        <button class="nav-item" data-screen="ph">↔️ Change-file</button>
        <button class="nav-item" data-screen="ph">🔽 Filter Stock</button>
        <button class="nav-item" data-screen="ph">✨ Ảnh + Video</button>
        <button class="nav-item" data-screen="ph">🖼️ Ảnh + Stock + Video</button>
        <button class="nav-item" data-screen="ph">🔧 Tách Block</button>
      </nav>
    </aside>

    <main class="content">
      <header class="topbar">
        <h1 id="screenTitle">Cắt &amp; Nối Video</h1>
        <span class="ver">v1.0</span>
      </header>

      <div id="healthBanner" class="banner hidden"></div>

      <section id="cutScreen">
        <div class="card guide">
          <button id="guideToggle" class="guide-head">
            <span>❓ Hướng dẫn sử dụng</span><span class="chev">▾</span>
          </button>
          <div id="guideBody" class="guide-body">
            <p>1. Chọn thư mục chứa video → <b>QUÉT &amp; XEM TRƯỚC</b>.</p>
            <p>2. Đặt độ dài đoạn <b>giữ</b> (mặc định 3–5s) và đoạn <b>bỏ</b> (mặc định 0.4–0.5s).</p>
            <p>3. Nhấn <b>THỰC HIỆN</b>. Mỗi video sẽ được cắt ngẫu nhiên, bỏ các khoảng ngắn rồi nối lại, xuất ra thư mục đầu ra dưới tên <code>&lt;tên&gt;_cut.mp4</code>.</p>
          </div>
        </div>

        <div class="card">
          <div class="row">
            <div class="field grow">
              <label>Thư mục video</label>
              <input id="folder" type="text" placeholder="Đường dẫn thư mục chứa video" />
            </div>
            <button id="btnBrowse" class="btn btn-ghost">📁 CHỌN THƯ MỤC</button>
          </div>
          <div class="row">
            <div class="field grow">
              <label>Thư mục xuất (để trống = &lt;thư mục video&gt;/output)</label>
              <input id="outDir" type="text" placeholder="Tự động: <thư mục video>/output" />
            </div>
            <button id="btnScan" class="btn btn-blue">🔍 QUÉT &amp; XEM TRƯỚC</button>
          </div>
          <div class="row params">
            <div class="field"><label>Giữ min (s)</label><input id="keepMin" type="number" step="0.1" min="0.1" value="3" /></div>
            <div class="field"><label>Giữ max (s)</label><input id="keepMax" type="number" step="0.1" min="0.1" value="5" /></div>
            <div class="field"><label>Bỏ min (s)</label><input id="gapMin" type="number" step="0.1" min="0.1" value="0.4" /></div>
            <div class="field"><label>Bỏ max (s)</label><input id="gapMax" type="number" step="0.1" min="0.1" value="0.5" /></div>
          </div>
        </div>

        <div class="card">
          <table class="preview">
            <thead><tr><th>#</th><th>Tên file</th><th>Dung lượng</th></tr></thead>
            <tbody id="previewBody"><tr><td colspan="3" class="empty">Chưa quét thư mục</td></tr></tbody>
          </table>
        </div>

        <div class="card action-bar">
          <div class="progress-wrap">
            <div class="progress"><div id="totalBar" class="progress-fill"></div></div>
            <span id="totalPct" class="pct">0%</span>
          </div>
          <div class="btns">
            <button id="btnRun" class="btn btn-green">✅ THỰC HIỆN</button>
            <button id="btnStop" class="btn btn-red hidden">■ DỪNG</button>
          </div>
        </div>

        <div class="card">
          <div class="log-head">🎞️ Nhật ký hoạt động</div>
          <div id="log" class="log"></div>
        </div>
      </section>

      <section id="placeholder" class="hidden">
        <div class="card placeholder">🚧 Tính năng đang phát triển.</div>
      </section>
    </main>
  </div>

  <div id="modal" class="modal-overlay hidden">
    <div class="modal">
      <div class="modal-head">
        <span>Chọn thư mục</span>
        <button id="modalClose" class="x">✕</button>
      </div>
      <div class="modal-path"><button id="modalUp" class="btn btn-ghost sm">⬆ Lên</button><span id="modalPath"></span></div>
      <ul id="modalList" class="modal-list"></ul>
      <div class="modal-foot"><button id="modalPick" class="btn btn-blue">Chọn thư mục này</button></div>
    </div>
  </div>

  <script src="app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Viết `public/styles.css`**

```css
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Segoe UI', system-ui, sans-serif; background: #0d1b2a; color: #e6edf3; height: 100vh; overflow: hidden; }
.hidden { display: none !important; }
.app { display: flex; height: 100vh; }

/* Sidebar */
.sidebar { width: 256px; background: #0a1622; border-right: 1px solid #1b2f45; padding: 18px 12px; flex-shrink: 0; overflow-y: auto; }
.brand { font-size: 20px; font-weight: 700; display: flex; align-items: center; gap: 8px; padding: 6px 8px 18px; }
.brand-ic { font-size: 22px; }
.menu-label { font-size: 11px; letter-spacing: 1px; color: #5b7089; padding: 0 8px 8px; }
.nav-item { display: block; width: 100%; text-align: left; background: none; border: none; color: #9fb3c8; padding: 11px 12px; border-radius: 8px; cursor: pointer; font-size: 14px; margin-bottom: 2px; }
.nav-item:hover { background: #132a43; color: #e6edf3; }
.nav-item.active { background: #14304d; color: #4aa3ff; font-weight: 600; }

/* Content */
.content { flex: 1; overflow-y: auto; padding: 22px 28px; }
.topbar { display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #1b2f45; padding-bottom: 16px; margin-bottom: 18px; }
.topbar h1 { font-size: 22px; }
.ver { color: #5b7089; font-size: 13px; }

/* Cards */
.card { background: #112436; border: 1px solid #1b2f45; border-radius: 12px; padding: 18px; margin-bottom: 16px; }
.row { display: flex; gap: 12px; align-items: flex-end; margin-bottom: 12px; }
.row:last-child { margin-bottom: 0; }
.params { flex-wrap: wrap; }
.field { display: flex; flex-direction: column; gap: 5px; }
.field.grow { flex: 1; }
.field label { font-size: 12px; color: #8aa0b8; }
.field input { background: #0d1b2a; border: 1px solid #274058; color: #e6edf3; border-radius: 8px; padding: 11px 12px; font-size: 14px; }
.params .field { width: 130px; }
.field input:focus { outline: none; border-color: #4aa3ff; }

/* Buttons */
.btn { border: none; border-radius: 8px; padding: 11px 16px; font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap; }
.btn.sm { padding: 7px 12px; font-size: 12px; }
.btn-blue { background: #2f6fed; color: #fff; }
.btn-green { background: #1f9d55; color: #fff; }
.btn-red { background: #d64545; color: #fff; }
.btn-ghost { background: #17324d; color: #cfe0f2; }
.btn:hover { filter: brightness(1.1); }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }

/* Guide */
.guide { padding: 0; overflow: hidden; }
.guide-head { width: 100%; display: flex; justify-content: space-between; background: none; border: none; color: #4aa3ff; padding: 16px 18px; cursor: pointer; font-size: 14px; font-weight: 600; }
.guide-body { padding: 0 18px 16px; color: #9fb3c8; font-size: 13px; line-height: 1.9; }
.guide-body code { background: #0d1b2a; padding: 2px 6px; border-radius: 4px; color: #4aa3ff; }

/* Preview table */
.preview { width: 100%; border-collapse: collapse; font-size: 13px; }
.preview th, .preview td { text-align: left; padding: 9px 10px; border-bottom: 1px solid #1b2f45; }
.preview th { color: #8aa0b8; font-weight: 600; }
.preview .empty { text-align: center; color: #5b7089; padding: 20px; }

/* Action bar */
.action-bar { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.progress-wrap { flex: 1; display: flex; align-items: center; gap: 10px; }
.progress { flex: 1; height: 10px; background: #0d1b2a; border-radius: 6px; overflow: hidden; }
.progress-fill { height: 100%; width: 0; background: #1f9d55; transition: width .2s; }
.pct { font-size: 13px; color: #9fb3c8; width: 42px; text-align: right; }
.btns { display: flex; gap: 10px; }

/* Log */
.log-head { font-weight: 600; margin-bottom: 10px; }
.log { background: #0a1622; border-radius: 8px; padding: 12px; height: 200px; overflow-y: auto; font-family: 'Consolas', monospace; font-size: 12px; line-height: 1.7; }
.log .line { white-space: pre-wrap; }
.log .error { color: #ff8a8a; }
.log .warn { color: #ffcf6b; }
.log .ok { color: #6be675; }

/* Banner */
.banner { border-radius: 10px; padding: 14px 16px; margin-bottom: 16px; font-size: 13px; }
.banner.err { background: #3a1416; border: 1px solid #d64545; color: #ffb3b3; }
.placeholder { text-align: center; color: #8aa0b8; padding: 60px; font-size: 16px; }

/* Modal */
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.6); display: flex; align-items: center; justify-content: center; z-index: 50; }
.modal { background: #112436; border: 1px solid #274058; border-radius: 12px; width: 560px; max-width: 92vw; max-height: 80vh; display: flex; flex-direction: column; }
.modal-head { display: flex; justify-content: space-between; align-items: center; padding: 14px 18px; border-bottom: 1px solid #1b2f45; font-weight: 600; }
.modal-head .x { background: none; border: none; color: #9fb3c8; font-size: 16px; cursor: pointer; }
.modal-path { display: flex; align-items: center; gap: 10px; padding: 12px 18px; font-size: 12px; color: #8aa0b8; word-break: break-all; }
.modal-list { list-style: none; overflow-y: auto; flex: 1; padding: 0 8px; }
.modal-list li { padding: 10px 12px; border-radius: 6px; cursor: pointer; font-size: 13px; }
.modal-list li:hover { background: #17324d; }
.modal-foot { padding: 14px 18px; border-top: 1px solid #1b2f45; text-align: right; }
```

- [ ] **Step 3: Xác minh HTML hiển thị**

Run: `node server.js &` rồi mở `http://localhost:3000` (hoặc `curl -s localhost:3000 | head -5`)
Expected: trang tải, thấy sidebar "Video Tool" + màn hình "Cắt & Nối Video". Dừng server sau khi xem (`kill %1`).

- [ ] **Step 4: Commit**

```bash
git add public/index.html public/styles.css
git commit -m "feat: frontend UI shell (index.html + styles dark theme)"
```

---

### Task 8: Frontend — logic (`public/app.js`)

**Files:**
- Create: `public/app.js`

**Interfaces:**
- Consumes: DOM ids từ Task 7; API `/api/health`, `/api/browse`, `/api/scan`, `/api/process`.
- Produces: hành vi tương tác đầy đủ (điều hướng menu, modal chọn thư mục, quét, chạy SSE, log, tiến trình, dừng).

- [ ] **Step 1: Viết `public/app.js`**

```js
'use strict';

const $ = (id) => document.getElementById(id);

// ---------- Điều hướng menu ----------
$('nav').addEventListener('click', (e) => {
  const btn = e.target.closest('.nav-item');
  if (!btn) return;
  document.querySelectorAll('.nav-item').forEach((n) => n.classList.remove('active'));
  btn.classList.add('active');
  const isCut = btn.dataset.screen === 'cut';
  $('cutScreen').classList.toggle('hidden', !isCut);
  $('placeholder').classList.toggle('hidden', isCut);
  $('screenTitle').textContent = btn.textContent.trim().replace(/^\S+\s/, '');
});

// ---------- Hướng dẫn collapse ----------
$('guideToggle').addEventListener('click', () => {
  $('guideBody').classList.toggle('hidden');
});

// ---------- Kiểm tra ffmpeg ----------
async function checkHealth() {
  try {
    const h = await fetch('/api/health').then((r) => r.json());
    if (!h.ffmpeg || !h.ffprobe) {
      const b = $('healthBanner');
      b.className = 'banner err';
      b.innerHTML = '⚠️ Chưa cài <b>ffmpeg/ffprobe</b>. Cài bằng: <code>sudo apt install ffmpeg</code> rồi tải lại trang.';
      $('btnRun').disabled = true;
    }
  } catch { /* bỏ qua */ }
}
checkHealth();

// ---------- Format ----------
function fmtSize(n) {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
  return (n / 1073741824).toFixed(2) + ' GB';
}

// ---------- Log ----------
function logLine(msg, level) {
  const div = document.createElement('div');
  div.className = 'line' + (level ? ' ' + level : '');
  div.textContent = msg;
  $('log').appendChild(div);
  $('log').scrollTop = $('log').scrollHeight;
}

// ---------- Quét thư mục ----------
$('btnScan').addEventListener('click', async () => {
  const folder = $('folder').value.trim();
  if (!folder) return alert('Nhập đường dẫn thư mục video');
  try {
    const res = await fetch('/api/scan', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder }),
    }).then((r) => r.json());
    if (res.error) throw new Error(res.error);
    const body = $('previewBody');
    body.innerHTML = '';
    if (!res.videos.length) {
      body.innerHTML = '<tr><td colspan="3" class="empty">Không tìm thấy video</td></tr>';
      return;
    }
    res.videos.forEach((v, i) => {
      const tr = document.createElement('tr');
      const td = (t) => { const c = document.createElement('td'); c.textContent = t; return c; };
      tr.append(td(i + 1), td(v.name), td(fmtSize(v.size)));
      body.appendChild(tr);
    });
    if (!$('outDir').value.trim()) $('outDir').placeholder = folder.replace(/\/+$/, '') + '/output';
    logLine(`Quét xong: ${res.videos.length} video.`, 'ok');
  } catch (e) {
    alert('Lỗi quét: ' + e.message);
  }
});

// ---------- Modal chọn thư mục ----------
let modalCurrent = '';
async function openModal(startPath) {
  const res = await fetch('/api/browse', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: startPath }),
  }).then((r) => r.json());
  if (res.error) return alert('Lỗi: ' + res.error);
  modalCurrent = res.current;
  $('modalPath').textContent = res.current;
  $('modalUp').dataset.path = res.parent || '';
  $('modalUp').disabled = !res.parent;
  const list = $('modalList');
  list.innerHTML = '';
  res.dirs.forEach((d) => {
    const li = document.createElement('li');
    li.textContent = '📁 ' + d.name;
    li.addEventListener('click', () => openModal(d.path));
    list.appendChild(li);
  });
  $('modal').classList.remove('hidden');
}
$('btnBrowse').addEventListener('click', () => openModal($('folder').value.trim()));
$('modalUp').addEventListener('click', () => { if ($('modalUp').dataset.path) openModal($('modalUp').dataset.path); });
$('modalClose').addEventListener('click', () => $('modal').classList.add('hidden'));
$('modalPick').addEventListener('click', () => {
  $('folder').value = modalCurrent;
  $('modal').classList.add('hidden');
});

// ---------- SSE parser ----------
function parseEvent(chunk) {
  let event = 'message';
  let data = '';
  for (const line of chunk.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data += line.slice(5).trim();
  }
  try { return { event, data: JSON.parse(data) }; } catch { return { event, data }; }
}

// ---------- Chạy xử lý ----------
let abortCtl = null;
function setTotal(pct) {
  $('totalBar').style.width = pct + '%';
  $('totalPct').textContent = pct + '%';
}

$('btnRun').addEventListener('click', async () => {
  const body = {
    folder: $('folder').value.trim(),
    outDir: $('outDir').value.trim(),
    keepMin: parseFloat($('keepMin').value),
    keepMax: parseFloat($('keepMax').value),
    gapMin: parseFloat($('gapMin').value),
    gapMax: parseFloat($('gapMax').value),
  };
  if (!body.folder) return alert('Nhập đường dẫn thư mục video');

  $('btnRun').disabled = true;
  $('btnStop').classList.remove('hidden');
  $('log').innerHTML = '';
  setTotal(0);
  abortCtl = new AbortController();

  try {
    const resp = await fetch('/api/process', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: abortCtl.signal,
    });
    if (!resp.ok) {
      const j = await resp.json().catch(() => ({}));
      throw new Error(j.error || 'Lỗi máy chủ');
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let total = 1;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const { event, data } = parseEvent(chunk);
        if (event === 'log') logLine(data.message, data.level);
        else if (event === 'progress') {
          total = data.total || 1;
          const pct = Math.round(((data.index + data.pct) / total) * 100);
          setTotal(Math.min(100, pct));
        } else if (event === 'file-done') {
          logLine(`✔ Xong ${data.file} (${data.segments} đoạn) → ${data.output}`, 'ok');
        } else if (event === 'done') {
          setTotal(100);
          logLine(`HOÀN TẤT: thành công ${data.ok}, lỗi ${data.fail}. Xuất tại: ${data.outDir}`, 'ok');
        } else if (event === 'error') {
          logLine('LỖI: ' + data.message, 'error');
        }
      }
    }
  } catch (e) {
    if (e.name === 'AbortError') logLine('Đã dừng.', 'warn');
    else logLine('LỖI: ' + e.message, 'error');
  } finally {
    $('btnRun').disabled = false;
    $('btnStop').classList.add('hidden');
    abortCtl = null;
  }
});

$('btnStop').addEventListener('click', () => { if (abortCtl) abortCtl.abort(); });
```

- [ ] **Step 2: Xác minh tương tác cơ bản (không cần ffmpeg)**

Run: `node server.js &`
Mở `http://localhost:3000`, kiểm tra:
- Click các menu khác → hiện "Tính năng đang phát triển"; click "Cắt & Nối Video" → về màn hình chính.
- Click "CHỌN THƯ MỤC" → modal mở, duyệt được thư mục, "Lên" hoạt động.
- Nhập 1 thư mục có video → "QUÉT & XEM TRƯỚC" → bảng liệt kê video.
Dừng: `kill %1`.
Expected: các tương tác hoạt động; nếu chưa cài ffmpeg thấy banner đỏ cảnh báo.

- [ ] **Step 3: Commit**

```bash
git add public/app.js
git commit -m "feat: frontend logic (nav, modal, scan, SSE xử lý, tiến trình)"
```

---

### Task 9: Xác minh end-to-end với ffmpeg thật

**Files:** không tạo file mới (kiểm thử tích hợp thủ công).

**Interfaces:**
- Consumes: toàn bộ hệ thống Task 1–8.

- [ ] **Step 1: Cài ffmpeg (nếu chưa có)**

Run: `ffmpeg -version || sudo apt-get update && sudo apt-get install -y ffmpeg`
Expected: `ffmpeg version ...`. Nếu không có quyền sudo → báo người dùng cài thủ công rồi dừng task này.

- [ ] **Step 2: Tạo video test**

```bash
mkdir -p /tmp/vt-in
ffmpeg -y -f lavfi -i testsrc=duration=30:size=640x360:rate=30 \
  -f lavfi -i sine=frequency=440:duration=30 \
  -c:v libx264 -c:a aac -shortest /tmp/vt-in/test1.mp4
ffmpeg -y -f lavfi -i testsrc=duration=20:size=640x360:rate=30 \
  /tmp/vt-in/test2_noaudio.mp4
```
Expected: 2 file trong `/tmp/vt-in` (một có audio, một không).

- [ ] **Step 3: Chạy server và xử lý end-to-end**

Run: `node server.js &`
Mở `http://localhost:3000`, nhập `folder=/tmp/vt-in`, giữ mặc định tham số, nhấn QUÉT rồi THỰC HIỆN.
Expected: log chạy tới `HOÀN TẤT: thành công 2, lỗi 0`; thanh tiến trình đạt 100%.

- [ ] **Step 4: Kiểm tra file xuất**

```bash
ls -la /tmp/vt-in/output/
ffprobe -v error -show_entries format=duration -of csv=p=0 /tmp/vt-in/output/test1_cut.mp4
ffprobe -v error -show_entries format=duration -of csv=p=0 /tmp/vt-in/output/test2_noaudio_cut.mp4
```
Expected: có `test1_cut.mp4` và `test2_noaudio_cut.mp4`; thời lượng mỗi file **ngắn hơn** bản gốc (do đã bỏ các khoảng 0.4–0.5s) và > 0. Phát thử để xác nhận không đứng hình. Dừng server: `kill %1`.

- [ ] **Step 5: Chạy lại toàn bộ unit test**

Run: `node --test`
Expected: PASS toàn bộ.

- [ ] **Step 6: Commit tài liệu chạy (README)**

Tạo `README.md`:
```markdown
# Video Tool

Web app cắt & nối video bằng ffmpeg.

## Yêu cầu
- Node.js 20+
- ffmpeg + ffprobe (`sudo apt install ffmpeg`)

## Chạy
```bash
npm install
npm start
# mở http://localhost:3000
```

## Tính năng Cắt & Nối Video
Cắt mỗi video thành các đoạn ngẫu nhiên (mặc định 3–5s), bỏ khoảng ngắn (mặc định 0.4–0.5s) giữa các đoạn, rồi nối lại và xuất ra `<thư mục>/output/<tên>_cut.mp4`.
```

```bash
git add README.md
git commit -m "docs: README hướng dẫn cài đặt và sử dụng"
```

---

## Self-Review

**Spec coverage:**
- §3 Kiến trúc → Task 1, 6, 7, 8 ✓
- §4 Thuật toán cắt → Task 2 (planner) ✓
- §5 Dựng lệnh ffmpeg (select/aselect, setpts=N/FRAME_RATE/TB) → Task 5 ✓
- §6 API (health/browse/scan/process SSE, validate, mkdir output) → Task 6 ✓
- §7 Frontend (sidebar 9 mục + mục mới, health banner, modal, preview, progress, log, placeholder) → Task 7, 8 ✓
- §8 Xử lý lỗi (thiếu ffmpeg, thư mục rỗng, file lỗi tiếp tục, validate, hủy SSE→kill) → Task 5 (signal), 6, 8 ✓
- §9 Kiểm thử (planner unit, ffmpeg builder unit, tích hợp thủ công, API) → Task 2, 5, 6, 9 ✓
- §10 YAGNI → các menu khác chỉ placeholder (Task 7, 8) ✓

**Placeholder scan:** Không có TODO/TBD trong code.

**Type consistency:**
- `planSegments(duration, opts, rng)` — dùng nhất quán Task 2 → Task 6.
- `buildArgs({input,output,segments,hasAudio,crf})` — Task 5 định nghĩa, Task 5 `runCut` + test dùng đúng.
- `runCut(opts, {onProgress, signal})` — Task 5 định nghĩa, Task 6 gọi đúng chữ ký.
- SSE events `log|progress|file-done|done|error` — server (Task 6) phát, app.js (Task 8) xử lý khớp tên.
- DOM ids khai báo ở Task 7 khớp với truy cập trong Task 8.
