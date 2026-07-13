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
