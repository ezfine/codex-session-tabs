import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const gallery = process.argv.includes('--gallery');
const repo = path.resolve(import.meta.dirname, '..');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-sidebar-review-'));
const destination = path.join(repo, 'previews', process.argv[2] || 'review');
await fs.mkdir(destination, { recursive: true });
const profile = path.join(root, 'profile');
await fs.mkdir(path.join(profile, 'User'), { recursive: true });
await fs.writeFile(path.join(profile, 'User', 'settings.json'), JSON.stringify({
  'codexSessionTabs.generateTitles': false, 'extensions.autoUpdate': false, 'extensions.autoCheckUpdates': false,
  'security.workspace.trust.enabled': false, 'workbench.startupEditor': 'none', 'window.restoreWindows': 'none',
  'window.zoomLevel': 0, 'workbench.sideBar.location': 'left',
}));
const codeCommand = spawnSync('where.exe', ['code'], { encoding: 'utf8', windowsHide: true }).stdout.trim().split(/\r?\n/)[0];
const executable = path.resolve(path.dirname(codeCommand), '..', 'Code.exe');
const extensionsDir = path.join(os.homedir(), '.vscode', 'extensions');
const installed = JSON.parse(await fs.readFile(path.join(extensionsDir, 'extensions.json'), 'utf8'));
const disabled = [...new Set(installed.map(extension => extension.identifier.id))]
  .filter(id => id.toLowerCase() !== 'mrkarmannik.codex-session-tabs').flatMap(id => ['--disable-extension', id]);
const server = net.createServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
await new Promise(resolve => server.close(resolve));
const env = { ...process.env, CODEX_TABS_REVIEW_DIR: root };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(executable, ['--new-window', '--user-data-dir', profile, '--extensions-dir', extensionsDir,
  '--extensionDevelopmentPath=' + repo, '--extensionTestsPath=' + path.join(repo, 'test/sidebar-review-vscode.js'),
  '--remote-debugging-port=' + port, '--skip-welcome', '--skip-release-notes', '--disable-updates',
  '--disable-workspace-trust', ...disabled, repo], { env, windowsHide: true, stdio: 'ignore' });
let socket, next = 0;
const pending = new Map();
const waitFor = async callback => {
  for (let n = 0; n < 200; ++n) { try { const value = await callback(); if (value) return value; } catch {} await sleep(200); }
  throw Error('Review window did not become ready');
};
try {
  const target = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json())
    .find(target => target.type === 'page' && target.url.startsWith('vscode-file:')));
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', event => {
    const response = JSON.parse(event.data);
    if (response.id) { pending.get(response.id)?.(response); pending.delete(response.id); }
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++next;
    const timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout: ' + method)); }, 5000);
    pending.set(id, response => { clearTimeout(timer); response.error ? reject(Error(response.error.message)) : resolve(response.result); });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => (await call('Runtime.evaluate', { expression, returnByValue: true })).result.value;
  const cases = [
    ['dark', 'Default Dark Modern', 'history', 340], ['light', 'Default Light Modern', 'history', 340],
    ['narrow', 'Default Dark Modern', 'history', 240], ['search-empty', 'Default Dark Modern', 'search-empty', 340],
    ['empty', 'Default Dark Modern', 'empty', 340], ['error', 'Default Dark Modern', 'error', 340],
    ['toolbar', 'Default Dark Modern', 'history', 240], ['expanded', 'Default Dark Modern', 'history', 340],
    ['search-hit', 'Default Dark Modern', 'search-hit', 340], ['project-empty', 'Default Dark Modern', 'project-empty', 340],
    ['quota-empty', 'Default Dark Modern', 'quota-empty', 340],
  ];
  const measurements = [];
  for (const [id, theme, scenario, width] of gallery ? cases.slice(0, 2) : cases) {
    await fs.writeFile(path.join(root, 'request.json'), JSON.stringify({ id, theme, scenario }));
    await waitFor(async () => JSON.parse(await fs.readFile(path.join(root, 'ready.json'), 'utf8')).id === id);
    let bounds = await evaluate('(()=>{const r=document.querySelector(".part.sidebar").getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()');
    const y = bounds.y + bounds.height / 2;
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: bounds.x + bounds.width, y, button: 'left', clickCount: 1 });
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: bounds.x + width, y, button: 'left', buttons: 1 });
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: bounds.x + width, y, button: 'left', clickCount: 1 });
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 700, y: 30 });
    if (id === 'toolbar') {
      const header = await evaluate('(()=>{const h=[...document.querySelectorAll(".pane-header")].find(e=>e.textContent.toLowerCase().includes("чаты"));const r=h.getBoundingClientRect();return {x:r.right-60,y:r.y+r.height/2}})()');
      await call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...header });
    }
    if (id === 'expanded') {
      const toggle = await evaluate('(()=>{const row=[...document.querySelectorAll(".monaco-list-row")].find(e=>e.textContent.includes("billing"));const r=row.querySelector(".monaco-tl-twistie").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');
      await call('Input.dispatchMouseEvent', { type: 'mousePressed', ...toggle, button: 'left', clickCount: 1 });
      await call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...toggle, button: 'left', clickCount: 1 });
      await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 700, y: 30 });
    }
    await sleep(700);
    bounds = await evaluate('(()=>{const r=document.querySelector(".part.sidebar").getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()');
    const shot = await call('Page.captureScreenshot', { format: 'png', clip: { ...bounds, height: gallery ? Math.min(bounds.height, 480) : bounds.height, scale: 1 } });
    await fs.writeFile(path.join(destination, id + '.png'), Buffer.from(shot.data, 'base64'));
    measurements.push({ id, ...bounds });
    console.log('Captured ' + id + ': ' + bounds.width + ' px');
    if (id === 'dark' && !gallery) {
      const scope = await evaluate('(()=>{const row=[...document.querySelectorAll(".monaco-list-row")].find(e=>e.textContent.startsWith("Все проекты"));const r=row.getBoundingClientRect();return {x:r.x+80,y:r.y+r.height/2}})()');
      await call('Input.dispatchMouseEvent', { type: 'mousePressed', ...scope, button: 'left', clickCount: 1 });
      await call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...scope, button: 'left', clickCount: 1 });
      await waitFor(() => evaluate('[...document.querySelectorAll(".monaco-list-row")].some(e=>e.textContent.startsWith("Этот проект"))'));
      await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      await waitFor(() => evaluate('[...document.querySelectorAll(".monaco-list-row")].some(e=>e.textContent.startsWith("Все проекты"))'));
      console.log('Verified scope toggle by mouse and Enter');
    }
    const action = { 'search-empty': 'Ничего не найдено', 'project-empty': 'В этом проекте пока нет чатов',
      error: 'Не удалось обновить историю' }[id];
    if (action) {
      const point = await evaluate(`(()=>{const row=[...document.querySelectorAll('.monaco-list-row')].find(e=>e.textContent.includes(${JSON.stringify(action)}));const r=row.getBoundingClientRect();return {x:r.x+80,y:r.y+r.height/2}})()`);
      await call('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
      await call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
      await waitFor(() => evaluate(`![...document.querySelectorAll('.monaco-list-row')].some(e=>e.textContent.includes(${JSON.stringify(action)}))`));
      console.log('Verified action: ' + id);
    }
  }
  await fs.writeFile(path.join(destination, 'measurements.json'), JSON.stringify(measurements, null, 2));
  console.log('Review artifacts: ' + destination);
} finally {
  await fs.writeFile(path.join(root, 'request.json'), JSON.stringify({ done: true }));
  socket?.close();
  await Promise.race([new Promise(resolve => child.once('exit', resolve)), sleep(5000)]);
  if (child.exitCode === null) child.kill();
}
