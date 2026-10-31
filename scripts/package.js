'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const manifest = require('../package.json');
const root = path.resolve(__dirname, '..');
const destination = path.join(root, 'dist', `${manifest.name}-${manifest.version}-win32-x64.vsix`);
fs.mkdirSync(path.dirname(destination), { recursive: true });
const result = spawnSync(process.execPath, [require.resolve('@vscode/vsce/vsce'), 'package',
  '--no-dependencies', '--target', 'win32-x64', '--out', destination], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
