'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

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

function runCut(opts, { onProgress, signal } = {}) {
  return new Promise((resolve, reject) => {
    const args = buildArgs(opts);
    const totalKeep = opts.segments.reduce((a, [s, e]) => a + (e - s), 0);
    const p = spawn(resolveBinary('ffmpeg'), args, { signal });
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

module.exports = { buildSelectExpr, buildArgs, validFps, resolveBinary, checkFfmpeg, probe, runCut };
