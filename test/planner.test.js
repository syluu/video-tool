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
