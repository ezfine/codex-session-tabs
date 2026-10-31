'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { inflateRawSync } = require('node:zlib');
const manifest = require('../package.json');
const file = process.argv[2] || path.resolve(__dirname, '..', 'dist', `codex-session-tabs-${manifest.version}-win32-x64.vsix`);
const bytes = fs.readFileSync(file);
let end = bytes.length - 22;
while (end >= Math.max(0, bytes.length - 65557) && bytes.readUInt32LE(end) !== 0x06054b50) --end;
assert.ok(end >= 0, 'ZIP directory not found');
const count = bytes.readUInt16LE(end + 10), files = new Map();
let cursor = bytes.readUInt32LE(end + 16);
for (let n = 0; n < count; ++n) {
  assert.equal(bytes.readUInt32LE(cursor), 0x02014b50);
  const method = bytes.readUInt16LE(cursor + 10), size = bytes.readUInt32LE(cursor + 20);
  const nameLength = bytes.readUInt16LE(cursor + 28), extraLength = bytes.readUInt16LE(cursor + 30), commentLength = bytes.readUInt16LE(cursor + 32);
  const offset = bytes.readUInt32LE(cursor + 42), name = bytes.toString('utf8', cursor + 46, cursor + 46 + nameLength);
  assert.equal(bytes.readUInt32LE(offset), 0x04034b50);
  const start = offset + 30 + bytes.readUInt16LE(offset + 26) + bytes.readUInt16LE(offset + 28);
  const data = bytes.subarray(start, start + size);
  assert.ok(method === 0 || method === 8, 'Unsupported ZIP compression');
  files.set(name, method === 8 ? inflateRawSync(data) : data);
  cursor += 46 + nameLength + extraLength + commentLength;
}
const runtime = ['extension.js', 'app-server.js', 'i18n.js', 'session-tabs.js', 'session-titles.js', 'sidebar.js',
  'terminal-sessions.js', 'title-generator.js', 'usage.js', 'usage-view.js', 'project-paths.js', 'session-projects.js'];
const allowed = new Set(['[Content_Types].xml', 'extension.vsixmanifest', ...runtime.map(file => 'extension/' + file),
  ...['package.json', 'package.nls.json', 'package.nls.ru.json', 'i18n.ru.json', 'README.md', 'readme.md', 'README.ru.md',
    'CHANGELOG.md', 'changelog.md', 'PRIVACY.md', 'LICENSE', 'LICENSE.txt', 'resources/icon.png', 'resources/session-tabs.svg',
    'resources/screenshots/sidebar-dark.png', 'resources/screenshots/sidebar-light.png'].map(file => 'extension/' + file)]);
for (const [name, data] of files) {
  assert.ok(allowed.has(name), 'Unexpected package file: ' + name);
  if (/\.(?:js|json|md|xml)$/.test(name)) {
    assert.ok(!/\b192\.168\.\d+\.\d+|[A-Z]:\\Users\\[^\\/\s]+|-----BEGIN (?:OPENSSH|RSA|EC) PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{20,}/i.test(data.toString('utf8')), 'Local metadata in ' + name);
  }
}
for (const file of runtime) assert.ok(files.has('extension/' + file), 'Missing runtime module: ' + file);
const packed = JSON.parse(files.get('extension/package.json'));
assert.equal(packed.publisher, 'MrKarmannik');
assert.equal(packed.version, manifest.version);
assert.equal(packed.preview, true);
assert.ok(!packed.dependencies || Object.keys(packed.dependencies).length === 0);
assert.ok(files.get('extension.vsixmanifest').toString('utf8').includes('win32-x64'));
const icon = files.get('extension/resources/icon.png');
assert.equal(icon.readUInt32BE(16), 256);
assert.equal(icon.readUInt32BE(20), 256);
console.log(`PASS: ${files.size} allowed files, Windows x64, original 256px icon, no runtime dependencies or internal artifacts`);
