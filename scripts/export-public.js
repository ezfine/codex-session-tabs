'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
if (!process.argv[2]) throw Error('Usage: node scripts/export-public.js <new-empty-directory>');
const target = path.resolve(process.argv[2]);
if (target === root || fs.existsSync(target) && fs.readdirSync(target).length) throw Error('Destination must be a new or empty directory');
const files = [
  'package.json', 'package-lock.json', 'package.nls.json', 'package.nls.ru.json', 'i18n.ru.json',
  'README.md', 'README.ru.md', 'CHANGELOG.md', 'PRIVACY.md', 'LICENSE', '.vscodeignore', '.gitattributes',
  'extension.js', 'app-server.js', 'i18n.js', 'project-paths.js', 'session-projects.js', 'session-tabs.js',
  'session-titles.js', 'sidebar.js', 'terminal-sessions.js', 'title-generator.js', 'usage.js', 'usage-view.js',
  'resources/icon.png', 'resources/icon-source.svg', 'resources/session-tabs.svg',
  'resources/screenshots/sidebar-dark.png', 'resources/screenshots/sidebar-light.png',
  'docs/development.md', 'docs/release-check.md', '.vscode/launch.json', '.github/workflows/check.yml',
  'scripts/build-icon.js', 'scripts/package.js', 'scripts/verify-package.js', 'scripts/export-public.js',
  ...['run-unit.js', 'usage.js', 'smart-titles.js', 'regressions.js', 'project-paths.js', 'i18n.js',
    'extension-id.js', 'run-windows.js', 'windows-vscode.js', 'verify-ui.mjs', 'verify-live-input.mjs',
    'review-sidebar.mjs', 'sidebar-review-vscode.js'].map(file => 'test/' + file),
];
for (const file of files) {
  const source = path.join(root, file), output = path.join(target, file);
  const data = fs.readFileSync(source);
  if (/\.(?:js|mjs|json|md|yml)$/.test(file) && /\b192\.168\.\d+\.\d+|[A-Z]:\\Users\\[^\\/\s]+|-----BEGIN (?:OPENSSH|RSA|EC) PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{20,}/i.test(data.toString('utf8'))) {
    throw Error('Internal metadata in public file: ' + file);
  }
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, data);
}
fs.writeFileSync(path.join(target, '.gitignore'), 'node_modules/\ndist/\npreviews/\n*.vsix\n*.log\n.env\n.env.*\nbackups/\n');
fs.writeFileSync(path.join(target, 'AGENTS.md'), '# ThreadShelf for Codex\n\nUse English for code and comments. Check git status before editing. Read docs/development.md.\n\nRun npm test for standalone checks. Authenticated integration tests must use separate profiles and their own conversations. Live tests consume account allowance. Never publish credentials, user profiles or private conversations. Do not modify the official Codex extension or close user chats to update titles.\n');
console.log(`Exported ${files.length + 2} public files to ${target}`);
