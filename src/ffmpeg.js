'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

// Xác định đường dẫn binary ffmpeg/ffprobe theo thứ tự ưu tiên:
//   1. Biến môi trường FFMPEG_PATH / FFPROBE_PATH
//   2. Khi đã đóng gói (pkg): file ffmpeg(.exe) nằm CẠNH file thực thi
//   3. Fallback: tên trần "ffmpeg"/"ffprobe" (dựa vào PATH của hệ thống)
// Các phụ thuộc được truyền vào để dễ unit test.
function resolveBinary(name, opts = {}) {
  const {
    env = process.env,
    platform = process.platform,
    isPackaged = Boolean(process.pkg),
    execDir = path.dirname(process.execPath),
    exists = (p) => { try { return fs.existsSync(p); } catch { return false; } },
  } = opts;
  const envVal = env[`${name.toUpperCase()}_PATH`];
  if (envVal) return envVal;
  if (isPackaged) {
    const suffix = platform === 'win32' ? '.exe' : '';
    const candidate = path.join(execDir, name + suffix);
    if (exists(candidate)) return candidate;
  }
  return name;
}

function buildSelectExpr(segments) {
  return segments.map(([s, e]) => `between(t,${s},${e})`).join('+');
}

// Trả về chuỗi "num/den" hợp lệ (>0) hoặc null. Dùng cho r_frame_rate của ffprobe.
function validFps(s) {
  if (!s || typeof s !== 'string') return null;
  const m = s.match(/^(\d+)\/(\d+)$/);
  if (!m) return null;
  const num = Number(m[1]);
  const den = Number(m[2]);
  if (num <= 0 || den <= 0) return null;
  return s;
}

function buildArgs({ input, output, segments, hasAudio, fps, crf = 20 }) {
  const expr = buildSelectExpr(segments);
  const args = ['-y', '-i', input, '-vf', `select='${expr}',setpts=N/FRAME_RATE/TB`];
  if (hasAudio) {
    args.push('-af', `aselect='${expr}',asetpts=N/SR/TB`);
  }
  args.push('-c:v', 'libx264', '-crf', String(crf), '-preset', 'veryfast');
  // Ép frame rate đầu ra = frame rate gốc. Nếu bỏ, ffmpeg tự chọn fps sau khi
  // setpts đánh số lại và sẽ DROP frame (ví dụ 30fps -> 25fps). Xem Task 9.
  if (fps) {
    args.push('-r', String(fps));
  }
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
  const [ff, fp] = await Promise.all([
    checkBinary(resolveBinary('ffmpeg')),
    checkBinary(resolveBinary('ffprobe')),
  ]);
  return { ffmpeg: ff.ok, ffprobe: fp.ok, version: ff.version };
}

function probe(file) {
  return new Promise((resolve, reject) => {
    const args = ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,r_frame_rate', '-of', 'json', file];
    const p = spawn(resolveBinary('ffprobe'), args);
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error(err.trim() || `ffprobe thoát mã ${code}`));
      try {
        const json = JSON.parse(out);
        const streams = json.streams || [];
        const duration = parseFloat(json.format && json.format.duration);
        const hasAudio = streams.some((s) => s.codec_type === 'audio');
        const vStream = streams.find((s) => s.codec_type === 'video');
        const fps = validFps(vStream && vStream.r_frame_rate);
        if (!Number.isFinite(duration)) return reject(new Error('Không đọc được thời lượng video'));
        resolve({ duration, hasAudio, fps });
      } catch (e) {
        reject(e);
      }
    });
  });
}

// Số lượng segment tối đa trong mỗi batch FFmpeg. Giữ đủ nhỏ để biểu thức
// select filter không vượt giới hạn parser/memory của FFmpeg.
const MAX_BATCH_SIZE = 40;

// Chạy 1 lần FFmpeg cho 1 nhóm segments (dùng nội bộ).
function _runSingle(opts, { onProgress, signal, totalKeep } = {}) {
  return new Promise((resolve, reject) => {
    const args = buildArgs(opts);
    const keep = totalKeep ?? opts.segments.reduce((a, [s, e]) => a + (e - s), 0);
    const p = spawn(resolveBinary('ffmpeg'), args, { signal });
    let err = '';
    p.stderr.on('data', (d) => {
      const s = d.toString();
      err += s;
      const m = s.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (m && onProgress && keep > 0) {
        const t = (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
        onProgress(Math.min(1, t / keep));
      }
    });
    p.on('error', reject);
    p.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(err.split('\n').filter(Boolean).slice(-4).join(' | ') || `ffmpeg thoát mã ${code}`));
    });
  });
}

// Ghép nhiều file mp4 bằng concat demuxer.
function _concatFiles(inputs, output, { signal } = {}) {
  return new Promise((resolve, reject) => {
    // Tạo file danh sách tạm cho concat demuxer
    const listFile = output + '.concat.txt';
    const content = inputs.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n');
    fs.writeFileSync(listFile, content);
    const args = ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', output];
    const p = spawn(resolveBinary('ffmpeg'), args, { signal });
    let err = '';
    p.stderr.on('data', (d) => { err += d.toString(); });
    p.on('error', (e) => { tryUnlink(listFile); reject(e); });
    p.on('close', (code) => {
      tryUnlink(listFile);
      if (code === 0) resolve();
      else reject(new Error(err.split('\n').filter(Boolean).slice(-4).join(' | ') || `ffmpeg concat thoát mã ${code}`));
    });
  });
}

function tryUnlink(filePath) {
  try { fs.unlinkSync(filePath); } catch { /* ignore */ }
}

// Chia mảng thành các nhóm nhỏ.
function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/**
 * Cắt video: nếu ≤ MAX_BATCH_SIZE segments thì chạy trực tiếp,
 * nếu nhiều hơn thì chia batch, xử lý từng batch thành file tạm rồi concat.
 */
async function runCut(opts, { onProgress, signal } = {}) {
  const { segments } = opts;
  if (segments.length <= MAX_BATCH_SIZE) {
    // Trường hợp bình thường — chạy thẳng 1 lệnh FFmpeg.
    return _runSingle(opts, { onProgress, signal });
  }

  // --- Chia batch cho video dài ---
  const batches = chunkArray(segments, MAX_BATCH_SIZE);
  const totalKeep = segments.reduce((a, [s, e]) => a + (e - s), 0);
  let accumulated = 0; // thời lượng đã xử lý xong (tính progress tổng)
  const tempFiles = [];

  try {
    for (let bi = 0; bi < batches.length; bi++) {
      if (signal && signal.aborted) break;
      const batch = batches[bi];
      const batchKeep = batch.reduce((a, [s, e]) => a + (e - s), 0);
      const tempFile = opts.output + `.part${bi}.mp4`;
      tempFiles.push(tempFile);

      const batchAccum = accumulated; // capture cho closure
      await _runSingle(
        { ...opts, output: tempFile, segments: batch },
        {
          signal,
          onProgress: onProgress
            ? (batchPct) => {
                const done = batchAccum + batchPct * batchKeep;
                onProgress(Math.min(1, done / totalKeep));
              }
            : undefined,
          totalKeep: batchKeep,
        }
      );
      accumulated += batchKeep;
    }

    // Ghép các file tạm thành file cuối
    await _concatFiles(tempFiles, opts.output, { signal });
  } finally {
    // Dọn file tạm
    for (const f of tempFiles) tryUnlink(f);
  }
}

module.exports = { buildSelectExpr, buildArgs, validFps, resolveBinary, checkFfmpeg, probe, runCut, MAX_BATCH_SIZE, chunkArray, _runSingle, _concatFiles };
