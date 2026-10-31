'use strict';
require('../i18n').configure(() => 'ru', () => 'en');
const assert = require('node:assert/strict');
const Module = require('node:module');
class Emitter {
  constructor() {
    this.listeners = new Set();
    this.event = fn => { this.listeners.add(fn); return { dispose: () => this.listeners.delete(fn) }; };
  }
  fire(e) { for (const fn of [...this.listeners]) fn(e); }
  dispose() { this.listeners.clear(); }
}
class Uri {
  constructor({ scheme, authority, path }) { Object.assign(this, { scheme, authority, path }); }
  toString() { return `${this.scheme}://${this.authority}${this.path}`; }
  static from(value) { return new Uri(value); }
  static parse(value) { const u = new URL(value); return new Uri({ scheme: u.protocol.slice(0, -1), authority: u.host, path: u.pathname }); }
}
class TabInputCustom { constructor(uri, viewType) { Object.assign(this, { uri, viewType }); } }
class TabInputTerminal {}
const config = { generateTitles: true };
const tabEvents = new Emitter(), groupEvents = new Emitter(), calls = [];
const disposable = () => ({ dispose() {} });
const vscode = {
  EventEmitter: Emitter, Uri, TabInputCustom, TabInputTerminal, ViewColumn: { Active: -1, Beside: -2 },
  workspace: { workspaceFolders: [{ uri: { fsPath: '/fixture/project' } }], getConfiguration: () => ({ get: (key, fallback) => config[key] ?? fallback }) },
  commands: { registerCommand: disposable, executeCommand: async (name, ...args) => { calls.push({ name, args }); } },
  window: {
    tabGroups: { all: [], activeTabGroup: {}, onDidChangeTabs: tabEvents.event, onDidChangeTabGroups: groupEvents.event },
    createTreeView: () => ({ description: '', visible: false, onDidChangeVisibility: disposable, dispose() {} }),
    registerWebviewViewProvider: disposable,
  },
};
const originalLoad = Module._load;
Module._load = function(name, ...rest) { return name === 'vscode' ? vscode : originalLoad.call(this, name, ...rest); };
let SessionTabs, Sidebar, SessionTitles;
try {
  ({ SessionTabs } = require('../session-tabs'));
  ({ Sidebar } = require('../sidebar'));
  ({ SessionTitles } = require('../session-titles'));
} finally { Module._load = originalLoad; }
function context() {
  const state = () => {
    const map = new Map();
    return { get: (key, fallback) => map.has(key) ? map.get(key) : fallback, update: async (key, value) => { map.set(key, value); } };
  };
  return { workspaceState: state(), globalState: state() };
}
const uri = id => Uri.from({ scheme: 'openai-codex', authority: 'route', path: '/local/' + id });
const native = id => ({ label: id, input: new TabInputCustom(uri(id), 'chatgpt.conversationEditor') });
const emptyTerminals = { onDidChange: disposable, recordForTab: () => undefined, openTabs: () => [] };
const defer = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
async function modes() {
  let terminalOpens = 0, nativeActivations = 0;
  const tab = native('running'), group = { viewColumn: 2, tabs: [tab], activeTab: tab };
  vscode.window.tabGroups.all = [group]; vscode.window.tabGroups.activeTabGroup = group;
  const terminals = { ...emptyTerminals, enabled: true, live: new Map(), open: async () => { terminalOpens++; } };
  const tabs = new SessionTabs(context(), terminals, async () => { nativeActivations++; });
  try {
    await tabs.open('running', true);
    assert.equal(terminalOpens, 0);
    assert.equal(nativeActivations, 1);
    assert.equal(calls.filter(c => c.name === 'vscode.openWith').at(-1).args[2].viewColumn, 2);
    group.tabs = []; group.activeTab = undefined;
    terminals.enabled = false;
    terminals.live.set('running', {});
    await tabs.reveal(uri('running'));
    assert.equal(terminalOpens, 1, 'Live terminals in the panel are reused even in native mode');
    assert.equal(nativeActivations, 1);
    terminals.live.clear(); terminals.enabled = true;
    await tabs.open('closed');
    assert.equal(terminalOpens, 2, 'Closed sessions use the selected terminal mode');
    const activation = defer(); terminals.enabled = false;
    tabs.ensureNative = () => activation.promise;
    const first = tabs.open('race');
    terminals.enabled = true;
    const second = tabs.open('race');
    activation.resolve(); await Promise.all([first, second]);
    assert.equal(terminalOpens, 2, 'A mode change during native activation cannot launch a second owner');
    assert.equal(calls.filter(c => c.name === 'vscode.openWith' && c.args[0].path.endsWith('/race')).length, 1);
    await assert.rejects(tabs.open('../invalid'), /идентификатор/);
  } finally { tabs.dispose(); vscode.window.tabGroups.all = []; vscode.window.tabGroups.activeTabGroup = {}; }
}
function sidebar(list) {
  const changes = new Emitter(), snapshots = [];
  const tabs = { filterProject: false, pins: [], openTabs: () => [], onDidChange: changes.event };
  const side = new Sidebar(context(), tabs, async () => ({ list, rateLimits: async () => ({}), dispose() {} }),
    { scheduleTitles: data => snapshots.push(data), onTitleChange: disposable }, error => { throw error; });
  return { side, tabs, changes, snapshots };
}
async function pages() {
  let fail = false, revision = 0;
  const page = start => Array.from({ length: 100 }, (_, n) => ({ id: String(start + n), name: `title-${revision}`, cwd: '/fixture/project' }));
  const { side } = sidebar(async ({ cursor }) => {
    if (cursor && fail) throw Error('Second page unavailable');
    return { data: page(cursor ? 100 : 0), nextCursor: cursor ? null : 'next-page' };
  });
  try {
    await side.refresh(); await side.refresh(true);
    assert.equal(side.threads.length, 200);
    revision++;
    await side.refresh();
    assert.equal(side.threads.length, 200);
    assert.equal(side.cursor, null);
    assert.ok(side.threads.every(t => t.name === 'title-1'), 'All loaded pages are refreshed');
    fail = true; revision++;
    await side.refresh();
    assert.equal(side.threads.length, 200, 'Partial failures preserve the complete previous snapshot');
    assert.ok(side.threads.every(t => t.name === 'title-1'));
    assert.match(side.historyError, /Second page/);
  } finally { side.dispose(); }
}
async function scopeRace() {
  const oldResponse = defer(), scopes = [];
  const { side, tabs, changes, snapshots } = sidebar(async ({ cwd, cursor }) => {
    scopes.push({ cwd, cursor });
    if (!cwd) return oldResponse.promise;
    return { data: [{ id: 'project-chat', name: 'Project', cwd: cwd[0] }], nextCursor: null };
  });
  try {
    const initial = side.refresh(); await tick();
    tabs.filterProject = true; changes.fire();
    oldResponse.resolve({ data: [{ id: 'old-scope', name: 'Other', cwd: '/other' }], nextCursor: 'old-cursor' });
    await initial;
    assert.equal(scopes.length, 2);
    assert.deepEqual(scopes[1], { cwd: ['/fixture/project'], cursor: null });
    assert.deepEqual(side.threads.map(t => t.id), ['project-chat']);
    assert.equal(side.cursor, null);
    assert.equal(side.loadedPages, 1);
    assert.equal(snapshots.length, 1, 'Stale history must not trigger automatic titles');
    assert.equal(side.sessionRoots().find(node => node.kind === 'scope').label, 'Этот проект');
  } finally { side.dispose(); changes.dispose(); }
}
async function queuedMore() {
  const firstResponse = defer(); let requests = 0;
  const { side } = sidebar(async ({ cursor }) => {
    if (++requests === 1) return firstResponse.promise;
    return cursor ? { data: [{ id: 'older' }], nextCursor: null } : { data: [{ id: 'latest' }], nextCursor: 'next' };
  });
  try {
    const first = side.refresh(); await tick();
    const more = side.refresh(true), again = side.refresh();
    firstResponse.resolve({ data: [{ id: 'latest' }], nextCursor: 'next' });
    await Promise.all([first, more, again]);
    assert.deepEqual(side.threads.map(t => t.id), ['latest', 'older']);
    assert.equal(side.loadedPages, 2);
  } finally { side.dispose(); }
}
async function titleSync() {
  let clients = 0;
  const record = { id: 'named', thread: { name: 'Old' } };
  const terminals = { records: [record], updateTitle: async (_, name) => { record.thread.name = name; } };
  const manager = new SessionTitles(context(), terminals, { pins: [], openTabs: () => [], changed: { fire() {} } },
    async () => { clients++; throw Error('No model request expected'); }, () => {});
  try {
    manager.schedule([{ id: 'named', name: 'Server rename' }]); await manager.background;
    assert.equal(record.thread.name, 'Server rename');
    config.generateTitles = false;
    manager.schedule([{ id: 'named', name: 'Another rename' }]); await manager.background;
    assert.equal(record.thread.name, 'Another rename');
    assert.equal(clients, 0);
    manager.recentManual.set('named', { name: 'Manual wins', changedAt: 20 });
    manager.schedule([{ id: 'named', name: 'Stale' }], 10); await manager.background;
    assert.equal(record.thread.name, 'Manual wins');
  } finally { manager.dispose(); config.generateTitles = true; }
}
async function restore() {
  const manifest = require('../package.json');
  assert.ok(manifest.contributes.keybindings.every(k => ![k.key, k.mac].some(value => /shift\+t$/i.test(value))), 'VS Code owns the mixed editor history shortcut');
  const tabs = new SessionTabs(context(), emptyTerminals);
  try {
    tabEvents.fire({ closed: [native('older')], opened: [], changed: [] });
    tabEvents.fire({ closed: [{ label: 'ordinary.txt', input: {} }], opened: [], changed: [] });
    tabEvents.fire({ closed: [native('latest')], opened: [], changed: [] });
    assert.equal(await tabs.reopen(), true, 'The dedicated Codex menu still restores sessions');
    assert.equal(calls.filter(c => c.name === 'vscode.openWith').at(-1).args[0].toString(), uri('latest').toString());
    assert.equal(tabs.closed[0].uri, uri('older').toString());
    assert.ok(!calls.some(c => c.name === 'setContext' && c.args[0] === 'codexSessionTabs.lastClosedWasSession'));
  } finally { tabs.dispose(); }
}
async function windowsSidebar() {
  const folders = vscode.workspace.workspaceFolders;
  const { side, tabs } = sidebar(async () => ({ data: [], nextCursor: null }));
  try {
    vscode.workspace.workspaceFolders = ['c:\\Work\\Project', 'D:\\Other'].map(fsPath => ({ uri: { fsPath } }));
    tabs.filterProject = true;
    tabs.pins = [{ id: 'pinned-windows', name: 'Pinned', cwd: '\\\\?\\C:\\WORK\\Project\\' }];
    side.threads = [{ id: 'windows', name: 'Windows', cwd: 'C:/work/project/' },
      { id: 'second-root', name: 'Other', cwd: 'd:/OTHER' },
      { id: 'neighbor', name: 'Neighbor', cwd: 'C:/work/project-old' }];
    const ids = side.sessionRoots().flatMap(root => root.children || []).map(node => node.thread?.id);
    assert.deepEqual(ids.sort(), ['pinned-windows', 'second-root', 'windows']);
  } finally { vscode.workspace.workspaceFolders = folders; side.dispose(); }
}
async function projectGroups() {
  const { side, tabs } = sidebar(async () => ({ data: [], nextCursor: null }));
  const contentRoots = () => side.sessionRoots().filter(node => node.kind !== 'scope');
  const { groupProjects } = require('../session-projects');
  const threads = [
    { id: 'old-a', name: 'Old A', cwd: 'C:\\Work\\App', updatedAt: 10 },
    { id: 'new-b', name: 'New B', cwd: 'D:/Other/App/', updatedAt: 30 },
    { id: 'new-a', name: 'New A', cwd: '\\\\?\\c:\\WORK\\APP\\', updatedAt: 20 },
    { id: 'no-project', name: 'No folder', updatedAt: 5 },
    { id: 'posix-upper', name: 'Upper', cwd: '/work/App', updatedAt: 2 },
    { id: 'posix-lower', name: 'Lower', cwd: '/work/app', updatedAt: 1 },
  ];
  try {
    const projects = groupProjects(threads);
    assert.deepEqual(projects.map(p => p.threads.map(t => t.id)),
      [['new-b'], ['new-a', 'old-a'], ['no-project'], ['posix-upper'], ['posix-lower']]);
    assert.equal(new Set(projects.map(p => p.label)).size, projects.length, 'Same-named folders remain distinguishable');
    assert.equal(projects[2].label, 'Без проекта');
    assert.equal(threads[0].id, 'old-a', 'Rendering does not mutate the loaded history');
    side.threads = threads;
    let roots = contentRoots();
    assert.deepEqual(roots.map(root => root.children.map(node => node.thread.id)),
      projects.map(p => p.threads.map(t => t.id)));
    const stable = roots.find(root => root.children.some(node => node.thread.id === 'old-a')).id;
    side.threads = [{ id: 'latest-a', name: 'Latest A', cwd: 'C:/Work/App', updatedAt: 40 }, ...threads];
    roots = contentRoots();
    assert.equal(roots[0].id, stable, 'Project expansion identity survives resorting and path spellings');
    assert.equal(roots[0].children[0].thread.id, 'latest-a');
    side.query = 'Old A';
    roots = contentRoots().filter(root => root.children);
    assert.equal(roots.length, 1);
    assert.deepEqual(roots[0].children.map(node => node.thread.id), ['old-a']);
    side.query = '';
    tabs.pins = [threads[0]];
    tabs.openTabs = () => [{ id: 'new-b', label: 'New B', thread: threads[1] }];
    roots = contentRoots();
    assert.equal(roots[0].label, 'Открытые');
    assert.equal(roots[1].label, 'Закреплённые');
    const ids = roots.flatMap(root => root.children || []).map(node => node.thread.id);
    assert.equal(new Set(ids).size, ids.length, 'Open and pinned sessions are not duplicated under projects');
    tabs.filterProject = true;
    side.threads = [{ id: 'today', cwd: '/fixture/project', name: 'Today', updatedAt: Date.now() / 1000 }];
    assert.ok(side.sessionRoots().some(root => root.label === 'Сегодня'));
    assert.ok(side.sessionRoots().every(root => !root.project), 'Single-project mode retains date groups');
  } finally { side.dispose(); }
}
(async () => {
  for (const test of [modes, pages, scopeRace, queuedMore, titleSync, restore, windowsSidebar, projectGroups]) { await test(); console.log(`PASS: ${test.name}`); }
})().catch(error => { console.error(error); process.exitCode = 1; });
