'use strict';

const { t } = require('./i18n');

const vscode = require('vscode');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

async function resolveCli() {
  const configured = vscode.workspace.getConfiguration('codexSessionTabs').get('cliPath');
  const executable = process.platform === 'win32' ? 'codex.exe' : 'codex';
  const candidates = configured ? [configured] : [
    path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'packages', 'app-server-daemon', 'current', 'bin', executable),
    ...((process.env.PATH || '').split(path.delimiter).filter(Boolean).map(folder => path.join(folder, executable))),
    path.join(os.homedir(), '.local', 'bin', executable),
  ];
  for (const candidate of candidates) {
    try { await fs.access(candidate, fs.constants.X_OK); return candidate; } catch {}
  }
  const extension = vscode.extensions.getExtension('openai.chatgpt');
  const arch = { x64: 'x86_64', arm64: 'aarch64' }[process.arch] || process.arch;
  const platform = process.platform === 'win32' ? 'windows' : process.platform;
  const bundled = extension && path.join(extension.extensionPath, 'bin', `${platform}-${arch}`, executable);
  if (bundled) { await fs.access(bundled, fs.constants.X_OK); return bundled; }
  throw new Error(t("Codex CLI was not found. Set codexSessionTabs.cliPath in user settings."));
}

class TerminalSessions {
  constructor(context, readThread, createThread) {
    this.context = context;
    this.readThread = readThread;
    this.createThread = createThread;
    this.records = context.workspaceState.get('terminalSessions', []);
    this.changed = new vscode.EventEmitter();
    this.onDidChange = this.changed.event;
    this.pending = new Map();
    this.live = new Map();
    this.tabIds = new WeakMap();
    this.tabTerminals = new WeakMap();
    for (const terminal of vscode.window.terminals) this.adopt(terminal);
    this.disposables = [this.changed,
      vscode.window.tabGroups.onDidChangeTabs(event => {
        for (const tab of [...event.opened, ...event.changed]) this.recordForTab(tab);
      }),
      vscode.window.onDidOpenTerminal(terminal => { this.adopt(terminal); this.changed.fire(); }),
      vscode.window.onDidCloseTerminal(terminal => {
        for (const [id, current] of this.live) if (current === terminal) this.live.delete(id);
        this.changed.fire();
      }),
      vscode.window.onDidChangeActiveTerminal(() => this.changed.fire()),
    ];
  }

  get enabled() { return vscode.workspace.getConfiguration('codexSessionTabs').get('chatMode', 'native') === 'terminal'; }

  adopt(terminal) {
    const options = terminal.creationOptions;
    const record = this.records.find(record => options.name === record.label ||
      Array.isArray(options.shellArgs) && options.shellArgs.includes(record.id));
    if (record) this.live.set(record.id, terminal);
  }

  recordForTab(tab) {
    if (!(tab.input instanceof vscode.TabInputTerminal)) return undefined;
    const known = this.tabIds.get(tab);
    if (known) return this.records.find(record => record.id === known);
    let record = this.records.find(record => record.label === tab.label || tab.label.endsWith(record.label));
    if (!record) {
      const candidates = this.records.filter(record => {
        const terminal = this.terminal(record);
        return terminal && (tab.label === terminal.name || tab.label.endsWith(terminal.name));
      });
      if (candidates.length === 1) record = candidates[0];
      else if (tab === vscode.window.tabGroups.activeTabGroup.activeTab) {
        record = candidates.find(record => this.terminal(record) === vscode.window.activeTerminal);
      }
    }
    if (record) {
      this.tabIds.set(tab, record.id);
      this.tabTerminals.set(tab, this.live.get(record.id));
    }
    return record;
  }

  terminal(record) {
    return this.live.get(record.id);
  }

  tabClosed(tab) {
    const record = this.recordForTab(tab);
    if (!record) return;
    const terminal = this.tabTerminals.get(tab);
    if (terminal && this.live.get(record.id) === terminal) this.live.delete(record.id);
    else if (!terminal && !this.openTabs().some(entry => entry.id === record.id && entry.tab !== tab)) this.live.delete(record.id);
  }

  openTabs() {
    return vscode.window.tabGroups.all.flatMap(group => group.tabs.flatMap(tab => {
      const record = this.recordForTab(tab);
      if (!record) return [];
      return [{ ...record, uri: vscode.Uri.parse(record.uri), tab, group, terminal: this.terminal(record), backend: 'terminal' }];
    }));
  }

  async open(id, beside = false, metadata) {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(t("Invalid Codex session ID."));
    const existing = this.records.find(record => record.id === id && this.terminal(record));
    if (existing) {
      const terminal = this.terminal(existing);
      terminal.show(false);
      await vscode.commands.executeCommand('workbench.action.terminal.renameWithArg', { name: existing.label });
      return terminal;
    }
    if (this.pending.has(id)) return this.pending.get(id);
    const promise = this.launch(id, beside, metadata).finally(() => this.pending.delete(id));
    this.pending.set(id, promise);
    return promise;
  }

  async launch(id, beside, metadata) {
    const thread = metadata || this.records.find(record => record.id === id)?.thread || await this.readThread(id);
    const cli = await resolveCli();
    const cwd = thread.cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || os.homedir();
    const title = (thread.name?.trim() || thread.preview?.trim() || t("New chat")).replace(/\s+/g, ' ').slice(0, 55);
    const record = { id, label: `Codex · ${title} [${id.slice(-8)}]`, cwd,
      uri: vscode.Uri.from({ scheme: 'openai-codex', authority: 'route', path: `/local/${id}` }).toString(), backend: 'terminal',
      thread: { id, cwd, name: thread.name, preview: thread.preview } };
    this.records = [...this.records.filter(item => item.id !== id), record].slice(-100);
    await this.context.workspaceState.update('terminalSessions', this.records);
    // Launch directly: paths and session IDs never pass through shell interpolation.
    const terminal = vscode.window.createTerminal({
      name: record.label,
      shellPath: cli,
      shellArgs: ['resume', id, '--no-alt-screen', '--cd', cwd, '-c', 'check_for_update_on_startup=false'],
      env: { CODEX_SESSION_ID: null, CODEX_THREAD_ID: null, CODEX_TOOL_CALL_ID: null, CODEX_CI: null,
        CODEX_PERMISSION_PROFILE: null, CODEX_VERSION: null, CODEX_MANAGED_PACKAGE_ROOT: null, CODEX_MANAGED_BY_NPM: null },
      cwd,
      location: { viewColumn: beside ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active, preserveFocus: false },
    });
    this.live.set(id, terminal);
    terminal.show(false);
    this.changed.fire();
    return terminal;
  }

  async newChat() {
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || os.homedir();
    const thread = await this.createThread(cwd);
    return this.open(thread.id, false, thread);
  }

  async updateTitle(id, name) {
    const record = this.records.find(record => record.id === id);
    if (!record) return;
    record.label = `Codex · ${name.replace(/\s+/g, ' ').slice(0, 55)} [${id.slice(-8)}]`;
    record.thread = { ...record.thread, id, name };
    await this.context.workspaceState.update('terminalSessions', this.records);
    if (this.live.get(id) === vscode.window.activeTerminal) {
      await vscode.commands.executeCommand('workbench.action.terminal.renameWithArg', { name: record.label });
    }
    this.changed.fire();
  }

  close(uri) {
    const record = this.records.find(record => record.uri === uri.toString());
    const terminal = this.terminal(record || {});
    if (record) this.live.delete(record.id);
    terminal?.dispose();
  }

  dispose() {
    for (const disposable of this.disposables) disposable.dispose();
    // Editor terminals survive an extension-host restart.
  }
}

module.exports = { TerminalSessions, resolveCli };
