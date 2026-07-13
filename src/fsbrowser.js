'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

async function listDirs(dir) {
  const target = dir && String(dir).trim() ? path.resolve(String(dir)) : os.homedir();
  const entries = await fs.readdir(target, { withFileTypes: true });
  const dirs = entries
    .filter(e => e.isDirectory() && !e.name.startsWith('.'))
    .map(e => ({ name: e.name, path: path.join(target, e.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const parent = path.dirname(target);
  return { current: target, parent: parent === target ? null : parent, dirs };
}

module.exports = { listDirs };
