'use strict';

const { t, isPlaceholder } = require('./i18n');

const vscode = require('vscode');
const { generateTitle } = require('./title-generator');

function automaticTitle(thread, managedIds = new Set(), manualIds = new Set()) {
  if (manualIds.has(thread.id) || !isPlaceholder(thread.name)) return null;
  if (thread.originator !== 'codex_session_tabs' && !managedIds.has(thread.id)) return null;
  return thread.preview?.trim() || null;
}

class SessionTitles {
  constructor(context, terminals, tabs, withClient, log, generator = generateTitle) {
    this.context = context;
    this.terminals = terminals;
    this.tabs = tabs;
    this.withClient = withClient;
    this.log = log;
    this.generator = generator;
    this.manualIds = new Set(context.globalState.get('manuallyNamedSessions', []));
    this.confirmedManual = new Set(this.manualIds);
    this.pendingManual = new Map();
    this.operations = new Map();
    this.recentManual = new Map();
    this.generationAttempts = new Set();
    this.generations = new Map();
    this.editRevision = new Map();
    this.changed = new vscode.EventEmitter();
    this.onDidChange = this.changed.event;
  }

  enqueue(id, action) {
    const previous = this.operations.get(id) || Promise.resolve();
    const operation = previous.catch(() => {}).then(action).finally(() => {
      if (this.operations.get(id) === operation) this.operations.delete(id);
    });
    this.operations.set(id, operation);
    return operation;
  }

  async apply(id, name) {
    try { await this.terminals.updateTitle(id, name); }
    catch (error) { this.log(`Title saved; terminal caption update failed: ${error.message}`); }
    for (const pin of this.tabs.pins) if (pin.id === id) pin.name = name;
    try { await this.context.globalState.update('pinnedSessions', this.tabs.pins); }
    catch (error) { this.log(`Title saved; pinned metadata update failed: ${error.message}`); }
    this.changed.fire({ id, name });
    this.tabs.changed.fire();
  }

  schedule(threads, readStartedAt = Date.now()) {
    if (this.disposed) return;
    this.reconcile(threads, readStartedAt);
    this.nextSync = { threads, readStartedAt };
    if (this.background) return;
    this.background = (async () => {
      while (!this.disposed && this.nextSync) {
        const snapshot = this.nextSync;
        this.nextSync = undefined;
        await this.syncCaptions(snapshot.threads, snapshot.readStartedAt);
        const ids = new Set(this.terminals.records.map(record => record.id));
        if (!vscode.workspace.getConfiguration('codexSessionTabs').get('generateTitles', true)) continue;
        if (!snapshot.threads.some(thread => automaticTitle(thread, ids, this.manualIds) && !this.generationAttempts.has(thread.id) &&
          !this.tabs.openTabs?.().some(tab => tab.id === thread.id && tab.backend !== 'terminal'))) continue;
        await this.withClient(async client => {
          this.activeClient = client;
          try { await this.sync(client, snapshot.threads, snapshot.readStartedAt); }
          finally { this.activeClient = undefined; }
        });
      }
    })().catch(error => { if (!this.disposed) this.log(`Background title update failed: ${error.message}`); })
      .finally(() => { this.background = undefined; if (!this.disposed && this.nextSync) this.schedule(this.nextSync.threads, this.nextSync.readStartedAt); });
  }

  reconcile(threads, readStartedAt) {
    for (const thread of threads) {
      const manual = this.recentManual.get(thread.id);
      if (manual && manual.changedAt >= readStartedAt && thread.name !== manual.name) {
        thread.name = manual.name;
        this.changed.fire({ id: thread.id, name: manual.name });
      }
    }
  }

  async rename(id, value) {
    const name = value.trim();
    if (!name) throw new Error(t("Chat title cannot be empty."));
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(t("Invalid Codex session ID."));
    this.editRevision.set(id, (this.editRevision.get(id) || 0) + 1);
    this.generations.get(id)?.abort();
    this.pendingManual.set(id, (this.pendingManual.get(id) || 0) + 1);
    this.manualIds.add(id);
    return this.enqueue(id, async () => {
      try {
        await this.withClient(client => client.renameThread(id, name));
        this.confirmedManual.add(id);
        this.recentManual.set(id, { name, changedAt: Date.now() });
        try { await this.context.globalState.update('manuallyNamedSessions', [...this.confirmedManual]); }
        catch (error) { this.log(`Title saved; manual-name preference update failed: ${error.message}`); }
        await this.apply(id, name);
        return name;
      } finally {
        const pending = this.pendingManual.get(id) - 1;
        if (pending) this.pendingManual.set(id, pending);
        else {
          this.pendingManual.delete(id);
          if (!this.confirmedManual.has(id)) this.manualIds.delete(id);
        }
      }
    });
  }

  async generate(thread, client, force = false) {
    const id = thread.id;
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(t("Invalid Codex session ID."));
    const revision = this.editRevision.get(id) || 0;
    return this.enqueue(id, async () => {
      if (this.disposed || (this.manualIds.has(id) && !force) || (this.editRevision.get(id) || 0) !== revision) return;
      const controller = new AbortController();
      this.generations.set(id, controller);
      const run = async activeClient => {
        const previous = await activeClient.readThread(id);
        if (!force && !isPlaceholder(previous.name)) return;
        controller.signal.throwIfAborted();
        const message = previous.preview?.trim() || thread.preview?.trim();
        const name = await this.generator(activeClient, message, {
          model: vscode.workspace.getConfiguration('codexSessionTabs').get('titleModel', 'gpt-6-luna'),
          signal: controller.signal,
        });
        if (this.disposed || (this.editRevision.get(id) || 0) !== revision) return;
        const latest = await activeClient.readThread(id);
        if (latest.name !== previous.name || controller.signal.aborted) return;
        await activeClient.renameThread(id, name);
        if (this.disposed || (this.editRevision.get(id) || 0) !== revision) return;
        thread.name = name;
        this.recentManual.set(id, { name, changedAt: Date.now() });
        await this.apply(id, name);
        return name;
      };
      try { return client ? await run(client) : await this.withClient(run); }
      finally { if (this.generations.get(id) === controller) this.generations.delete(id); }
    });
  }

  async sync(client, threads, readStartedAt = Date.now()) {
    const managedIds = new Set(this.terminals.records.map(record => record.id));
    const config = vscode.workspace.getConfiguration('codexSessionTabs');
    for (const thread of threads) {
      const message = automaticTitle(thread, managedIds, this.manualIds);
      if (this.disposed) break;
      if (!message || !config.get('generateTitles', true)) continue;
      if (this.tabs.openTabs?.().some(tab => tab.id === thread.id && tab.backend !== 'terminal')) continue;
      if (this.generationAttempts.has(thread.id)) continue;
      this.generationAttempts.add(thread.id);
      try { await this.generate(thread, client); }
      catch (error) { if (!this.disposed) this.log(`Could not generate a session title: ${error.message}`); }
      break; // One short model request per history refresh; failures require an explicit retry.
    }
    await this.syncCaptions(threads, readStartedAt);
  }

  async syncCaptions(threads, readStartedAt) {
    for (const thread of threads) {
      if (this.disposed) return;
      // A manual rename may finish while a previous caption is being persisted.
      this.reconcile([thread], readStartedAt);
      const record = this.terminals.records.find(record => record.id === thread.id);
      if (record && thread.name?.trim() && record.thread?.name !== thread.name) {
        await this.terminals.updateTitle(thread.id, thread.name);
      }
    }
  }

  dispose() {
    this.disposed = true;
    this.nextSync = undefined;
    for (const controller of this.generations.values()) controller.abort();
    this.activeClient?.dispose();
    this.changed.dispose();
  }
}

module.exports = { SessionTitles, automaticTitle };
