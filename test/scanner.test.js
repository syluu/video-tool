'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { scanVideos, isVideo } = require('../src/scanner');

test('isVideo nhận diện đuôi hợp lệ, không phân biệt hoa thường', () => {
  assert.ok(isVideo('a.mp4'));
  assert.ok(isVideo('B.MOV'));
  assert.ok(isVideo('c.MkV'));
  assert.ok(!isVideo('d.txt'));
  assert.ok(!isVideo('noext'));
});

test('scanVideos chỉ trả video, sắp theo tên, kèm size', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'scan-'));
  await fs.writeFile(path.join(dir, 'b.mp4'), 'xx');
  await fs.writeFile(path.join(dir, 'a.mov'), 'y');
  await fs.writeFile(path.join(dir, 'note.txt'), 'zzz');
  await fs.mkdir(path.join(dir, 'sub'));
  const vids = await scanVideos(dir);
  assert.strictEqual(vids.length, 2);
  assert.deepStrictEqual(vids.map(v => v.name), ['a.mov', 'b.mp4']);
  assert.strictEqual(vids[0].size, 1);
  assert.strictEqual(vids[1].size, 2);
  assert.strictEqual(vids[0].path, path.join(dir, 'a.mov'));
  await fs.rm(dir, { recursive: true, force: true });
});

test('scanVideos ném lỗi khi thư mục không tồn tại', async () => {
  await assert.rejects(() => scanVideos('/khong/ton/tai/xyz'));
});
