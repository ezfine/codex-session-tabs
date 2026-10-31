'use strict';

const { t, locale, configure } = require('./i18n');

const vscode = require('vscode');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { HistoryClient } = require('./app-server');
const { SessionTabs } = require('./session-tabs');
const { Sidebar } = require('./sidebar');
const { TerminalSessions } = require('./terminal-sessions');
const { SessionTitles } = require('./session-titles');
const { inProject } = require('./project-paths');
const { groupProjects } = require('./session-projects');

const EDITOR = 'chatgpt.conversationEditor';

async function codexExtension(activate = true) {
  const extension = vscode.extensions.getExtension('openai.chatgpt');
  if (!extension) throw new Error(t("Install the official OpenAI Codex extension (openai.chatgpt)."));
  const editors = extension.packageJSON.contributes?.customEditors || [];
  if (!editors.some(editor => editor.viewType === EDITOR)) {
    throw new Error(t("This Codex version does not support session editors. Update the OpenAI Codex extension."));
  }
  if (activate) await extension.activate();
  return extension;
}

async function createClient(log) {
  const extension = await codexExtension(false);
  const override = vscode.workspace.getConfiguration('chatgpt').get('cliExecutable');
  const arch = { x64: 'x86_64', arm64: 'aarch64' }[process.arch] || process.arch;
  const platform = { win32: 'windows' }[process.platform] || process.platform;
  const executable = process.platform === 'win32' ? 'codex.exe' : 'codex';
  if (!override) {
    const managed = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'packages', 'app-server-daemon', 'current', 'bin', executable);
    try { await fs.access(managed, fs.constants.X_OK); return new HistoryClient(managed,
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || os.homedir(), log); } catch {}
  }
  const binary = override || path.join(extension.extensionPath, 'bin', `${platform}-${arch}`, executable);
  await fs.access(binary);
  return new HistoryClient(binary, vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || os.homedir(), log);
}

function title(thread) {
  return (thread.name?.trim() || thread.preview?.trim() || t("Untitled")).replace(/\s+/g, ' ');
}

function sessionItem(thread, tabs, open) {
  const updated = new Date(thread.updatedAt * 1000);
  const date = Number.isFinite(updated.getTime())
    ? updated.toLocaleString(locale(), { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '';
  const folder = thread.cwd || '';
  return {
    label: `$(comment-discussion) ${title(thread)}`,
    description: [open ? t("open") : '', date].filter(Boolean).join(' · '),
    detail: folder,
    thread,
    uri: open?.uri,
    buttons: [
      { kind: 'rename', iconPath: new vscode.ThemeIcon('edit'), tooltip: t("Rename chat") },
      { kind: 'pin', iconPath: new vscode.ThemeIcon(tabs.isPinned(thread.id) ? 'pinned' : 'pin'), tooltip: tabs.isPinned(thread.id) ? t("Unpin session") : t("Pin session") },
      open ? { kind: 'close', iconPath: new vscode.ThemeIcon('close'), tooltip: t("Close tab") } :
        { kind: 'beside', iconPath: new vscode.ThemeIcon('split-horizontal'), tooltip: t("Open beside the current tab") },
    ],
  };
}

function activate(context) {
  configure(() => vscode.workspace.getConfiguration('codexSessionTabs').get('language', 'auto'), () => vscode.env.language);
  const output = vscode.window.createOutputChannel('Codex Session Tabs');
  const log = text => output.appendLine(text);
  const withClient = async callback => {
    const client = await createClient(log);
    try { return await callback(client); } finally { await client.shutdown(); }
  };
  const terminals = new TerminalSessions(context,
    id => withClient(client => client.readThread(id)),
    cwd => withClient(client => client.createThread(cwd)));
  const tabs = new SessionTabs(context, terminals, () => codexExtension());
  const titles = new SessionTitles(context, terminals, tabs, withClient, log);
  const openSession = (id, beside = false, metadata) => tabs.open(id, beside, metadata);
  let activePicker, refreshPickerLanguage;

  const report = error => {
    log(String(error?.stack || error));
    vscode.window.showErrorMessage(`Codex: ${error.message || error}`);
  };
  const newChat = async () => {
    if (terminals.enabled) return terminals.newChat();
    await codexExtension();
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || os.homedir();
    // Release the creating app-server before the official editor acquires the thread.
    const thread = await withClient(client => client.createThread(cwd));
    await tabs.open(thread.id, false, thread);
    return thread;
  };
  const focusLast = async () => {
    if (!(await tabs.focusLast())) await newChat();
  };
  const reopen = async () => {
    if (!(await tabs.reopen())) await vscode.commands.executeCommand('workbench.action.reopenClosedEditor');
  };
  const sidebar = new Sidebar(context, tabs, () => createClient(log), {
    open: openSession,
    reveal: (uri, beside) => tabs.reveal(uri, beside),
    onTitleChange: titles.onDidChange,
    scheduleTitles: (threads, readStartedAt) => titles.schedule(threads, readStartedAt),
  }, report);
  const renameSession = async (node, suppliedName) => {
    const active = tabs.openTabs().find(entry => entry.tab === vscode.window.tabGroups.activeTabGroup.activeTab);
    const id = node?.thread?.id || node?.id || active?.id;
    if (!id) { vscode.window.showInformationMessage(t('Select a chat and choose Rename chat from its context menu.')); return; }
    const current = node?.thread?.name || sidebar.threads.find(thread => thread.id === id)?.name || active?.thread?.name || '';
    const name = suppliedName ?? await vscode.window.showInputBox({
      title: t("Rename Codex chat"), value: current,
      prompt: t("The title will be saved in Codex history"),
      validateInput: value => value.trim() ? undefined : t("Enter a chat title"),
    });
    if (name !== undefined) await titles.rename(id, name);
    if (name !== undefined && !terminals.enabled) vscode.window.setStatusBarMessage(t("Title saved. The graphical tab title will update the next time you open it."), 7000);
  };
  const generateSessionTitle = async node => {
    const active = tabs.openTabs().find(entry => entry.tab === vscode.window.tabGroups.activeTabGroup.activeTab);
    const id = node?.thread?.id || node?.id || active?.id;
    if (!id) { vscode.window.showInformationMessage(t("Select a chat in Codex Sessions.")); return; }
    const generated = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: t("Codex: generating a title") },
      () => titles.generate({ id, preview: node?.thread?.preview }, undefined, true));
    if (generated && !terminals.enabled) vscode.window.setStatusBarMessage(t("Title saved. The graphical tab title will update the next time you open it."), 7000);
  };
  const chooseLanguage = async () => {
    const selected = await vscode.window.showQuickPick([
      { label: t('Automatic (VS Code)'), value: 'auto' },
      { label: 'English', value: 'en' },
      { label: 'Русский', value: 'ru' },
    ], { title: t('Extension language') });
    if (selected) await vscode.workspace.getConfiguration('codexSessionTabs').update('language', selected.value, vscode.ConfigurationTarget.Global);
  };
  const chooseMode = async () => {
    const option = await vscode.window.showQuickPick([
      { label: t("$(comment-discussion) Graphical chat"), description: t("Official Codex extension interface"), value: 'native' },
      { label: t("$(terminal) Lightweight terminal"), description: t("Codex CLI in editor tabs"), value: 'terminal' },
    ], { title: t("How to open Codex chats") });
    if (option) await vscode.workspace.getConfiguration('codexSessionTabs').update('chatMode', option.value, vscode.ConfigurationTarget.Global);
  };

  async function history() {
    if (activePicker) { activePicker.show(); return; }
    const picker = vscode.window.createQuickPick();
    activePicker = picker;
    picker.title = t("Codex — session history");
    picker.placeholder = t("Title or project folder → Enter: open in a tab");
    picker.matchOnDescription = true;
    picker.matchOnDetail = true;
    picker.ignoreFocusOut = true;

    const refresh = { iconPath: new vscode.ThemeIcon('refresh'), tooltip: t("Refresh history") };
    const project = { iconPath: new vscode.ThemeIcon('folder'), tooltip: t("Show the current project only") };
    const workspacePaths = vscode.workspace.workspaceFolders?.map(folder => folder.uri.fsPath) || [];
    let projectOnly = tabs.filterProject && workspacePaths.length > 0;
    let threads = [];
    let cursor = null;
    let closed = false;
    let epoch = 0;
    let client;
    let clientPromise;
    const subscriptions = [];

    function render() {
      const previousId = picker.activeItems[0]?.thread?.id;
      project.iconPath = new vscode.ThemeIcon(projectOnly ? 'folder-active' : 'folder');
      project.tooltip = projectOnly ? t("Show sessions from all projects") : t("Show the current project only");
      picker.buttons = workspacePaths.length ? [refresh, project] : [refresh];
      picker.title = `Codex — ${projectOnly ? t("current project") : t("all projects")}`;
      const items = [{ label: t("$(add) New chat"), alwaysShow: true, action: 'new' }];
      if (tabs.closed.length) items.push({ label: t("$(discard) Reopen closed tab"), description: tabs.closed[0].label, alwaysShow: true, action: 'reopen' });
      const open = tabs.openTabs();
      const metadata = new Map([...tabs.pins, ...threads].map(thread => [thread.id, thread]));
      const used = new Set();
      const section = (label, values) => {
        if (!values.length) return;
        items.push({ label, kind: vscode.QuickPickItemKind.Separator });
        items.push(...values);
      };
      section(t("Open tabs"), open.map(entry => {
        used.add(entry.id);
        const thread = metadata.get(entry.id) || entry.thread;
        if (thread) return sessionItem(thread, tabs, entry);
        return { label: `$(comment-discussion) ${entry.label}`, description: t("open"), uri: entry.uri,
          buttons: [{ kind: 'close', iconPath: new vscode.ThemeIcon('close'), tooltip: t("Close tab") }] };
      }));
      section(t("Pinned"), tabs.pins.filter(thread => !used.has(thread.id) && (!projectOnly || inProject(thread.cwd, workspacePaths))).map(thread => {
        used.add(thread.id);
        return sessionItem(metadata.get(thread.id) || thread, tabs);
      }));
      const history = threads.filter(thread => !used.has(thread.id));
      if (!projectOnly) {
        for (const project of groupProjects(history)) section(project.label, project.threads.map(thread => sessionItem(thread, tabs)));
      } else {
        const midnight = new Date();
        midnight.setHours(0, 0, 0, 0);
        const yesterday = new Date(midnight); yesterday.setDate(yesterday.getDate() - 1);
        const week = new Date(midnight); week.setDate(week.getDate() - 7);
        const groups = new Map([t("Today"), t("Yesterday"), t("Last 7 days"), t("Earlier")].map(name => [name, []]));
        for (const thread of history) {
          const updated = thread.updatedAt * 1000;
          const group = updated >= midnight.getTime() ? t("Today") : updated >= yesterday.getTime() ? t("Yesterday") :
            updated >= week.getTime() ? t("Last 7 days") : t("Earlier");
          groups.get(group).push(sessionItem(thread, tabs));
        }
        for (const [label, values] of groups) section(label, values);
      }
      if (cursor) items.push({ label: t("$(chevron-down) Load more sessions"), alwaysShow: true, action: 'more' });
      picker.items = items;
      const active = items.find(item => previousId && item.thread?.id === previousId) ||
        items.find(item => item.thread || item.uri) || items[0];
      picker.activeItems = [active];
    }

    async function load(reset = false) {
      const readStartedAt = Date.now();
      const generation = ++epoch;
      if (reset) { threads = []; cursor = null; render(); }
      picker.busy = true;
      try {
        if (!clientPromise) {
          clientPromise = createClient(log).then(value => {
            client = value;
            if (closed) value.dispose();
            return value;
          }).catch(error => { clientPromise = undefined; throw error; });
        }
        const backend = await clientPromise;
        if (closed || generation !== epoch) return;
        const result = await backend.list({ cursor: reset ? null : cursor, cwd: projectOnly ? workspacePaths : null });
        if (closed || generation !== epoch) return;
        titles.schedule(result.data, readStartedAt);
        const seen = new Set(threads.map(thread => thread.id));
        threads.push(...result.data.filter(thread => !seen.has(thread.id)));
        cursor = result.nextCursor;
        render();
      } catch (error) {
        if (!closed && generation === epoch) {
          client?.dispose();
          client = undefined;
          clientPromise = undefined;
          report(error);
        }
      } finally {
        if (!closed && generation === epoch) picker.busy = false;
      }
    }

    async function choose(item, beside = false) {
      if (!item) return;
      if (item.action === 'more') { if (!picker.busy) await load(); return; }
      picker.hide();
      try {
        if (item.action === 'new') await newChat();
        else if (item.action === 'reopen') await reopen();
        else if (item.uri) await tabs.reveal(item.uri, beside);
        else if (item.thread) await openSession(item.thread.id, beside, item.thread);
      } catch (error) { report(error); }
    }

    refreshPickerLanguage = () => {
      picker.placeholder = t('Title or project folder → Enter: open in a tab');
      refresh.tooltip = t('Refresh history');
      render();
    };
    subscriptions.push(
      picker.onDidAccept(() => { void choose(picker.selectedItems[0]); }),
      picker.onDidTriggerItemButton(event => {
        if (event.button.kind === 'rename') { picker.hide(); void renameSession(event.item).catch(report); }
        else if (event.button.kind === 'pin') void tabs.togglePin(event.item.thread).catch(report);
        else if (event.button.kind === 'close') void tabs.close(event.item.uri).catch(report);
        else void choose(event.item, true);
      }),
      picker.onDidTriggerButton(button => {
        if (button === project) { projectOnly = !projectOnly; void tabs.setProjectFilter(projectOnly); }
        void load(true);
      }),
      tabs.onDidChange(() => { if (!closed) render(); }),
      titles.onDidChange(({ id, name }) => { for (const thread of threads) if (thread.id === id) thread.name = name; if (!closed) render(); }),
      picker.onDidHide(() => {
        closed = true;
        ++epoch;
        if (activePicker === picker) { activePicker = undefined; refreshPickerLanguage = undefined; }
        client?.dispose();
        for (const subscription of subscriptions) subscription.dispose();
        picker.dispose();
      }),
    );
    render();
    picker.show();
    await load(true);
  }

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
  status.text = '$(history) Codex';
  status.tooltip = t("Codex history: open a session in a tab (Ctrl+Alt+H)");
  status.command = 'codexSessionTabs.history';
  status.show();

  context.subscriptions.push(
    output, status, sidebar, titles, tabs, terminals,
    vscode.commands.registerCommand('codexSessionTabs.history', history),
    vscode.commands.registerCommand('codexSessionTabs.newChat', () => newChat().catch(report)),
    vscode.commands.registerCommand('codexSessionTabs.openSession', openSession),
    vscode.commands.registerCommand('codexSessionTabs.focusLast', () => focusLast().catch(report)),
    vscode.commands.registerCommand('codexSessionTabs.reopenClosed', () => reopen().catch(report)),
    vscode.commands.registerCommand('codexSessionTabs.recoverUI', () => vscode.commands.executeCommand('workbench.action.restartExtensionHost')),
    vscode.commands.registerCommand('codexSessionTabs.chooseLanguage', () => chooseLanguage().catch(report)),
    vscode.commands.registerCommand('codexSessionTabs.chooseMode', () => chooseMode().catch(report)),
    vscode.commands.registerCommand('codexSessionTabs.generateTitle', node => generateSessionTitle(node).catch(report)),
    vscode.commands.registerCommand('codexSessionTabs.rename', (...args) => renameSession(...args).catch(report)),
    vscode.commands.registerCommand('codexSessionTabs.openSettings', () => vscode.commands.executeCommand('workbench.action.openSettings', '@ext:' + context.extension.id)),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('codexSessionTabs.chatMode')) tabs.changed.fire();
      if (event.affectsConfiguration('codexSessionTabs.language')) {
        sidebar.updateLanguage();
        refreshPickerLanguage?.();
        status.tooltip = t('Codex history: open a session in a tab (Ctrl+Alt+H)');
      }
    }),
    { dispose: () => activePicker?.hide() },
  );

  return { openSession, tabs, terminals, titles, sidebar, createClient: () => createClient(log) };
}

module.exports = { activate };
