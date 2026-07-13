'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');

const VIDEO_EXTS = new Set(['.mp4', '.mov', '.mkv', '.avi', '.webm', '.flv', '.m4v']);

function isVideo(name) {
  return VIDEO_EXTS.has(path.extname(name).toLowerCase());
}

async function scanVideos(folder) {
  const entries = await fs.readdir(folder, { withFileTypes: true });
  const videos = [];
  for (const ent of entries) {
    if (ent.isFile() && isVideo(ent.name)) {
      const full = path.join(folder, ent.name);
      const st = await fs.stat(full);
      videos.push({ name: ent.name, path: full, size: st.size });
    }
  }
  videos.sort((a, b) => a.name.localeCompare(b.name));
  return videos;
}

module.exports = { scanVideos, isVideo, VIDEO_EXTS };
