'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

async function main() {
  if (process.platform !== 'win32') throw new Error('This integration runner requires Windows');
  const commands = spawnSync('where.exe', ['code'], { encoding: 'utf8', windowsHide: true });
  const code = commands.stdout?.split(/\r?\n/).filter(Boolean).map(command =>
    path.resolve(path.dirname(command), '..', 'Code.exe')).find(candidate => fs.existsSync(candidate));
  if (!code) throw new Error('VS Code was not found on PATH');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-tabs-windows-'));
  const profile = path.join(root, 'profile');
  fs.mkdirSync(path.join(profile, 'User'), { recursive: true });
  fs.writeFileSync(path.join(profile, 'User', 'settings.json'), JSON.stringify({
    'codexSessionTabs.generateTitles': false, 'codexSessionTabs.chatMode': 'native',
    'extensions.autoUpdate': false, 'extensions.autoCheckUpdates': false,
    'security.workspace.trust.enabled': false, 'workbench.startupEditor': 'none',
    'window.restoreWindows': 'none',
  }, null, 2));
  const resultFile = path.join(root, 'result.json');
  const repo = path.resolve(__dirname, '..');
  const fixtureFile = path.join(root, 'fixtures.json');
  const testEnv = { ...process.env, CODEX_TABS_TEST_RESULT: resultFile, CODEX_TABS_TEST_FIXTURES: fixtureFile };
  delete testEnv.ELECTRON_RUN_AS_NODE;
  let extensionsDir = path.join(os.homedir(), '.vscode', 'extensions');
  let developmentPath = repo;
  if (process.argv.includes('--package')) {
    const manifest = require('../package.json');
    const packed = path.join(repo, 'dist', `codex-session-tabs-${manifest.version}-win32-x64.vsix`);
    const official = JSON.parse(fs.readFileSync(path.join(extensionsDir, 'extensions.json'), 'utf8'))
      .find(entry => entry.identifier.id === 'openai.chatgpt');
    if (!official) throw Error('Install OpenAI Codex before the packaged integration test');
    const officialPath = path.join(extensionsDir, official.relativeLocation);
    extensionsDir = path.join(root, 'extensions');
    fs.mkdirSync(extensionsDir);
    fs.symlinkSync(officialPath, path.join(extensionsDir, official.relativeLocation), 'junction');
    const launcherDir = path.join(path.dirname(code), 'bin');
    const launcher = fs.readFileSync(path.join(launcherDir, 'code.cmd'), 'utf8');
    const cliPath = /"%~dp0([^"]+cli\.js)"/i.exec(launcher)?.[1];
    const cli = cliPath ? path.resolve(launcherDir, cliPath) : path.join(path.dirname(code), 'resources', 'app', 'out', 'cli.js');
    const install = spawnSync(code, [cli, '--extensions-dir', extensionsDir, '--user-data-dir', profile,
      '--install-extension', packed, '--do-not-include-pack-dependencies'], {
      env: { ...testEnv, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', windowsHide: true, timeout: 30000,
    });
    if (install.status !== 0) throw Error(install.stderr || 'Could not install the test VSIX');
    developmentPath = path.join(root, 'harness');
    fs.mkdirSync(developmentPath);
    fs.writeFileSync(path.join(developmentPath, 'package.json'), JSON.stringify({
      name: 'release-test-harness', publisher: 'test-only', version: '0.0.1', engines: { vscode: '^1.111.0' },
      main: './extension.js',
    }));
    fs.writeFileSync(path.join(developmentPath, 'extension.js'), 'exports.activate = () => {};\n');
  }
  const debugArgs = [];
  let observer;
  const live = process.argv.includes('--live');
  if (process.argv.includes('--ui') || live) {
    const server = require('node:net').createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    await new Promise(resolve => server.close(resolve));
    testEnv.CODEX_TABS_DEBUG_PORT = String(port);
    testEnv.CODEX_TABS_UI_READY_FILE = path.join(root, 'ui-ready.json');
    testEnv.CODEX_TABS_UI_SCREENSHOT = path.join(root, 'ui.png');
    if (live) testEnv.CODEX_TABS_LIVE_DIR = root;
    debugArgs.push('--remote-debugging-port=' + port);
    observer = spawn(process.execPath, [path.join(__dirname, live ? 'verify-live-input.mjs' : 'verify-ui.mjs')], {
      env: testEnv, stdio: 'ignore', windowsHide: true,
    });
  }
  const result = spawnSync(code, ['--new-window', '--user-data-dir', profile,
    '--extensions-dir', extensionsDir,
    '--extensionDevelopmentPath=' + developmentPath, '--extensionTestsPath=' + path.join(__dirname, 'windows-vscode.js'),
    '--disable-extension=local-tools.codex-session-tabs', '--skip-welcome', '--skip-release-notes', '--disable-updates', '--disable-workspace-trust', ...debugArgs, repo], {
    env: testEnv,
    windowsHide: true, encoding: 'utf8', timeout: live ? 240000 : 90000,
  });
  observer?.kill();
  console.log('Test profile and result: ' + root);
  if (fs.existsSync(fixtureFile)) {
    const fixtures = JSON.parse(fs.readFileSync(fixtureFile, 'utf8'));
    const { HistoryClient } = require('../app-server');
    const client = new HistoryClient(fixtures.binary, repo);
    try {
      await client.start();
      for (const id of fixtures.ids) {
        for (let attempt = 0; ; ++attempt) {
          try { await client.request('thread/archive', { threadId: id }); break; }
          catch (error) {
            if (attempt >= 10 || !/active writer/.test(error.message)) throw error;
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }
      }
    } finally { await client.shutdown(); }
  }
  if (fs.existsSync(resultFile)) {
    const report = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.ok && !result.error && result.status === 0 ? 0 : 1;
  } else {
    console.error(result.error?.message || result.stderr || 'VS Code exited without a test result');
    process.exitCode = 1;
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
