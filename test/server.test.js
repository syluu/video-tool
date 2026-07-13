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
