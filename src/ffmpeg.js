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
