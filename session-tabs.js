'use strict';

const { t } = require('./i18n');

const vscode = require('vscode');
const EDITOR = 'chatgpt.conversationEditor';

function codexTab(tab) {
  return tab.input instanceof vscode.TabInputCustom && tab.input.viewType === EDITOR &&
    tab.input.uri.scheme === 'openai-codex' && tab.input.uri.authority === 'route';
}

function sessionId(uri) {
  return /^\/(?:local|remote)\/([A-Za-z0-9_-]+)$/.exec(uri.path)?.[1];
}

class SessionTabs {
  constructor(context, terminals, ensureNative = async () => {}) {
    this.context = context;
    this.terminals = terminals;
    this.ensureNative = ensureNative;
    this.opening = new Map();
    this.changed = new vscode.EventEmitter();
    this.onDidChange = this.changed.event;
    this.closed = context.workspaceState.get('closedTabs', []);
    this.last = context.workspaceState.get('lastTab');
    this.pins = context.globalState.get('pinnedSessions', []);
    this.filterProject = context.workspaceState.get('filterProject', false);
    this.disposables = [this.changed,
      vscode.window.tabGroups.onDidChangeTabs(event => {
        if (event.closed.length) {
          for (const tab of event.closed.filter(tab => this.isManaged(tab))) {
            const terminal = terminals?.recordForTab(tab);
            if (terminal) terminals.tabClosed(tab);
            const record = terminal ? { ...terminal } : { uri: tab.input.uri.toString(), label: tab.label };
            this.closed = [record, ...this.closed.filter(item => item.uri !== record.uri)].slice(0, 20);
          }
          void context.workspaceState.update('closedTabs', this.closed);
        }
        this.rememberActive();
        this.changed.fire();
      }),
      vscode.window.tabGroups.onDidChangeTabGroups(() => {
        this.rememberActive();
        this.changed.fire();
      }),
    ];
    if (terminals) this.disposables.push(terminals.onDidChange(() => { this.rememberActive(); this.changed.fire(); }));
    this.rememberActive();
  }

  isManaged(tab) { return codexTab(tab) || Boolean(this.terminals?.recordForTab(tab)); }

  rememberActive() {
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
    void vscode.commands.executeCommand('setContext', 'codexSessionTabs.activeTerminal', Boolean(tab && this.terminals?.recordForTab(tab)));
    if (!tab || !this.isManaged(tab)) return;
    const terminal = this.terminals?.recordForTab(tab);
    const record = terminal ? { ...terminal } : { uri: tab.input.uri.toString(), label: tab.label };
    if (this.last?.uri !== record.uri || this.last.label !== record.label) {
      this.last = record;
      void this.context.workspaceState.update('lastTab', record);
    }
  }

  openTabs() {
    const native = vscode.window.tabGroups.all.flatMap(group => group.tabs.filter(codexTab).map(tab => ({
      tab, group, uri: tab.input.uri, id: sessionId(tab.input.uri), label: tab.label,
    })));
    const terminals = this.terminals?.openTabs() || [];
    const seen = new Set();
    return (this.terminals?.enabled ? [...terminals, ...native] : [...native, ...terminals]).filter(entry => {
      const key = entry.uri.toString();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  async open(id, beside = false, metadata) {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(t("Invalid Codex session ID."));
    return this.reveal(vscode.Uri.from({ scheme: 'openai-codex', authority: 'route', path: `/local/${id}` }), beside, metadata);
  }

  async reveal(uri, beside = false, metadata) {
    if (uri.scheme !== 'openai-codex' || uri.authority !== 'route' ||
      !(sessionId(uri) || uri.path === '/extension/panel/new')) {
      throw new Error(t("Invalid Codex tab."));
    }
    const key = uri.toString();
    if (this.opening.has(key)) return this.opening.get(key);
    const opening = this.revealOne(uri, beside, metadata).finally(() => this.opening.delete(key));
    this.opening.set(key, opening);
    return opening;
  }

  async revealOne(uri, beside, metadata) {
    const id = sessionId(uri);
    const existing = this.openTabs().find(item => item.uri.toString() === uri.toString());
    // A running session keeps its owner, even after the preferred mode changes.
    // Also account for a managed terminal moved from the editor to the panel.
    if (existing?.backend === 'terminal' || this.terminals?.live?.has(id) || (!existing && this.terminals?.enabled)) {
      if (id) await this.terminals.open(id, beside, metadata);
      else await this.terminals.newChat();
    } else {
      await this.ensureNative();
      await vscode.commands.executeCommand('vscode.openWith', uri, EDITOR, {
        viewColumn: existing?.group.viewColumn ?? (beside ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active),
        preserveFocus: false,
        preview: false,
      });
    }
    this.rememberActive();
  }

  async reopen() {
    const record = this.closed[0];
    if (!record) return false;
    await this.reveal(vscode.Uri.parse(record.uri));
    this.closed = this.closed.filter(item => item.uri !== record.uri);
    await this.context.workspaceState.update('closedTabs', this.closed);
    this.changed.fire();
    return true;
  }

  async focusLast() {
    const uri = this.last?.uri || this.openTabs()[0]?.uri.toString();
    if (!uri) return false;
    await this.reveal(vscode.Uri.parse(uri));
    return true;
  }

  async close(uri) {
    const existing = this.openTabs().find(item => item.uri.toString() === uri.toString());
    if (existing?.backend === 'terminal') this.terminals.close(uri);
    else if (existing) await vscode.window.tabGroups.close(existing.tab);
  }

  isPinned(id) { return this.pins.some(thread => thread.id === id); }

  async togglePin(thread) {
    this.pins = this.isPinned(thread.id) ? this.pins.filter(item => item.id !== thread.id) :
      [...this.pins, { id: thread.id, name: thread.name, preview: thread.preview, cwd: thread.cwd, updatedAt: thread.updatedAt }];
    await this.context.globalState.update('pinnedSessions', this.pins);
    this.changed.fire();
  }

  async setProjectFilter(value) {
    this.filterProject = value;
    await this.context.workspaceState.update('filterProject', value);
    this.changed.fire();
  }

  dispose() {
    for (const disposable of this.disposables) disposable.dispose();
  }
}

module.exports = { SessionTabs, sessionId };
