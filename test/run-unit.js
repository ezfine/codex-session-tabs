'use strict';
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Keep live account/IDE/model tests outside the default portable test suite.
for (const file of ['usage.js', 'smart-titles.js', 'regressions.js', 'project-paths.js', 'i18n.js']) {
  const result = spawnSync(process.execPath, [path.join(__dirname, file)], { stdio: 'inherit' });
  if (result.error) { console.error(result.error.message); process.exit(1); }
  if (result.status !== 0) process.exit(result.status || 1);
}
