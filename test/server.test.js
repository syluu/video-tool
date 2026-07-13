'use strict';
const test = require('node:test');
const assert = require('node:assert');
const net = require('node:net');
const { validateParams, browserOpenCommand, listenWithFallback, app } = require('../server');

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

test('browserOpenCommand đúng cho từng nền tảng', () => {
  assert.deepStrictEqual(browserOpenCommand('http://x', 'win32'), { cmd: 'cmd', args: ['/c', 'start', '', 'http://x'] });
  assert.deepStrictEqual(browserOpenCommand('http://x', 'darwin'), { cmd: 'open', args: ['http://x'] });
  assert.deepStrictEqual(browserOpenCommand('http://x', 'linux'), { cmd: 'xdg-open', args: ['http://x'] });
});

test('listenWithFallback nhảy sang cổng kế tiếp khi cổng bận', async () => {
  const base = 53997;
  const blocker = net.createServer();
  await new Promise((r) => blocker.listen(base, r));
  const { server, port } = await listenWithFallback(app, base, 5);
  assert.strictEqual(port, base + 1);
  await new Promise((r) => server.close(r));
  await new Promise((r) => blocker.close(r));
});
