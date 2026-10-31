'use strict';

const { t } = require('./i18n');

const { spawn } = require('node:child_process');
const readline = require('node:readline');
const { inProject } = require('./project-paths');

// Metadata and isolated title requests. User conversations belong to the official UI or CLI.
class HistoryClient {
  constructor(binary, cwd, log = () => {}, args = ['app-server']) {
    this.binary = binary;
    this.cwd = cwd;
    this.log = log;
    this.args = args;
    this.pending = new Map();
    this.nextId = 1;
    this.disposed = false;
    this.notificationHandlers = new Set();
    this.failureHandlers = new Set();
  }

  async start() {
    if (this.disposed) throw new Error(t('History client is closed'));
    if (this.starting) return this.starting;
    this.starting = this.initialize();
    return this.starting;
  }

  async initialize() {
    this.process = spawn(this.binary, this.args, {
      cwd: this.cwd,
      env: process.env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.process.on('error', error => this.fail(error));
    this.process.on('exit', (code, signal) => {
      this.fail(new Error(t('Codex app-server stopped ({reason})', { reason: signal || code })));
    });
    this.process.stdin.on('error', error => this.fail(error));
    this.process.stderr.on('data', chunk => this.log(chunk.toString().trim()));
    this.lines = readline.createInterface({ input: this.process.stdout });
    this.lines.on('line', line => this.receive(line));
    await this.request('initialize', {
      clientInfo: { name: 'codex_session_tabs', title: 'Codex Session Tabs', version: '0.9.0' },
      capabilities: { experimentalApi: true },
    });
    this.send({ method: 'initialized', params: {} });
  }

  send(message) {
    if (this.disposed || !this.process || this.process.exitCode !== null) {
      throw new Error(t('Codex app-server is unavailable'));
    }
    this.process.stdin.write(JSON.stringify(message) + '\n');
  }

  request(method, params) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(t('Codex did not respond to {method} within 20 seconds', { method })));
      }, 20000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ id, method, params }); }
      catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  receive(line) {
    let message;
    try { message = JSON.parse(line); }
    catch { this.log('Ignored non-JSON app-server output'); return; }
    // Title requests never grant permissions or execute client tools.
    if (message.method && message.id !== undefined) {
      this.send({ id: message.id, error: { code: -32601, message: 'Unsupported by history viewer' } });
      return;
    }
    if (message.method && message.id === undefined) {
      for (const handler of this.notificationHandlers) handler(message);
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) pending.reject(new Error(message.error.message));
    else pending.resolve(message.result);
  }

  onNotification(handler) { this.notificationHandlers.add(handler); return () => this.notificationHandlers.delete(handler); }

  onFailure(handler) { this.failureHandlers.add(handler); return () => this.failureHandlers.delete(handler); }

  async list({ cursor = null, cwd = null } = {}) {
    await this.start();
    const folders = Array.isArray(cwd) ? cwd : cwd ? [cwd] : [];
    const seen = new Set();
    // The server compares cwd literally. Filter here so alternate Windows path
    // spellings are not discarded before either history UI sees them.
    while (true) {
      const page = await this.request('thread/list', {
        cursor,
        limit: 100,
        sortKey: 'updated_at',
        archived: false,
        sourceKinds: ['cli', 'vscode', 'appServer'],
        modelProviders: [],
        useStateDbOnly: true,
      });
      if (!folders.length) return page;
      const data = page.data.filter(thread => inProject(thread.cwd, folders));
      if (data.length || !page.nextCursor) return { ...page, data };
      if (seen.has(page.nextCursor)) throw new Error('Codex returned a repeated history cursor');
      seen.add(page.nextCursor);
      cursor = page.nextCursor;
    }
  }

  async rateLimits() {
    await this.start();
    return this.request('account/rateLimits/read', {});
  }

  async readThread(threadId) {
    await this.start();
    return (await this.request('thread/read', { threadId })).thread;
  }

  async createThread(cwd) {
    await this.start();
    const thread = (await this.request('thread/start', { cwd })).thread;
    const name = t('New chat');
    await this.request('thread/name/set', { threadId: thread.id, name });
    return { ...thread, name };
  }

  async renameThread(threadId, name) {
    await this.start();
    return this.request('thread/name/set', { threadId, name });
  }

  fail(error) {
    for (const handler of this.failureHandlers) handler(error);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.fail(new Error('History closed'));
    this.lines?.close();
    this.process?.kill();
  }

  async shutdown() {
    const child = this.process;
    this.dispose();
    if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
    await new Promise(resolve => {
      const timer = setTimeout(resolve, 2000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
  }
}

module.exports = { HistoryClient };
