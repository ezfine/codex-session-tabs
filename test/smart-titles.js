'use strict';
require('../i18n').configure(() => 'ru', () => 'en');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { EventEmitter } = require('node:events');
const Module = require('node:module');
const { generateTitle } = require('../title-generator');

function fakeClient(behavior = 'complete') {
  const events = new EventEmitter(), calls = [];
  const client = {
    calls, start: async () => {},
    onNotification: fn => { events.on('notification', fn); return () => events.off('notification', fn); },
    onFailure: fn => { events.on('failure', fn); return () => events.off('failure', fn); },
    async request(method, params) {
      calls.push({ method, params });
      if (method === 'config/read') return { config: { mcp_servers: { private: { command: 'never launch' } } } };
      if (method === 'thread/start') return { thread: { id: 'ephemeral', ephemeral: true } };
      if (method === 'turn/start') {
        if (behavior === 'start-error') throw new Error('Start failed');
        if (behavior === 'failure') setImmediate(() => events.emit('failure', new Error('Connection lost')));
        if (['complete', 'invalid'].includes(behavior)) setImmediate(() => {
          events.emit('notification', { method: 'item/completed', params: { threadId: 'ephemeral', item: { type: 'agentMessage', text: behavior === 'invalid' ? '{}' : '{"title":"Вкладки чатов в VS Code"}' } } });
          events.emit('notification', { method: 'turn/completed', params: { threadId: 'ephemeral', turn: { id: 'turn', status: 'completed' } } });
        });
        return { turn: { id: 'turn' } };
      }
      return {};
    },
  };
  return client;
}

async function transportChecks() {
  const client = fakeClient();
  assert.equal(await generateTitle(client, 'Привет! Мне нужна история чатов во вкладках VS Code'), 'Вкладки чатов в VS Code');
  const start = client.calls.find(c => c.method === 'thread/start').params;
  assert.equal(start.ephemeral, true);assert.equal(start.sandbox, 'read-only');assert.equal(start.approvalPolicy, 'never');
  assert.equal(start.config['features.shell_tool'], false);assert.equal(start.config['features.hooks'], false);
  assert.deepEqual(start.config.mcp_servers, { private: { enabled: false } });
  await assert.rejects(fs.access(start.cwd));
  for (const [behavior, error] of [['invalid', /некорректное/], ['start-error', /Start failed/], ['failure', /Connection lost/], ['wait', /превысила/]]) {
    const c = fakeClient(behavior);
    await assert.rejects(generateTitle(c, 'Some task', { timeoutMs: 20 }), error);
    assert.ok(c.calls.some(c => c.method === 'thread/unsubscribe'));
    if (['failure', 'wait'].includes(behavior)) assert.ok(c.calls.some(c => c.method === 'turn/interrupt'));
  }
  const c = fakeClient('wait'), controller = new AbortController();
  const pending = generateTitle(c, 'Some task', { signal: controller.signal });
  while (!c.calls.some(c => c.method === 'turn/start')) await new Promise(r => setImmediate(r));
  controller.abort();
  await assert.rejects(pending, /отменена/);
  assert.ok(c.calls.some(c => c.method === 'turn/interrupt'));
}

async function coordinationChecks() {
  const config = { generateTitles: true, titleModel: 'test-model' };
  class Emitter { constructor() { this.event = () => ({ dispose() {} }); } fire() {} dispose() {} }
  const originalLoad = Module._load;
  Module._load = function(name, ...rest) { return name === 'vscode' ? { EventEmitter: Emitter, workspace: { getConfiguration: () => ({ get: (k, fallback) => config[k] ?? fallback }) } } : originalLoad.call(this, name, ...rest); };
  let SessionTitles;
  try { ({ SessionTitles } = require('../session-titles')); } finally { Module._load = originalLoad; }
  const thread = { id: 'fixture', name: 'Новый чат', originator: 'codex_session_tabs', preview: 'Привет! Давай сделаем историю чатов и вкладки в VS Code' };
  let name = thread.name, generated = 0, visible = [], wait = false, changedExternally = false;
  const client = { readThread: async () => ({ ...thread, name }), renameThread: async (_, value) => { name = value; } };
  const state = { get: (_, fallback) => fallback, update: async () => {} };
  const manager = new SessionTitles({ globalState: state }, { records: [], updateTitle: async () => {} },
    { pins: [], changed: { fire() {} }, openTabs: () => visible }, async fn => fn(client), () => {},
    async (_, prompt, { signal }) => {
      generated++;assert.equal(prompt, thread.preview);
      if (wait) await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Canceled')), { once: true }));
      if (changedExternally) name = 'Из другого клиента';
      return 'История чатов во вкладках';
    });
  try {
    await manager.sync(client, [{ ...thread }]);
    assert.equal(name, 'История чатов во вкладках');assert.equal(generated, 1);
    await manager.sync(client, [{ ...thread }]);assert.equal(generated, 1, 'Stale history must not generate twice');
    name = 'Новый чат';wait = true;
    const pending = manager.generate({ ...thread }, client, true);
    while (generated < 2) await new Promise(r => setImmediate(r));
    const manual = manager.rename(thread.id, 'Моё название');
    await assert.rejects(pending, /Canceled/);await manual;assert.equal(name, 'Моё название');
    wait = false;changedExternally = true;
    await manager.generate({ ...thread }, client, true);assert.equal(name, 'Из другого клиента');
    changedExternally = false;name = 'Новый чат';
    const other = { ...thread, id: 'native' };visible = [{ id: 'native', backend: 'native' }];
    const count = generated;await manager.sync(client, [other]);assert.equal(generated, count, 'Native editor owns its auto title');
    config.generateTitles = false;visible = [];
    await manager.sync(client, [{ ...thread, id: 'disabled' }]);assert.equal(generated, count);
  } finally { manager.dispose(); }
}
(async () => { await transportChecks();await coordinationChecks();console.log('PASS: semantic output, ephemeral isolation, errors/timeouts/cancellation, manual priority, external changes, native ownership, opt-out'); })().catch(error => { console.error(error);process.exitCode = 1; });
