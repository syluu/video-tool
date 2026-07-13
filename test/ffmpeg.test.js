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
