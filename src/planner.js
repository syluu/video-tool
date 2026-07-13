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
