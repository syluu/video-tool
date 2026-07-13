#!/usr/bin/env node
'use strict';
// Đóng gói app thành VideoTool.exe cho Windows + kèm ffmpeg.exe/ffprobe.exe.
// Chạy: npm run build:win  (trên Linux/macOS/Windows đều cross-build được về win-x64).
// Yêu cầu: curl + unzip có trong PATH (để tải & giải nén ffmpeg Windows static).

import { spawnSync } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(root, 'dist');
const outDir = path.join(distDir, 'VideoTool-win');
const zipPath = path.join(distDir, 'ffmpeg-win.zip');
// ffmpeg Windows static (GitHub BtbN — tải nhanh). Có thể đổi qua env FFMPEG_WIN_ZIP.
// Nguồn khác (chậm hơn ở một số mạng): https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip
const FFMPEG_ZIP = process.env.FFMPEG_WIN_ZIP
  || 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip';
const PKG_TARGET = 'node20-win-x64';

function run(cmd, args) {
  console.log(`\n$ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: root });
  if (r.status !== 0) {
    console.error(`\n✗ Lệnh thất bại: ${cmd} (mã ${r.status ?? 'signal ' + r.signal})`);
    process.exit(1);
  }
}

mkdirSync(outDir, { recursive: true });

// 1) ffmpeg/ffprobe Windows static
if (existsSync(path.join(outDir, 'ffmpeg.exe')) && existsSync(path.join(outDir, 'ffprobe.exe'))) {
  console.log('• Đã có ffmpeg.exe/ffprobe.exe, bỏ qua bước tải.');
} else {
  console.log('• Tải ffmpeg Windows static...');
  run('curl', ['-L', '--fail', '--retry', '2', '-o', zipPath, FFMPEG_ZIP]);
  console.log('• Giải nén ffmpeg.exe + ffprobe.exe...');
  run('unzip', ['-j', '-o', zipPath, '*/bin/ffmpeg.exe', '*/bin/ffprobe.exe', '-d', outDir]);
}

// 2) Đóng gói exe bằng @yao-pkg/pkg (đọc pkg.assets trong package.json để nhúng public/)
const pkgBin = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'pkg.cmd' : 'pkg');
console.log('• Đóng gói VideoTool.exe...');
run(pkgBin, [path.join(root, 'server.js'), '--targets', PKG_TARGET, '--output', path.join(outDir, 'VideoTool.exe')]);

console.log(`\n✓ Xong. Thư mục giao cho người dùng: ${outDir}`);
console.log('  Gồm: VideoTool.exe, ffmpeg.exe, ffprobe.exe');
console.log('  Người dùng chỉ cần giải nén và double-click VideoTool.exe.');
