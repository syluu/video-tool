'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { buildSelectExpr, buildArgs, validFps, resolveBinary } = require('../src/ffmpeg');

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

test('buildArgs thêm -r khi có fps (ép frame rate gốc)', () => {
  const args = buildArgs({ input: 'i', output: 'o', segments: [[0, 1]], hasAudio: false, fps: '30/1' });
  assert.strictEqual(args[args.indexOf('-r') + 1], '30/1');
});

test('buildArgs không thêm -r khi thiếu fps', () => {
  const args = buildArgs({ input: 'i', output: 'o', segments: [[0, 1]], hasAudio: false });
  assert.ok(!args.includes('-r'));
});

test('validFps chấp nhận num/den hợp lệ, loại bỏ 0/0 và rác', () => {
  assert.strictEqual(validFps('30/1'), '30/1');
  assert.strictEqual(validFps('30000/1001'), '30000/1001');
  assert.strictEqual(validFps('0/0'), null);
  assert.strictEqual(validFps('25'), null);
  assert.strictEqual(validFps(undefined), null);
  assert.strictEqual(validFps(null), null);
});

test('resolveBinary: biến môi trường FFMPEG_PATH được ưu tiên cao nhất', () => {
  const r = resolveBinary('ffmpeg', {
    env: { FFMPEG_PATH: '/custom/ffmpeg' }, isPackaged: true, platform: 'win32',
    execDir: '/opt/app', exists: () => true,
  });
  assert.strictEqual(r, '/custom/ffmpeg');
});

test('resolveBinary: khi đóng gói, dùng binary .exe cạnh exe nếu tồn tại', () => {
  const expected = path.join('/opt/app', 'ffmpeg.exe');
  const r = resolveBinary('ffmpeg', {
    env: {}, isPackaged: true, platform: 'win32', execDir: '/opt/app',
    exists: (p) => p === expected,
  });
  assert.strictEqual(r, expected);
});

test('resolveBinary: ffprobe dùng đúng key FFPROBE_PATH và không thêm .exe khi non-win', () => {
  const expected = path.join('/opt/app', 'ffprobe');
  const r = resolveBinary('ffprobe', {
    env: {}, isPackaged: true, platform: 'linux', execDir: '/opt/app',
    exists: (p) => p === expected,
  });
  assert.strictEqual(r, expected);
});

test('resolveBinary: không đóng gói -> trả tên trần (dựa PATH)', () => {
  assert.strictEqual(resolveBinary('ffmpeg', { env: {}, isPackaged: false }), 'ffmpeg');
});

test('resolveBinary: đóng gói nhưng không thấy file cạnh exe -> fallback PATH', () => {
  const r = resolveBinary('ffmpeg', {
    env: {}, isPackaged: true, platform: 'win32', execDir: '/opt/app', exists: () => false,
  });
  assert.strictEqual(r, 'ffmpeg');
});
